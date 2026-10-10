import {
  CalculatorIcon, CalendarClockIcon, CheckIcon, ChevronRightIcon, CircleAlertIcon, CircleCheckIcon, ClockIcon, CreditCardIcon, DownloadIcon,
  KeyRoundIcon, LoaderCircleIcon, LockIcon, MessageSquareWarningIcon, TriangleAlertIcon, UserRoundIcon,
} from "lucide-react"
import { duration, euros, percent } from "@/lib/format"
import { navigate } from "@/lib/router"
import { useCompass, type UIMessage } from "@/lib/store"
import type { AssistantCard, Demarche, Loan } from "@/lib/types"
import { cn } from "@/lib/utils"

const box = "hc-outline rounded-2xl bg-white p-3 ring-1 ring-line"

export const DEMARCHE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  card_block: CreditCardIcon,
  pin_reissue: KeyRoundIcon,
  password_reset: LockIcon,
  appointment: CalendarClockIcon,
  loan: CalculatorIcon,
  complaint: MessageSquareWarningIcon,
  transfer: UserRoundIcon,
}

/** A chip per tool call: running, done, waiting for the customer's yes, or not done. */
export function ToolChips({ m, dark = false }: { m: UIMessage; dark?: boolean }) {
  if (!m.tools.length) return null
  return (
    <ul className="mb-2 flex flex-wrap gap-1.5" aria-label="Actions de Compass">
      {m.tools.map((t) => (
        <li
          key={t.id}
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-bold",
            t.status === "running" && (dark ? "bg-white/10 text-white/70" : "bg-surface text-muted-ink"),
            t.status === "ok" && "bg-ok-soft text-ok",
            t.status === "waiting" && "bg-info-soft text-navy",
            t.status === "error" && "bg-warn-soft text-warn",
          )}
        >
          {t.status === "running" ? (
            <LoaderCircleIcon className="size-3 animate-spin" aria-hidden />
          ) : t.status === "ok" ? (
            <CheckIcon className="size-3" aria-hidden />
          ) : t.status === "waiting" ? (
            <ClockIcon className="size-3" aria-hidden />
          ) : (
            <CircleAlertIcon className="size-3" aria-hidden />
          )}
          {t.label}
          {t.status === "error" && <span className="sr-only"> : pas abouti</span>}
        </li>
      ))}
    </ul>
  )
}

export function AssistantCardView({ card }: { card: AssistantCard }) {
  switch (card.kind) {
    case "loan":
      return <LoanCard loan={card.loan} />
    case "demarche":
      return <DemarcheCard demarche={card.demarche} />
  }
}

function LoanCard({ loan }: { loan: Loan }) {
  const consumer = loan.purpose !== "prêt immobilier"
  // under_35_percent: false when the payment is over the bank's limit (MAX_DEBT_RATIO)
  const tooHigh = Object.entries(loan).some(([key, value]) => /^under_\d+_percent$/.test(key) && value === false)
  const purpose = loan.purpose.charAt(0).toUpperCase() + loan.purpose.slice(1)
  const rows: [string, string][] = [
    ["Montant", euros(loan.amount_eur)],
    ["Durée", duration(loan.months)],
    [consumer ? "TAEG fixe" : "Taux indicatif hors assurance", percent(loan.annual_rate_percent)],
    ["Coût des intérêts", euros(loan.total_interest_eur)],
  ]
  return (
    <article className={cn(box, "flex flex-col gap-2.5")} aria-label={`Simulation : ${purpose}`}>
      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-ink">
        <CalculatorIcon className="size-3.5" aria-hidden /> Simulation · {purpose}
      </p>
      <p className="text-navy">
        <span className="tabular text-2xl font-extrabold">{euros(loan.monthly_payment_eur)}</span> <span className="text-sm font-semibold text-muted-ink">par mois</span>
      </p>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-xl bg-surface p-2.5 text-xs">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-muted-ink">{label}</dt>
            <dd className="tabular font-bold text-navy">{value}</dd>
          </div>
        ))}
        <div className={tooHigh ? "text-warn" : undefined}>
          <dt className={tooHigh ? undefined : "text-muted-ink"}>Part de vos revenus</dt>
          <dd className={cn("tabular flex items-center gap-1 font-bold", !tooHigh && "text-navy")}>
            {tooHigh && <TriangleAlertIcon className="size-3.5" aria-hidden />}
            {percent(loan.debt_ratio_percent)}
          </dd>
        </div>
      </dl>
      {consumer && (
        <p className="text-[11px] font-semibold text-navy">
          Un crédit vous engage et doit être remboursé. Vérifiez vos capacités de remboursement avant de vous engager.
        </p>
      )}
      <p className="text-[11px] text-muted-ink">Simulation indicative et sans engagement, taux de démonstration.</p>
    </article>
  )
}

/** The recap PDF to download: kept 24 hours on the server, like the démarche here. */
export function RecapButton({ pdf, className }: { pdf: NonNullable<Demarche["pdf"]>; className?: string }) {
  return (
    <a href={pdf.url} download={pdf.name} className={cn("flex min-h-11 items-center justify-center gap-2 rounded-xl bg-navy px-3 py-2 text-sm font-bold text-white hover:bg-navy-2", className)}>
      <DownloadIcon className="size-4 shrink-0" aria-hidden />
      <span className="text-left leading-tight">
        Récapitulatif PDF
        <span className="block text-[10.5px] font-semibold opacity-75">Accessible, disponible 24 heures</span>
      </span>
    </a>
  )
}

function DemarcheCard({ demarche }: { demarche: Demarche }) {
  const Icon = DEMARCHE_ICONS[demarche.kind] ?? CircleCheckIcon
  return (
    <article className={cn(box, "flex flex-col gap-2.5 ring-2 ring-ok/25")} aria-label={`${demarche.title}, référence ${demarche.reference}`}>
      <p className="flex items-center gap-2 text-sm font-extrabold text-navy">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-ok-soft text-ok">
          <Icon className="size-4" aria-hidden />
        </span>
        {demarche.title}
      </p>
      <p className="flex items-baseline justify-between gap-2 rounded-xl bg-surface px-3 py-2">
        <span className="text-[11px] font-bold uppercase tracking-wide text-muted-ink">Référence</span>
        <span className="tabular text-base font-extrabold tracking-wide text-navy">{demarche.reference}</span>
      </p>
      <p className="text-xs leading-snug text-navy">{demarche.detail}</p>
      {demarche.pdf && <RecapButton pdf={demarche.pdf} />}
      <button
        type="button"
        onClick={() => {
          navigate(`/demarches?ref=${encodeURIComponent(demarche.reference)}`)
          useCompass.getState().setSheet("peek")
        }}
        className="flex items-center justify-center gap-1 rounded-xl py-1.5 text-xs font-bold text-brand hover:bg-brand-soft"
      >
        Voir dans mes démarches <ChevronRightIcon className="size-3.5" aria-hidden />
      </button>
    </article>
  )
}
