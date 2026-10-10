// The page's types: the fictional customer (GET /api/customer, demo_customer.py), and
// what the assistant's tools (bank_tools.py) turn into on the page.

export type AccountType = "COMPTE_COURANT" | "LIVRET_A"
export type CardStatus = "ACTIVE" | "OPPOSED"
export type TxStatus = "COMPLETED" | "PENDING"

export interface Account {
  id: string
  type: AccountType
  label: string
  maskedIban: string
  balanceCents: number
  status: "OPEN" | "BLOCKED"
}

export interface Transaction {
  id: string
  accountId: string
  merchant: string
  label: string // raw bank statement label
  amountCents: number
  timestamp: string
  category: string
  status: TxStatus
  description: string
  channel: string
}

export interface Card {
  id: string
  accountId: string
  label: string
  kind: "PHYSICAL" | "VIRTUAL"
  network: "VISA" | "MASTERCARD"
  maskedNumber: string
  holder: string
  expiry: string
  status: CardStatus
  paymentLimitCents: number
  withdrawalLimitCents: number
  spentThisPeriodCents: number
  onlinePayments: boolean
  contactless: boolean
}

export interface CustomerData {
  customer: { firstName: string; displayName: string; initials: string }
  accounts: Account[]
  cards: Card[]
  transactions: Transaction[]
}

export type Mode = "voice" | "text"

// A loan simulation, as simulate_loan returns it.
export interface Loan {
  purpose: string
  amount_eur: number
  months: number
  annual_rate_percent: number
  monthly_payment_eur: number
  total_interest_eur: number
  debt_ratio_percent: number
  [key: string]: unknown
}

// A démarche done with the assistant, kept on this device (see demarches.ts). Nothing
// personal: no income, age or complaint facts.
export interface Demarche {
  reference: string
  kind: string // start_request's kind, or loan, complaint, transfer
  title: string
  detail: string
  pdf?: { url: string; name: string }
  at: number // Date.now()
  mode: Mode
}

/** Rich blocks shown in the conversation. */
export type AssistantCard = { kind: "loan"; loan: Loan } | { kind: "demarche"; demarche: Demarche }

// ---------------------------------------------------------------------------
// The app's pages, and what can be highlighted when the assistant's work shows on one.
// ---------------------------------------------------------------------------
export const APP_PAGES = {
  accueil: "/",
  comptes: "/comptes",
  operations: "/operations",
  cartes: "/cartes",
  demarches: "/demarches",
  profil: "/profil",
} as const
export type AppPage = keyof typeof APP_PAGES

export type Highlight = "balance" | "card-status" | "card-security" | "transaction" | "demarche" | "accessibility"

/** What the assistant did, for the demo panel's log. */
export interface TraceEvent {
  id: string // the tool call's call_id
  at: number
  channel: Mode
  name: string
  label: string
  outcome: "running" | "ok" | "waiting" | "error"
  detail: string
}
