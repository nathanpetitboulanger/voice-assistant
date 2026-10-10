import { useEffect, useRef, useState } from "react";
import { RotateCcw, Send, Square } from "lucide-react";
import { openChat, type Chat } from "../chat";
import { SUGGESTIONS } from "../site";
import { HARMLESS_ERRORS, ToolTracker, type Demarche, type ServerEvent } from "../tools";
import { Avatar, MessageView, localId, useMessages } from "./Transcript";

type Status = "idle" | "connecting" | "open" | "ended" | "failed";

const STATUS_LABELS: Record<Status, string> = {
  idle: "",
  connecting: "Connexion…",
  open: "En ligne",
  ended: "Conversation terminée",
  failed: "Hors ligne",
};

type Props = {
  visible: boolean;
  request: { id: number; text: string } | null; // a question to ask (from the home page)
  onDemarche: (demarche: Omit<Demarche, "at" | "mode">) => void;
};

export function ChatMode({ visible, request, onDemarche }: Props) {
  const [status, setStatus] = useState<Status>("idle");
  // Waiting for the assistant: from a message until its answer, tool calls included.
  const [busy, setBusy] = useState(false);
  const [writing, setWriting] = useState(false); // its answer is coming in
  const [draft, setDraft] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const { messages, put, append, clear } = useMessages();

  const chat = useRef<Chat | null>(null);
  const queue = useRef<string[]>([]); // questions to ask once the assistant is free
  const responding = useRef(false);
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const latest = useRef({ onDemarche });
  latest.current = { onDemarche };
  const tools = useRef<ToolTracker>(null);
  tools.current ??= new ToolTracker({
    put,
    onRecap: () => {}, // shown in the conversation, and in « Mes démarches »
    onDemarche: (demarche) => latest.current.onDemarche(demarche),
  });

  // Opens the chat the first time it is shown.
  useEffect(() => {
    if (visible && status === "idle" && !chat.current) connect();
  }, [visible, status]);

  useEffect(() => {
    if (!request) return;
    queue.current.push(request.text);
    if (!chat.current) connect(); // never opened, or over
  }, [request]);

  // Asks the queued questions, one at a time, once the greeting or the answer is over.
  useEffect(() => {
    if (status === "open" && !busy && queue.current.length) send(queue.current.shift()!);
  }, [status, busy, request]);

  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight });
  }, [messages, busy, visible]);

  // The text box grows with the message, up to a few lines.
  useEffect(() => {
    const box = input.current;
    if (!box) return;
    box.style.height = "auto";
    box.style.height = `${Math.min(box.scrollHeight, 160)}px`;
  }, [draft]);

  useEffect(
    () => () => {
      chat.current?.close();
      chat.current = null;
    },
    [],
  );

  function onEvent(e: ServerEvent) {
    switch (e.type) {
      case "response.created":
        responding.current = true;
        break;
      case "response.output_text.delta":
        setWriting(true);
        append(e.item_id, "assistant", e.delta);
        break;
      case "response.output_text.done":
        put({ id: e.item_id, role: "assistant", text: e.text });
        setWriting(false);
        // Screen readers read the whole answer once written, not each word.
        setAnnouncement(`L'assistant : ${e.text}`);
        break;
      case "response.done": {
        responding.current = false;
        setWriting(false);
        const calls = tools.current!.onResponseDone(e.response);
        // The server runs the tools, then asks for the answer: still waiting.
        if (!(calls && e.response.status === "completed")) setBusy(false);
        break;
      }
      case "conversation.item.done": // the server's tool results
        tools.current!.onItemDone(e.item);
        break;
      case "error":
        if (HARMLESS_ERRORS.includes(e.error?.code)) break;
        console.warn("Realtime error", e.error);
        put({ id: localId(), role: "error", text: `Erreur : ${e.error?.message}` });
        if (!responding.current) setBusy(false); // no answer is coming
        break;
    }
  }

  function connect() {
    chat.current?.close();
    clear();
    tools.current!.reset();
    responding.current = false;
    setWriting(false);
    setAnnouncement("");
    setStatus("connecting");
    setBusy(true); // the assistant says hi first
    chat.current = openChat({
      onOpen: () => setStatus("open"),
      onEvent,
      onEnd: (opened) => {
        chat.current = null;
        setStatus(opened ? "ended" : "failed");
        setBusy(false);
        setWriting(false);
      },
    });
  }

  function restart() {
    queue.current = [];
    connect();
  }

  function send(text: string) {
    put({ id: localId(), role: "user", text });
    chat.current!.send(text);
    setBusy(true);
  }

  function submit() {
    const text = draft.trim();
    if (!text || busy || status !== "open") return;
    send(text);
    setDraft("");
  }

  const asked = messages.some((m) => m.role === "user");
  const over = status === "ended" || status === "failed";

  return (
    <div className="chat">
      <div className="chat-bar">
        <p className={`chat-status ${status}`}>
          <span className="dot" aria-hidden="true" />
          {STATUS_LABELS[status]}
        </p>
        <button className="btn ghost small" onClick={restart} disabled={status === "connecting"}>
          <RotateCcw aria-hidden="true" />
          Nouvelle conversation
        </button>
      </div>

      <div className="transcript" ref={log} role="region" aria-label="Conversation">
        {messages.map((m) => (
          <MessageView key={m.id} message={m} />
        ))}
        {busy && !writing && !over && (
          <div className="msg-row" aria-hidden="true">
            <Avatar />
            <p className="msg assistant typing">
              <span />
              <span />
              <span />
            </p>
          </div>
        )}
        {status === "open" && !asked && !busy && (
          <div className="suggestions" role="group" aria-label="Suggestions">
            {SUGGESTIONS.map((text) => (
              <button key={text} className="chip" onClick={() => send(text)}>
                {text}
              </button>
            ))}
          </div>
        )}
        {over && (
          <div className="chat-over" role="status">
            <p>
              {status === "ended"
                ? "La conversation est terminée."
                : "Impossible de joindre l'assistant. Vérifiez votre connexion, puis réessayez."}
            </p>
            <button className="btn primary" onClick={restart}>
              <RotateCcw aria-hidden="true" />
              {status === "ended" ? "Nouvelle conversation" : "Réessayer"}
            </button>
          </div>
        )}
      </div>

      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label htmlFor="chat-input" className="sr-only">
          Votre message
        </label>
        <textarea
          id="chat-input"
          ref={input}
          rows={1}
          maxLength={2000}
          value={draft}
          placeholder="Écrivez votre question…"
          disabled={over}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
        />
        {busy && status === "open" ? (
          <button
            type="button"
            className="icon-button stop"
            onClick={() => chat.current?.cancel()}
            aria-label="Arrêter la réponse"
            title="Arrêter la réponse"
          >
            <Square aria-hidden="true" />
          </button>
        ) : (
          <button
            type="submit"
            className="icon-button send"
            disabled={!draft.trim() || status !== "open"}
            aria-label="Envoyer"
            title="Envoyer"
          >
            <Send aria-hidden="true" />
          </button>
        )}
      </form>
    </div>
  );
}
