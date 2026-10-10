import { useState } from "react";
import {
  ArrowRight,
  Calculator,
  CalendarClock,
  Check,
  ClipboardList,
  Copy,
  CreditCard,
  Download,
  KeyRound,
  Lock,
  MessageSquareWarning,
  Trash2,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { useDemarches } from "../demarches";
import type { Demarche } from "../tools";
import { Footer } from "./Footer";

const ICONS: Record<string, LucideIcon> = {
  card_block: CreditCard,
  pin_reissue: KeyRound,
  password_reset: Lock,
  appointment: CalendarClock,
  loan: Calculator,
  complaint: MessageSquareWarning,
  transfer: UserRound,
};

function when(at: number): string {
  const time = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(at);
  const today = new Date().toDateString() === new Date(at).toDateString();
  return today ? `Aujourd'hui à ${time}` : `Hier à ${time}`; // kept 24 hours at most
}

function DemarcheCard({ demarche }: { demarche: Demarche }) {
  const [copied, setCopied] = useState(false);
  const Icon = ICONS[demarche.kind] ?? ClipboardList;

  async function copy() {
    try {
      await navigator.clipboard.writeText(demarche.reference);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* no clipboard (HTTP, or refused): the number stays on screen */
    }
  }

  return (
    <li className="card demarche">
      <span className="topic-icon">
        <Icon aria-hidden="true" />
      </span>
      <div className="demarche-body">
        <h2>{demarche.title}</h2>
        <p className="demarche-meta">
          {when(demarche.at)} · {demarche.mode === "voice" ? "à la voix" : "par écrit"}
        </p>
        <p className="reference">
          <span className="reference-label">Référence</span>
          <span className="reference-number">{demarche.reference}</span>
        </p>
        <p>{demarche.detail}</p>
        <div className="demarche-actions">
          <button className="btn secondary small" onClick={copy}>
            {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
            {copied ? "Référence copiée" : "Copier la référence"}
          </button>
          {demarche.pdf && (
            <a className="btn primary small" href={demarche.pdf.url} download={demarche.pdf.name}>
              <Download aria-hidden="true" />
              Récapitulatif PDF
            </a>
          )}
        </div>
      </div>
    </li>
  );
}

type Props = { onAssistant: () => void };

export function Demarches({ onAssistant }: Props) {
  const { demarches, clear } = useDemarches();
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="page" data-route="demarches">
      <div className="container narrow">
        <header className="page-head">
          <h1 tabIndex={-1}>Mes démarches</h1>
          <p className="lead">
            Ce que l'assistant a fait pour vous sur cet appareil. Sans compte, elles restent
            dans ce navigateur, 24 heures, comme les récapitulatifs PDF.
          </p>
        </header>

        {demarches.length === 0 ? (
          <div className="card empty">
            <ClipboardList aria-hidden="true" />
            <h2>Aucune démarche pour l'instant</h2>
            <p>
              Une opposition, une simulation de crédit transmise, une réclamation : vous les
              retrouverez ici, avec leur numéro de référence.
            </p>
            <button className="btn primary" onClick={onAssistant}>
              Parler à l'assistant
              <ArrowRight aria-hidden="true" />
            </button>
          </div>
        ) : (
          <>
            <ul className="demarches">
              {demarches.map((d) => (
                <DemarcheCard key={d.reference} demarche={d} />
              ))}
            </ul>
            <div className="clear-row">
              {confirming ? (
                <>
                  <span>Effacer toutes les démarches de cet appareil ?</span>
                  <button
                    className="btn danger small"
                    onClick={() => {
                      clear();
                      setConfirming(false);
                    }}
                  >
                    Oui, tout effacer
                  </button>
                  <button className="btn ghost small" onClick={() => setConfirming(false)}>
                    Annuler
                  </button>
                </>
              ) : (
                <button className="btn ghost small" onClick={() => setConfirming(true)}>
                  <Trash2 aria-hidden="true" />
                  Tout effacer
                </button>
              )}
            </div>
          </>
        )}
      </div>
      <Footer />
    </div>
  );
}
