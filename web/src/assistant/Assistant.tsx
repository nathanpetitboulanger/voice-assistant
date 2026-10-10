import { useCallback, useEffect, useState } from "react";
import { Keyboard, Mic } from "lucide-react";
import { useDemarches } from "../demarches";
import { useSettings } from "../settings";
import type { Demarche, Mode } from "../tools";
import { ChatMode } from "./ChatMode";
import { VoiceMode } from "./VoiceMode";

// What the rest of the site asks of the assistant: call, or ask a question in writing.
export type Intent = { id: number; mode: Mode; message?: string };

type Props = {
  hidden: boolean;
  intent: Intent | null;
  onLiveChange: (live: boolean) => void;
};

export function Assistant({ hidden, intent, onLiveChange }: Props) {
  const { settings } = useSettings();
  const { add } = useDemarches();
  const [mode, setMode] = useState<Mode>(settings.mode);
  const [live, setLive] = useState(false); // a call is on, or starting
  const [dialSignal, setDialSignal] = useState(0);
  const [chatRequest, setChatRequest] = useState<{ id: number; text: string } | null>(null);

  // The preferred mode, when changed in « Accessibilité » outside a call.
  useEffect(() => {
    if (!live) setMode(settings.mode);
  }, [settings.mode]);

  useEffect(() => {
    if (!intent) return;
    if (live) {
      setMode("voice"); // during a call, the page just shows the call
      return;
    }
    setMode(intent.mode);
    if (intent.mode === "voice") setDialSignal(intent.id);
    else if (intent.message) setChatRequest({ id: intent.id, text: intent.message });
  }, [intent]);

  const onVoiceLive = useCallback(
    (on: boolean) => {
      setLive(on);
      onLiveChange(on);
    },
    [onLiveChange],
  );

  const addFrom = (from: Mode) => (demarche: Omit<Demarche, "at" | "mode">) =>
    add({ ...demarche, at: Date.now(), mode: from });

  return (
    <section className="assistant" hidden={hidden} aria-labelledby="assistant-title" data-route="assistant">
      <div className="assistant-head">
        <div>
          <h1 id="assistant-title" tabIndex={-1}>
            Votre assistant
          </h1>
          <p className="lead">Réclamation, carte ou code perdu, crédit, épargne.</p>
        </div>
        <div className="segmented" role="group" aria-label="Mode de l'assistant">
          <button aria-pressed={mode === "voice"} onClick={() => setMode("voice")}>
            <Mic aria-hidden="true" />
            Voix
          </button>
          <button
            aria-pressed={mode === "text"}
            onClick={() => setMode("text")}
            disabled={live}
            title={live ? "Raccrochez pour passer à l'écrit" : undefined}
          >
            <Keyboard aria-hidden="true" />
            Écrit
          </button>
        </div>
      </div>

      <div className="assistant-body" hidden={mode !== "voice"}>
        <VoiceMode
          visible={!hidden && mode === "voice"}
          dialSignal={dialSignal}
          onLiveChange={onVoiceLive}
          onDemarche={addFrom("voice")}
        />
      </div>
      <div className="assistant-body" hidden={mode !== "text"}>
        <ChatMode
          visible={!hidden && mode === "text"}
          request={chatRequest}
          onDemarche={addFrom("text")}
        />
      </div>
    </section>
  );
}
