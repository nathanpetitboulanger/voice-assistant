// What the page shows of the assistant's tools (bank_tools.py), in both modes: a chip
// per tool call, the loan simulation as a card, the recap PDFs, and the démarches.

export type ServerEvent = { type: string; [key: string]: any };

export type Loan = {
  purpose: string;
  amount_eur: number;
  months: number;
  annual_rate_percent: number;
  monthly_payment_eur: number;
  total_interest_eur: number;
  debt_ratio_percent: number;
  [key: string]: any;
};

export type Recap = { url: string; name: string; label: string };

export type Message =
  | { id: string; role: "user" | "assistant" | "action" | "error"; text: string }
  | { id: string; role: "loan"; loan: Loan }
  | { id: string; role: "recap"; recap: Recap };

export type Mode = "voice" | "text";

// A démarche done with the assistant, kept on this device (see demarches.tsx). Nothing
// personal: no income, age or complaint facts.
export type Demarche = {
  reference: string;
  kind: string; // start_request's kind, or loan, complaint, transfer
  title: string;
  detail: string;
  pdf?: { url: string; name: string };
  at: number; // Date.now()
  mode: Mode;
};

// Labels of bank_tools.py's enums, kept in sync with it.
const TOPICS: Record<string, string> = {
  code_perdu: "Code perdu",
  credit: "Crédit",
  gestion_privee: "Gestion privée",
  reclamation: "Réclamation",
};

const REQUESTS: Record<string, string> = {
  card_block: "opposition sur la carte",
  pin_reissue: "réédition du code",
  password_reset: "nouveau mot de passe",
  appointment: "rendez-vous",
};

const PURPOSES: Record<string, string> = {
  pret_personnel: "Prêt personnel",
  pret_auto: "Prêt auto",
  pret_travaux: "Prêt travaux",
  renovation_energetique: "Rénovation énergétique",
  pret_immobilier: "Prêt immobilier",
};

const REASONS: Record<string, string> = {
  operation_non_reconnue: "Opération non reconnue",
  prelevement: "Prélèvement contesté",
  frais: "Frais bancaires contestés",
  virement: "Problème de virement",
  qualite_service: "Qualité de service",
  autre: "Autre motif",
};

const PRODUCTS: Record<string, string> = {
  carte: "carte bancaire",
  compte: "compte courant",
  credit: "crédit",
  epargne: "épargne ou placement",
  assurance: "assurance",
  application: "application ou banque en ligne",
  agence: "agence ou conseiller",
};

// The recap PDFs to download, by the tool that makes them.
const RECAPS: Record<string, { label: string; file: string }> = {
  send_loan_to_advisor: { label: "du crédit", file: "credit" },
  send_complaint: { label: "de la réclamation", file: "reclamation" },
};

// Errors that just mean "nothing to cancel" or "nothing said" in push-to-talk.
export const HARMLESS_ERRORS = [
  "response_cancel_not_active",
  "input_audio_buffer_commit_empty",
];

export function parse(json: string) {
  try {
    return JSON.parse(json || "{}");
  } catch {
    return {};
  }
}

/** 10000 -> "10 000 €", 229.36 -> "229,36 €". */
export function euros(amount: number): string {
  const cents = Math.round(amount * 100) % 100 !== 0;
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  }).format(amount);
}

/** 4.9 -> "4,9 %". */
export function percent(value: number): string {
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(value)} %`;
}

/** 48 -> "48 mois (4 ans)". */
export function duration(months: number): string {
  if (months % 12) return `${months} mois`;
  const years = months / 12;
  return `${months} mois (${years} an${years > 1 ? "s" : ""})`;
}

function describeCall(name: string, a: any): string {
  switch (name) {
    case "get_procedure":
      return `Fiche ${TOPICS[a.topic] ?? a.topic}`;
    case "simulate_loan":
      return `Simulation : ${euros(Number(a.amount))} sur ${a.months} mois`;
    case "send_loan_to_advisor":
      return "Transmission au conseiller crédit";
    case "send_complaint":
      return "Transmission de la réclamation";
    case "start_request":
      return `Demande : ${REQUESTS[a.kind] ?? a.kind}`;
    case "transfer_to_advisor":
      return "Transfert vers un conseiller";
    default:
      return name;
  }
}

function describeResult(r: any): string | null {
  if (r.reference) return `${r.request} · n° ${r.reference}`;
  if (r.ticket) return `${r.team} · ${r.when} · n° ${r.ticket}`;
  return null;
}

function toDemarche(
  name: string,
  a: any,
  r: any,
  lastLoan: Loan | null,
  pdf: Demarche["pdf"],
): Omit<Demarche, "at" | "mode"> | null {
  switch (name) {
    case "start_request":
      if (!r.reference) return null;
      return { reference: r.reference, kind: a.kind, title: r.request, detail: r.next_steps };
    case "send_loan_to_advisor": {
      if (!r.reference) return null;
      let detail = `${PURPOSES[a.purpose] ?? a.purpose} : ${euros(Number(a.amount))} sur ${a.months} mois`;
      if (lastLoan && lastLoan.amount_eur === Number(a.amount) && lastLoan.months === Number(a.months)) {
        detail += `, ${euros(lastLoan.monthly_payment_eur)} par mois`;
      }
      detail += `. ${r.advisor} : ${r.when}.`;
      return { reference: r.reference, kind: "loan", title: r.request, detail, pdf };
    }
    case "send_complaint":
      if (!r.reference) return null;
      return {
        reference: r.reference,
        kind: "complaint",
        title: r.request,
        detail: `${REASONS[a.reason] ?? a.reason}, ${PRODUCTS[a.product] ?? a.product}. Traitée dans les meilleurs délais.`,
        pdf,
      };
    case "transfer_to_advisor":
      if (!r.ticket) return null;
      return {
        reference: r.ticket,
        kind: "transfer",
        title: `Mise en relation : ${r.team}`,
        detail: `${r.when.charAt(0).toUpperCase()}${r.when.slice(1)}.`,
      };
    default:
      return null;
  }
}

type Show = {
  /** Adds a message, or replaces the one with the same id (in place). */
  put: (message: Message) => void;
  onRecap: (tool: string, recap: Recap) => void;
  onDemarche: (demarche: Omit<Demarche, "at" | "mode">) => void;
};

/** Follows the tool calls of one conversation (voice call or text chat). */
export class ToolTracker {
  private calls = new Map<string, { name: string; args: any }>(); // by call_id
  private lastLoan: Loan | null = null;

  constructor(private show: Show) {}

  reset() {
    this.calls.clear();
    this.lastLoan = null;
  }

  /** response.done: a chip per tool call. Returns whether the model called any. */
  onResponseDone(response: ServerEvent): boolean {
    const calls = response.output.filter((item: ServerEvent) => item.type === "function_call");
    for (const c of calls) {
      const args = parse(c.arguments);
      this.calls.set(c.call_id, { name: c.name, args });
      this.show.put({ id: c.call_id, role: "action", text: describeCall(c.name, args) });
    }
    return calls.length > 0;
  }

  /** conversation.item.done: the server's tool results, when they reach the page. */
  onItemDone(item: ServerEvent) {
    if (item.type !== "function_call_output") return;
    const call = this.calls.get(item.call_id);
    if (!call) return;
    const result = parse(item.output);
    if (call.name === "simulate_loan" && result.monthly_payment_eur) {
      this.lastLoan = result;
      this.show.put({ id: item.call_id, role: "loan", loan: result }); // replaces the chip
      return;
    }
    const text = describeResult(result);
    if (text) this.show.put({ id: item.call_id, role: "action", text });
    let pdf: Demarche["pdf"];
    if (result.pdf && RECAPS[call.name]) {
      const { label, file } = RECAPS[call.name];
      pdf = {
        url: `/api/recaps/${result.pdf}`,
        name: `recapitulatif-${file}-${result.reference.replaceAll(" ", "-")}.pdf`,
      };
      const recap = { ...pdf, label };
      this.show.put({ id: `${item.call_id}:recap`, role: "recap", recap });
      this.show.onRecap(call.name, recap);
    }
    const demarche = toDemarche(call.name, call.args, result, this.lastLoan, pdf);
    if (demarche) this.show.onDemarche(demarche);
  }
}
