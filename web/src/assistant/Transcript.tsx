import { useCallback, useState } from "react";
import { AudioLines, Calculator, ClipboardList, Download, TriangleAlert } from "lucide-react";
import { duration, euros, percent, type Loan, type Message, type Recap } from "../tools";

let lastId = 0;
/** An id for the page's own messages (crypto.randomUUID needs HTTPS). */
export function localId(): string {
  return `local-${++lastId}`;
}

/** The messages of one conversation, in order. */
export function useMessages() {
  const [messages, setMessages] = useState<Message[]>([]);

  // Adds a message, or replaces the one with the same id, in place.
  const put = useCallback((message: Message) => {
    setMessages((list) => {
      const i = list.findIndex((m) => m.id === message.id);
      if (i < 0) return [...list, message];
      const copy = [...list];
      copy[i] = message;
      return copy;
    });
  }, []);

  // Adds text to a message as it is spoken or written.
  const append = useCallback((id: string, role: "user" | "assistant", text: string) => {
    setMessages((list) => {
      const i = list.findIndex((m) => m.id === id);
      if (i < 0) return [...list, { id, role, text }];
      const message = list[i];
      if (!("text" in message)) return list;
      const copy = [...list];
      copy[i] = { ...message, text: message.text + text };
      return copy;
    });
  }, []);

  const remove = useCallback((id: string) => {
    setMessages((list) => list.filter((m) => m.id !== id));
  }, []);

  const clear = useCallback(() => setMessages([]), []);

  return { messages, put, append, remove, clear };
}

export function Avatar() {
  return (
    <span className="avatar" aria-hidden="true">
      <AudioLines />
    </span>
  );
}

function LoanCard({ loan }: { loan: Loan }) {
  const consumer = loan.purpose !== "prêt immobilier";
  // under_35_percent: false when the payment is over the bank's limit (MAX_DEBT_RATIO)
  const tooHigh = Object.entries(loan).some(
    ([key, value]) => /^under_\d+_percent$/.test(key) && value === false,
  );
  const purpose = loan.purpose.charAt(0).toUpperCase() + loan.purpose.slice(1);
  return (
    <article className="loan-card" aria-label={`Simulation : ${purpose}`}>
      <p className="loan-kicker">
        <Calculator aria-hidden="true" /> Simulation · {purpose}
      </p>
      <p className="loan-payment">
        <strong>{euros(loan.monthly_payment_eur)}</strong> par mois
      </p>
      <dl className="loan-figures">
        <div>
          <dt>Montant</dt>
          <dd>{euros(loan.amount_eur)}</dd>
        </div>
        <div>
          <dt>Durée</dt>
          <dd>{duration(loan.months)}</dd>
        </div>
        <div>
          <dt>{consumer ? "TAEG fixe" : "Taux indicatif hors assurance"}</dt>
          <dd>{percent(loan.annual_rate_percent)}</dd>
        </div>
        <div>
          <dt>Coût des intérêts</dt>
          <dd>{euros(loan.total_interest_eur)}</dd>
        </div>
        <div className={tooHigh ? "warn" : undefined}>
          <dt>Part de vos revenus</dt>
          <dd>
            {tooHigh && <TriangleAlert aria-hidden="true" />}
            {percent(loan.debt_ratio_percent)}
          </dd>
        </div>
      </dl>
      {consumer && (
        <p className="loan-legal">
          Un crédit vous engage et doit être remboursé. Vérifiez vos capacités de
          remboursement avant de vous engager.
        </p>
      )}
      <p className="loan-note">Simulation indicative et sans engagement, taux de démonstration.</p>
    </article>
  );
}

export function RecapLink({ recap, big = false }: { recap: Recap; big?: boolean }) {
  return (
    <a className={`recap-link ${big ? "big" : ""}`} href={recap.url} download={recap.name}>
      <Download aria-hidden="true" />
      <span>
        Télécharger le récapitulatif {recap.label}
        <small>PDF accessible, disponible 24 heures</small>
      </span>
    </a>
  );
}

export function MessageView({ message }: { message: Message }) {
  switch (message.role) {
    case "user":
      return (
        <p className="msg user">
          <span className="sr-only">Vous : </span>
          {message.text}
        </p>
      );
    case "assistant":
      return (
        <div className="msg-row">
          <Avatar />
          <p className="msg assistant">
            <span className="sr-only">Assistant : </span>
            {message.text}
          </p>
        </div>
      );
    case "action":
      return (
        <p className="chip-action">
          <ClipboardList aria-hidden="true" />
          {message.text}
        </p>
      );
    case "error":
      return (
        <p className="chip-error">
          <TriangleAlert aria-hidden="true" />
          {message.text}
        </p>
      );
    case "loan":
      return <LoanCard loan={message.loan} />;
    case "recap":
      return <RecapLink recap={message.recap} />;
  }
}
