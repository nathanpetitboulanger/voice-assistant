import { useEffect, useState } from "react"
import { KeyboardIcon, MicIcon, PlayIcon, RotateCcwIcon, ServerIcon, ShieldIcon, TerminalIcon } from "lucide-react"
import { closeChat } from "@/lib/chat"
import { askCompass } from "@/lib/compass"
import { useCustomer } from "@/lib/customer"
import { clearDemarches, useDemarches } from "@/lib/demarches"
import { navigate } from "@/lib/router"
import { useCompass } from "@/lib/store"
import { cn } from "@/lib/utils"
import { stopVoice, useVoice, voiceActive } from "@/lib/voice"

// DEMO ONLY. Rehearsal tool for the pitch, next to the phone on a large screen: the
// journeys to replay, and what the server's tools did (from the events the page sees).
// It is not part of the customer application.

const JOURNEYS = [
  {
    title: "A · Carte perdue",
    steps: ["J'ai perdu ma carte et quelqu'un a vu mon code.", "Oui, d'accord."],
    note: "Compass demande d'abord son oui (c'est définitif), puis l'écran Cartes montre l'opposition.",
  },
  {
    title: "B · Paiement inconnu",
    steps: ["Je ne reconnais pas un paiement de 89 euros sur ma carte, fait par internet avant-hier."],
    note: "Ou depuis Opérations, « Paiement inconnu ». Réclamation transmise, PDF dans Mes démarches.",
    open: "/operations?tx=tx_inconnu",
  },
  {
    title: "C · Crédit auto",
    steps: ["Je voudrais emprunter 10 000 euros pour une voiture sur 4 ans.", "Je gagne 2 500 euros nets par mois, j'ai 34 ans.", "Et sur 5 ans ?", "Transmettez-la à un conseiller."],
    note: "La simulation se refait à chaque changement ; la transmission donne un PDF.",
  },
  {
    title: "D · Épargne",
    steps: ["J'ai hérité de 800 000 euros, que faire de cet argent ?"],
    note: "Pas de conseil personnalisé : Compass explique, puis propose un conseiller.",
  },
]

const OUTCOME = {
  running: { label: "…", className: "bg-white/10 text-white/70" },
  ok: { label: "OK", className: "bg-[#16805d]/30 text-[#6ee7b7]" },
  waiting: { label: "ATTENTE", className: "bg-[#2f5cad]/40 text-[#bfdbfe]" },
  error: { label: "REFUS", className: "bg-[#b54708]/35 text-[#fcd34d]" },
}

export function DemoPanel() {
  const trace = useCompass((s) => s.trace)
  const chatStatus = useCompass((s) => s.chatStatus)
  const voiceStatus = useVoice((s) => s.status)
  const demarches = useDemarches((s) => s.demarches)
  const { data } = useCustomer()
  const [server, setServer] = useState<boolean | null>(null)

  useEffect(() => {
    fetch("/api/health")
      .then((r) => setServer(r.ok))
      .catch(() => setServer(false))
  }, [])

  const reset = () => {
    if (voiceActive()) stopVoice()
    useCompass.setState({ voice: false, sheet: "closed", trace: [] })
    closeChat(false)
    clearDemarches()
    navigate("/")
  }

  const card = data?.cards.find((c) => c.kind === "PHYSICAL")
  const tiles = [
    { icon: ServerIcon, label: "Serveur", ok: !!server, value: server === null ? "…" : server ? "FastAPI" : "injoignable" },
    { icon: KeyboardIcon, label: "Écrit", ok: chatStatus === "open", value: { idle: "fermé", connecting: "connexion", open: "en ligne", ended: "terminé", failed: "hors ligne" }[chatStatus] },
    { icon: MicIcon, label: "Voix", ok: voiceStatus !== "idle" && voiceStatus !== "error", value: voiceStatus === "idle" ? "raccroché" : voiceStatus === "error" ? "erreur" : "en appel" },
  ]

  return (
    <aside aria-label="Panneau de démonstration" className="hidden h-[min(844px,calc(100dvh-40px))] w-[380px] shrink-0 flex-col gap-3 overflow-hidden text-[13px] text-navy lg:flex">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-2 text-sm font-extrabold">
          <TerminalIcon className="size-4" aria-hidden /> Panneau de démonstration
        </p>
        <span className="rounded-md bg-brand px-2 py-0.5 text-[10px] font-extrabold tracking-wider text-white">DEMO ONLY</span>
      </div>

      <div className="no-scrollbar flex flex-1 flex-col gap-3 overflow-y-auto pb-2">
        <div className="grid grid-cols-3 gap-2">
          {tiles.map((r) => (
            <div key={r.label} className="rounded-2xl bg-white p-2.5 shadow-sm">
              <p className="flex items-center gap-1 text-[11px] font-bold text-muted-ink">
                <r.icon className="size-3.5" aria-hidden /> {r.label}
              </p>
              <p className={cn("truncate text-xs font-extrabold", r.ok ? "text-ok" : "text-muted-ink")} title={r.value}>
                {r.ok ? "● " : "○ "}
                {r.value}
              </p>
            </div>
          ))}
        </div>

        <div className="rounded-2xl bg-white p-3 shadow-sm">
          <button type="button" onClick={reset} className="flex h-9 w-full items-center justify-center gap-1 rounded-xl bg-brand text-xs font-extrabold text-white">
            <RotateCcwIcon className="size-3.5" aria-hidden /> Tout réinitialiser
          </button>
          <p className="mt-2 text-[11px] text-muted-ink">
            État : carte Visa <b>{card ? (card.status === "OPPOSED" ? "en opposition" : "active") : "…"}</b> · démarches <b>{demarches.length}</b>
          </p>
        </div>

        <div className="rounded-2xl bg-white p-3 shadow-sm">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted-ink">Parcours de démonstration</p>
          <div className="flex flex-col gap-2.5">
            {JOURNEYS.map((j) => (
              <div key={j.title}>
                <p className="flex items-center justify-between font-extrabold">
                  {j.title}
                  {j.open && (
                    <button type="button" onClick={() => navigate(j.open)} className="rounded-lg px-1.5 py-0.5 text-[11px] font-bold text-brand hover:bg-surface">
                      Ouvrir l&apos;opération
                    </button>
                  )}
                </p>
                <ul className="mt-1 flex flex-col gap-1">
                  {j.steps.map((s) => (
                    <li key={s}>
                      <button type="button" onClick={() => askCompass(s)} className="flex w-full items-start gap-1.5 rounded-lg px-1.5 py-1 text-left text-xs hover:bg-surface">
                        <PlayIcon className="mt-0.5 size-3 shrink-0 text-brand" aria-hidden />« {s} »
                      </button>
                    </li>
                  ))}
                </ul>
                <p className="px-1.5 text-[11px] text-muted-ink">{j.note}</p>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted-ink">Pendant un appel, la phrase touchée est posée dans l&apos;appel.</p>
        </div>

        <div className="flex min-h-56 flex-1 flex-col rounded-2xl bg-[#0d1524] p-3 text-white shadow-sm">
          <p className="mb-2 flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-white/60">
            <ShieldIcon className="size-3.5" aria-hidden /> Outils exécutés par le serveur (temps réel)
          </p>
          <ol className="no-scrollbar flex flex-1 flex-col gap-1.5 overflow-y-auto font-mono text-[11px]">
            {trace.map((t) => (
              <li key={t.id} className="leading-snug">
                <span className="text-white/40">{new Date(t.at).toLocaleTimeString("fr-FR")}</span>{" "}
                <span className={cn("rounded px-1 font-bold", OUTCOME[t.outcome].className)}>{OUTCOME[t.outcome].label}</span>{" "}
                <span className="text-white/50">[{t.channel === "voice" ? "voix" : "écrit"}]</span> <span className="font-bold">{t.name}</span> <span className="text-white/60">{t.detail}</span>
              </li>
            ))}
            {!trace.length && <li className="text-white/40">En attente d&apos;activité…</li>}
          </ol>
        </div>
      </div>
    </aside>
  )
}
