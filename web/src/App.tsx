import { useEffect, useRef, useState } from "react";
import { startCall, type Call, type ServerEvent } from "./realtime";

type Message = { id: string; role: "user" | "assistant" | "action"; text: string };
// What the assistant is doing right now: shown big, but not read out by screen readers
// (they would talk over the assistant).
type Turn = "listening" | "user" | "thinking" | "assistant";

const TURN_LABELS: Record<Turn, string> = {
  listening: "Je vous écoute",
  user: "Vous parlez…",
  thinking: "Je regarde…",
  assistant: "L'assistant parle…",
};

const TOPICS: Record<string, string> = {
  code_perdu: "Code perdu",
  credit: "Crédit",
  gestion_privee: "Gestion privée",
  reclamation: "Réclamation",
};

const REQUESTS: Record<string, string> = {
  card_block: "opposition sur la carte",
  complaint: "réclamation",
  pin_reissue: "réédition du code",
  password_reset: "nouveau mot de passe",
  loan_application: "demande de crédit",
  appointment: "rendez-vous",
};

// Errors that just mean "nothing to cancel" or "nothing said" in push-to-talk.
const HARMLESS_ERRORS = ["response_cancel_not_active", "input_audio_buffer_commit_empty"];

function parse(json: string) {
  try {
    return JSON.parse(json || "{}");
  } catch {
    return {};
  }
}

function describeCall(name: string, args: string): string {
  const a = parse(args);
  switch (name) {
    case "get_procedure":
      return `Fiche ${TOPICS[a.topic] ?? a.topic}`;
    case "simulate_loan":
      return `Simulation : ${a.amount} € sur ${a.months} mois`;
    case "start_request":
      return `Demande : ${REQUESTS[a.kind] ?? a.kind}`;
    case "transfer_to_advisor":
      return "Transfert vers un conseiller";
    default:
      return name;
  }
}

function describeResult(output: string): string | null {
  const r = parse(output);
  if (r.reference) return `${r.request} · n° ${r.reference}`;
  if (r.ticket) return `${r.team} · ${r.when} · n° ${r.ticket}`;
  if (r.monthly_payment_eur) return `Simulation : ${r.monthly_payment_eur} € par mois`;
  return null;
}

function savedPushToTalk(): boolean {
  try {
    return localStorage.getItem("pushToTalk") === "1";
  } catch {
    return false;
  }
}

export default function App() {
  const [phase, setPhase] = useState<"idle" | "connecting" | "live">("idle");
  const [notice, setNotice] = useState("Touchez « Appeler » pour parler à votre assistant.");
  const [turn, setTurn] = useState<Turn>("listening");
  const [messages, setMessages] = useState<Message[]>([]);
  const [pushToTalk, setPushToTalk] = useState(savedPushToTalk);
  const [talking, setTalking] = useState(false);

  const call = useRef<Call | null>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const responding = useRef(false);
  const speaking = useRef(false);
  const wakeLock = useRef<WakeLockSentinel | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Adds a message, or replaces / extends the one with the same id.
  function upsert(id: string, role: Message["role"], text: string, append = false) {
    setMessages((list) => {
      const i = list.findIndex((m) => m.id === id);
      if (i < 0) return [...list, { id, role, text }];
      const copy = [...list];
      copy[i] = { ...copy[i], text: append ? copy[i].text + text : text };
      return copy;
    });
  }

  function remove(id: string) {
    setMessages((list) => list.filter((m) => m.id !== id));
  }

  function onEvent(e: ServerEvent) {
    switch (e.type) {
      case "input_audio_buffer.speech_started":
        setTurn("user");
        break;
      case "input_audio_buffer.speech_stopped":
        setTurn("thinking");
        break;
      case "input_audio_buffer.committed":
        upsert(e.item_id, "user", "…"); // placeholder: keeps the order of the turns
        break;
      case "conversation.item.input_audio_transcription.completed":
        if (e.transcript.trim()) upsert(e.item_id, "user", e.transcript.trim());
        else remove(e.item_id);
        break;
      case "response.created":
        responding.current = true;
        break;
      case "response.output_audio_transcript.delta":
        upsert(e.item_id, "assistant", e.delta, true);
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
      case "response.done": {
        responding.current = false;
        const calls = e.response.output.filter(
          (item: ServerEvent) => item.type === "function_call",
        );
        for (const c of calls) upsert(c.call_id, "action", describeCall(c.name, c.arguments));
        if (calls.length) setTurn("thinking");
        break;
      }
      case "conversation.item.done": // the server's tool results, when they reach us
        if (e.item.type === "function_call_output") {
          const text = describeResult(e.item.output);
          if (text) upsert(e.item.call_id, "action", text);
        }
        break;
      case "error":
        if (!HARMLESS_ERRORS.includes(e.error?.code)) {
          console.warn("Realtime error", e.error);
          upsert(crypto.randomUUID(), "action", `Erreur : ${e.error?.message}`);
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
    setMessages([]);
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
          : "En ligne. Parlez quand vous voulez, vous pouvez couper la parole à l'assistant.",
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

  // Push-to-talk: "Parler" interrupts the assistant and opens the mic, "Envoyer" sends.
  function talk() {
    const c = call.current!;
    if (speaking.current) c.send({ type: "output_audio_buffer.clear" });
    if (responding.current) c.send({ type: "response.cancel" });
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

  function togglePushToTalk(on: boolean) {
    setPushToTalk(on);
    try {
      localStorage.setItem("pushToTalk", on ? "1" : "0");
    } catch {
      /* private browsing: not remembered */
    }
  }

  return (
    <main className="app">
      <header>
        <h1>Assistant bancaire vocal</h1>
        <p className="subtitle">Réclamation, code perdu, crédit, épargne.</p>
      </header>

      <p className="notice" role="status" aria-live="polite">
        {notice}
      </p>

      <section className="transcript" aria-label="Conversation">
        {messages.map((m) => (
          <p key={m.id} className={`message ${m.role}`}>
            {m.role === "user" && <span className="who">Vous</span>}
            {m.role === "assistant" && <span className="who">Assistant</span>}
            {m.text}
          </p>
        ))}
        <div ref={bottom} />
      </section>

      <footer>
        {phase === "live" && (
          <p className={`turn ${turn}`} aria-hidden="true">
            {TURN_LABELS[turn]}
          </p>
        )}

        {phase !== "live" && (
          <>
            <label className="toggle">
              <input
                type="checkbox"
                checked={pushToTalk}
                onChange={(e) => togglePushToTalk(e.target.checked)}
              />
              Pièce bruyante : je touche « Parler » puis « Envoyer »
            </label>
            <button className="big call" onClick={dial} disabled={phase === "connecting"}>
              {phase === "connecting" ? "Connexion…" : "Appeler"}
            </button>
          </>
        )}

        {phase === "live" && pushToTalk && (
          <button className={`big talk ${talking ? "on" : ""}`} onClick={talking ? sendTurn : talk}>
            {talking ? "Envoyer" : "Parler"}
          </button>
        )}
        {phase === "live" && (
          <button
            className={`big hangup ${pushToTalk ? "small" : ""}`}
            onClick={() => call.current?.hangUp()}
          >
            Raccrocher
          </button>
        )}
      </footer>

      <audio ref={audio} autoPlay playsInline />
    </main>
  );
}
