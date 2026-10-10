import { create } from "zustand"
import type { Demarche } from "./types"

// The démarches done with the assistant on this device. No login: they stay in this
// browser, for as long as the server keeps their recap PDFs (RECAP_LIFETIME).
const LIFETIME = 24 * 3600 * 1000

function fresh(list: Demarche[]): Demarche[] {
  return list.filter((d) => Date.now() - d.at < LIFETIME)
}

function load(): Demarche[] {
  try {
    const saved = JSON.parse(localStorage.getItem("demarches") ?? "[]")
    return Array.isArray(saved) ? fresh(saved) : []
  } catch {
    return []
  }
}

export const useDemarches = create<{ demarches: Demarche[] }>(() => ({ demarches: load() })) // newest first

function save(demarches: Demarche[]) {
  useDemarches.setState({ demarches })
  try {
    localStorage.setItem("demarches", JSON.stringify(demarches))
  } catch {
    /* kept for this visit only */
  }
}

export function addDemarche(demarche: Demarche) {
  save([demarche, ...fresh(useDemarches.getState().demarches).filter((d) => d.reference !== demarche.reference)])
}

export function clearDemarches() {
  save([])
}
