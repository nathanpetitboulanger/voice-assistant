import { useEffect, useRef, useState } from "react";
import { Ear, Headset, Mic, PhoneOff, ShieldCheck } from "lucide-react";
import { startCall, type Call } from "../realtime";
import { useSettings } from "../settings";
import { HARMLESS_ERRORS, ToolTracker, type Demarche, type Recap, type ServerEvent } from "../tools";
import { MessageView, RecapLink, localId, useMessages } from "./Transcript";

// What the assistant is doing right now: shown big, but not read out by screen readers
// (they would talk over the assistant).
type Turn = "listening" | "user" | "thinking" | "assistant";

const TURN_LABELS: Record<Turn, string> = {
  listening: "Je vous écoute",
  user: "Vous parlez…",
  thinking: "Je regarde…",
  assistant: "L'assistant parle…",
};

const IDLE_NOTICE = "Touchez « Appeler » pour parler à votre assistant.";

type Props = {
  visible: boolean;
  dialSignal: number; // a new value: call now (from « Parler à l'assistant »)
  onLiveChange: (live: boolean) => void;
  onDemarche: (demarche: Omit<Demarche, "at" | "mode">) => void;
};

export function VoiceMode({ visible, dialSignal, onLiveChange, onDemarche }: Props) {
  const { settings, update } = useSettings();
  const pushToTalk = settings.pushToTalk;
  const [phase, setPhase] = useState<"idle" | "connecting" | "live">("idle");
  const [notice, setNotice] = useState(IDLE_NOTICE);
  const [turn, setTurn] = useState<Turn>("listening");
  const [talking, setTalking] = useState(false);
  // The call's push-to-talk: changing the setting during a call applies to the next one.
  const [callPushToTalk, setCallPushToTalk] = useState(pushToTalk);
  // The recap PDFs (loan, complaint) once passed on to an advisor: the last of each.
  const [recaps, setRecaps] = useState<Record<string, Recap>>({});
  const { messages, put, append, remove, clear } = useMessages();

  const call = useRef<Call | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const responding = useRef(false);
  const speaking = useRef(false);
  const wakeLock = useRef<WakeLockSentinel | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const latest = useRef({ onDemarche });
  latest.current = { onDemarche };
  const tools = useRef<ToolTracker>(null);
  tools.current ??= new ToolTracker({
    put,
    onRecap: (tool, recap) => setRecaps((all) => ({ ...all, [tool]: recap })),
    onDemarche: (demarche) => latest.current.onDemarche(demarche),
  });

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: "smooth" });
  }, [messages, visible]);

  useEffect(() => {
    onLiveChange(phase !== "idle");
  }, [phase, onLiveChange]);

  useEffect(() => {
    if (dialSignal && phase === "idle") dial();
  }, [dialSignal]);

  // Escape cuts the assistant off, like « Interrompre ».
  useEffect(() => {
    if (!visible || phase !== "live") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") interrupt();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, phase]);

  function onEvent(e: ServerEvent) {
    switch (e.type) {
      case "input_audio_buffer.speech_started":
        setTurn("user");
        break;
      case "input_audio_buffer.speech_stopped":
        setTurn("thinking");
        break;
      case "input_audio_buffer.committed":
        put({ id: e.item_id, role: "user", text: "…" }); // placeholder: keeps the order of the turns
        break;
      case "conversation.item.input_audio_transcription.completed":
        if (e.transcript.trim()) put({ id: e.item_id, role: "user", text: e.transcript.trim() });
        else remove(e.item_id);
        break;
      case "response.created":
        responding.current = true;
        break;
      case "response.output_audio_transcript.delta":
        append(e.item_id, "assistant", e.delta);
        break;
      case "output_audio_buffer.started":
        speaking.current = true;
        setTurn("assistant");
        break;
      case "output_audio_buffer.stopped":
      case "output_audio_buffer.cleared":
        speaking.current = false;
        setTurn("listening");
        break;
      case "response.done":
        responding.current = false;
        if (tools.current!.onResponseDone(e.response)) setTurn("thinking");
        break;
      case "conversation.item.done": // the server's tool results, when they reach us
        tools.current!.onItemDone(e.item);
        break;
      case "error":
        if (!HARMLESS_ERRORS.includes(e.error?.code)) {
          console.warn("Realtime error", e.error);
          put({ id: localId(), role: "error", text: `Erreur : ${e.error?.message}` });
        }
        break;
    }
  }

  async function keepScreenOn(on: boolean) {
    // A locked phone stops the mic: keep the screen on during the call.
    try {
      if (on) wakeLock.current = await navigator.wakeLock?.request("screen");
      else await wakeLock.current?.release();
    } catch {
      /* not supported, or battery saver: the call still works */
    }
  }

  function onEnd(reason?: string) {
    call.current = null;
    setPhase("idle");
    setTalking(false);
    setTurn("listening");
    setNotice(reason ?? "Appel terminé. Touchez « Appeler » pour recommencer.");
    keepScreenOn(false);
  }

  async function dial() {
    setPhase("connecting");
    setNotice("Connexion…");
    clear();
    setRecaps({});
    tools.current!.reset();
    setCallPushToTalk(pushToTalk);
    try {
      call.current = await startCall({
        pushToTalk,
        audio: audio.current!,
        onEvent,
        onEnd,
      });
      setPhase("live");
      setTurn("listening");
      setNotice(
        pushToTalk
          ? "En ligne. Touchez « Parler », posez votre question, puis touchez « Envoyer »."
          : "En ligne. Parlez quand vous voulez. Pour couper la parole à l'assistant, parlez ou touchez « Interrompre ».",
      );
      keepScreenOn(true);
    } catch (error) {
      setPhase("idle");
      if (error instanceof DOMException && error.name === "NotAllowedError") {
        setNotice("Le micro est bloqué : autorisez-le dans le navigateur, puis réessayez.");
      } else {
        setNotice(`L'appel n'a pas pu démarrer. ${(error as Error).message}`);
      }
    }
  }

  // Cuts the assistant off, greeting included: talking over it doesn't always work (the
  // phone's echo cancellation can muffle the voice while the speaker plays).
  function interrupt() {
    const c = call.current;
    if (!c) return;
    if (responding.current) c.send({ type: "response.cancel" });
    if (speaking.current) c.send({ type: "output_audio_buffer.clear" });
  }

  // Push-to-talk: "Parler" interrupts the assistant and opens the mic, "Envoyer" sends.
  function talk() {
    const c = call.current!;
    interrupt();
    c.send({ type: "input_audio_buffer.clear" });
    c.setMic(true);
    setTalking(true);
    setTurn("user");
  }

  function sendTurn() {
    const c = call.current!;
    setTalking(false);
    setTurn("thinking");
    // The last words are still on their way: close the mic a bit later.
    setTimeout(() => {
      c.setMic(false);
      c.send({ type: "input_audio_buffer.commit" });
      c.send({ type: "response.create" });
    }, 400);
  }

  const live = phase === "live";
  let label = "Appeler";
  let action: () => void = dial;
  if (phase === "connecting") label = "Connexion…";
  else if (live && callPushToTalk) {
    [label, action] = talking ? ["Envoyer", sendTurn] : ["Parler", talk];
  }
  else if (live) [label, action] = ["Interrompre", interrupt];
  const state = !live ? phase : talking ? "talking" : turn;

  return (
    <div className={`voice ${messages.length ? "" : "intro"}`}>
      <p className="notice" role="status" aria-live="polite">
        {notice}
      </p>

      {messages.length > 0 && (
        <div className="transcript" ref={log} aria-label="Conversation" role="region">
          {messages.map((m) => (
            <MessageView key={m.id} message={m} />
          ))}
        </div>
      )}

      <div className="voice-controls">
        {/* Kept after hanging up, so the customer can download them once the call is over. */}
        {Object.values(recaps).map((recap) => (
          <RecapLink key={recap.url} recap={recap} big />
        ))}

        {live && (
          <p className={`turn ${turn}`} aria-hidden="true">
            {TURN_LABELS[turn]}
          </p>
        )}

        <button
          className={`orb-button state-${state}`}
          onClick={action}
          disabled={phase === "connecting"}
        >
          <span className="orb" aria-hidden="true">
            {live && turn === "assistant" && !talking ? (
              <span className="bars">
                <span />
                <span />
                <span />
                <span />
                <span />
              </span>
            ) : (
              <Mic />
            )}
          </span>
          <span className="orb-label">{label}</span>
        </button>

        {phase === "idle" && (
          <label className="switch-row">
            <input
              type="checkbox"
              role="switch"
              checked={pushToTalk}
              onChange={(e) => update({ pushToTalk: e.target.checked })}
            />
            <span>Pièce bruyante : je touche « Parler » puis « Envoyer »</span>
          </label>
        )}

        {live && (
          <button className="btn danger block" onClick={() => call.current?.hangUp()}>
            <PhoneOff aria-hidden="true" />
            Raccrocher
          </button>
        )}
      </div>

      {messages.length === 0 && (
        <div className="voice-intro">
          <h2>Parlez-lui comme à un conseiller</h2>
          <ul>
            <li>
              <Ear aria-hidden="true" />
              Il vous écoute et vous répond à voix haute. Coupez-lui la parole quand vous
              voulez.
            </li>
            <li>
              <ShieldCheck aria-hidden="true" />
              Il ne vous demandera jamais votre code secret ni votre mot de passe.
            </li>
            <li>
              <Headset aria-hidden="true" />
              Avec des écouteurs, ou le haut-parleur du téléphone.
            </li>
          </ul>
        </div>
      )}

      <audio ref={audio} autoPlay playsInline />
    </div>
  );
}
