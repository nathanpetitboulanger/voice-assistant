import { useEffect } from "react"
import { create } from "zustand"
import { useDemarches } from "./demarches"
import type { CustomerData } from "./types"

// The fictional customer the screens show (GET /api/customer, the same for everyone),
// plus what the assistant did in this browser: after a card block (opposition), the
// physical card shows as opposed, for as long as the démarche is kept.

const useStore = create<{ data: CustomerData | null; error: boolean; loading: boolean }>(() => ({
  data: null,
  error: false,
  loading: false,
}))

async function load() {
  if (useStore.getState().loading) return
  useStore.setState({ loading: true, error: false })
  try {
    const res = await fetch("/api/customer")
    if (!res.ok) throw new Error(String(res.status))
    useStore.setState({ data: await res.json() })
  } catch {
    useStore.setState({ error: true })
  } finally {
    useStore.setState({ loading: false })
  }
}

export function useCustomer() {
  const { data, error } = useStore()
  const opposition = useDemarches((s) => s.demarches.find((d) => d.kind === "card_block"))
  useEffect(() => {
    if (!useStore.getState().data) void load()
  }, [])
  if (!data) return { data: null, error, retry: load, opposition }
  const cards = data.cards.map((c) => (opposition && c.kind === "PHYSICAL" ? { ...c, status: "OPPOSED" as const } : c))
  return { data: { ...data, cards }, error, retry: load, opposition }
}
