// What the page shows of the assistant's tools (bank_tools.py), in both modes: a chip
// per tool call, the loan simulation and the démarches as cards (with their recap PDF),
// « Mes démarches », the demo panel's log, and the app responding: after a card block,
// the Cartes screen shows the card as opposed.

import { toast } from "@/components/shell/toast"
import { addDemarche } from "./demarches"
import { euros } from "./format"
import { navigate } from "./router"
import { patchMessage, useCompass, type ToolChip } from "./store"
import type { Demarche, Loan, Mode, TraceEvent } from "./types"

export type ServerEvent = { type: string; [key: string]: any }
type Args = Record<string, any>

// Labels of bank_tools.py's enums, kept in sync with it.
const TOPICS: Record<string, string> = {
  code_perdu: "Code perdu",
  credit: "Crédit",
  gestion_privee: "Gestion privée",
  reclamation: "Réclamation",
}

const REQUESTS: Record<string, string> = {
  card_block: "opposition sur la carte",
  pin_reissue: "réédition du code",
  password_reset: "nouveau mot de passe",
  appointment: "rendez-vous",
}

const PURPOSES: Record<string, string> = {
  pret_personnel: "Prêt personnel",
  pret_auto: "Prêt auto",
  pret_travaux: "Prêt travaux",
  renovation_energetique: "Rénovation énergétique",
  pret_immobilier: "Prêt immobilier",
}

const REASONS: Record<string, string> = {
  operation_non_reconnue: "Opération non reconnue",
  prelevement: "Prélèvement contesté",
  frais: "Frais bancaires contestés",
  virement: "Problème de virement",
  qualite_service: "Qualité de service",
  autre: "Autre motif",
}

const PRODUCTS: Record<string, string> = {
  carte: "carte bancaire",
  compte: "compte courant",
  credit: "crédit",
  epargne: "épargne ou placement",
  assurance: "assurance",
  application: "application ou banque en ligne",
  agence: "agence ou conseiller",
}

// The recap PDFs to download, by the tool that makes them.
const RECAPS: Record<string, string> = {
  send_loan_to_advisor: "credit",
  send_complaint: "reclamation",
}

// Errors that just mean "nothing to cancel" or "nothing said" in push-to-talk.
export const HARMLESS_ERRORS = ["response_cancel_not_active", "input_audio_buffer_commit_empty"]

export function parse(json: string): Args {
  try {
    return JSON.parse(json || "{}")
  } catch {
    return {}
  }
}

function describeCall(name: string, a: Args): string {
  switch (name) {
    case "get_procedure":
      return `Fiche ${TOPICS[a.topic] ?? a.topic}`
    case "simulate_loan":
      return `Simulation : ${euros(Number(a.amount))} sur ${a.months} mois`
    case "send_loan_to_advisor":
      return "Transmission au conseiller crédit"
    case "send_complaint":
      return "Transmission de la réclamation"
    case "start_request":
      return `Demande : ${REQUESTS[a.kind] ?? a.kind}`
    case "transfer_to_advisor":
      return "Mise en relation avec un conseiller"
    default:
      return name
  }
}

/** One line for the demo panel: what the back office receives, or why it didn't. */
function describeOutcome(name: string, r: Args): string {
  if (r.error) return r.error
  if (r.not_done) return "Attend le oui du client avant de bloquer la carte."
  if (r.reference) return `${r.request} · ${r.reference}`
  if (r.ticket) return `${r.team} · ${r.when} · ${r.ticket}`
  if (r.monthly_payment_eur) return `${euros(r.monthly_payment_eur)} par mois, taux ${r.annual_rate_percent} %`
  if (r.source) return r.say_word_for_word ?? `Lu : ${r.source}`
  return name
}

function toDemarche(name: string, a: Args, r: Args, lastLoan: Loan | null, pdf: Demarche["pdf"]): Omit<Demarche, "at" | "mode"> | null {
  switch (name) {
    case "start_request":
      if (!r.reference) return null
      return { reference: r.reference, kind: a.kind, title: r.request, detail: r.next_steps }
    case "send_loan_to_advisor": {
      if (!r.reference) return null
      let detail = `${PURPOSES[a.purpose] ?? a.purpose} : ${euros(Number(a.amount))} sur ${a.months} mois`
      if (lastLoan && lastLoan.amount_eur === Number(a.amount) && lastLoan.months === Number(a.months)) {
        detail += `, ${euros(lastLoan.monthly_payment_eur)} par mois`
      }
      detail += `. ${r.advisor} : ${r.when}.`
      return { reference: r.reference, kind: "loan", title: r.request, detail, pdf }
    }
    case "send_complaint":
      if (!r.reference) return null
      return {
        reference: r.reference,
        kind: "complaint",
        title: r.request,
        detail: `${REASONS[a.reason] ?? a.reason}, ${PRODUCTS[a.product] ?? a.product}. Traitée dans les meilleurs délais.`,
        pdf,
      }
    case "transfer_to_advisor":
      if (!r.ticket) return null
      return {
        reference: r.ticket,
        kind: "transfer",
        title: `Mise en relation : ${r.team}`,
        detail: `${r.when.charAt(0).toUpperCase()}${r.when.slice(1)}.`,
      }
    default:
      return null
  }
}

function trace(event: TraceEvent) {
  useCompass.setState((s) => ({ trace: [event, ...s.trace.filter((t) => t.id !== event.id)].slice(0, 40) }))
}

/** Lets the customer see the app respond: the right screen, highlighted. */
function showInApp(demarche: Demarche) {
  toast(`${demarche.title} · n° ${demarche.reference}`)
  if (demarche.kind === "card_block") {
    navigate("/cartes")
    setTimeout(() => useCompass.getState().setHighlight("card-status"), 350)
    // The card changes on screen: tuck the assistant away so it shows.
    setTimeout(() => {
      if (useCompass.getState().sheet === "open") useCompass.getState().setSheet("peek")
    }, 650)
    return
  }
  // Behind the conversation, highlighted: there when the customer closes it.
  navigate(`/demarches?ref=${encodeURIComponent(demarche.reference)}`)
}

/** Follows the tool calls of one conversation (voice call or written chat). The server
 * runs them: the page only sees the calls (response.done) and their results
 * (conversation.item.done). */
export class ToolTracker {
  private calls = new Map<string, { name: string; args: Args; messageId: string }>() // by call_id
  private lastLoan: Loan | null = null

  constructor(private mode: Mode) {}

  reset() {
    this.calls.clear()
    this.lastLoan = null
  }

  /** A chip per tool call, on the turn's message. Returns whether the model called any. */
  onResponseDone(response: ServerEvent, turnMessage: () => string): boolean {
    const calls = (response.output ?? []).filter((item: ServerEvent) => item.type === "function_call")
    if (!calls.length) return false
    const messageId = turnMessage()
    for (const c of calls) {
      const args = parse(c.arguments)
      const label = describeCall(c.name, args)
      this.calls.set(c.call_id, { name: c.name, args, messageId })
      const chip: ToolChip = { id: c.call_id, name: c.name, label, status: "running" }
      patchMessage(messageId, (m) => ({ ...m, tools: [...m.tools, chip] }))
      const detail = Object.entries(args)
        .map(([k, v]) => `${k}: ${v}`)
        .join(" · ")
      trace({ id: c.call_id, at: Date.now(), channel: this.mode, name: c.name, label, outcome: "running", detail })
    }
    return true
  }

  onItemDone(item: ServerEvent) {
    if (item.type !== "function_call_output") return
    const call = this.calls.get(item.call_id)
    if (!call) return
    const { name, args, messageId } = call
    const result = parse(item.output)
    const status: ToolChip["status"] = result.error ? "error" : result.not_done ? "waiting" : "ok"
    const label = status === "waiting" ? "Opposition : en attente de votre accord" : describeCall(name, args)
    patchMessage(messageId, (m) => ({ ...m, tools: m.tools.map((t) => (t.id === item.call_id ? { ...t, label, status } : t)) }))
    trace({ id: item.call_id, at: Date.now(), channel: this.mode, name, label, outcome: status, detail: describeOutcome(name, result) })

    if (name === "simulate_loan" && result.monthly_payment_eur) {
      this.lastLoan = result as Loan
      patchMessage(messageId, (m) => ({ ...m, cards: [...m.cards, { kind: "loan", loan: result as Loan }] }))
      return
    }
    let pdf: Demarche["pdf"]
    if (result.pdf && RECAPS[name]) {
      pdf = {
        url: `/api/recaps/${result.pdf}`,
        name: `recapitulatif-${RECAPS[name]}-${String(result.reference).replaceAll(" ", "-")}.pdf`,
      }
    }
    const found = toDemarche(name, args, result, this.lastLoan, pdf)
    if (!found) return
    const demarche: Demarche = { ...found, at: Date.now(), mode: this.mode }
    addDemarche(demarche)
    patchMessage(messageId, (m) => ({ ...m, cards: [...m.cards, { kind: "demarche", demarche }] }))
    showInApp(demarche)
  }
}
