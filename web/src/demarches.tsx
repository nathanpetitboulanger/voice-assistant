import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Demarche } from "./tools";

// The démarches done with the assistant on this device. No login: they stay in this
// browser, for as long as the server keeps their recap PDFs (RECAP_LIFETIME).
const LIFETIME = 24 * 3600 * 1000;

function fresh(list: Demarche[]): Demarche[] {
  return list.filter((d) => Date.now() - d.at < LIFETIME);
}

function load(): Demarche[] {
  try {
    const saved = JSON.parse(localStorage.getItem("demarches") ?? "[]");
    return Array.isArray(saved) ? fresh(saved) : [];
  } catch {
    return [];
  }
}

type Value = {
  demarches: Demarche[]; // newest first
  add: (demarche: Demarche) => void;
  clear: () => void;
};

const DemarchesContext = createContext<Value | null>(null);

export function DemarchesProvider({ children }: { children: ReactNode }) {
  const [demarches, setDemarches] = useState(load);

  useEffect(() => {
    try {
      localStorage.setItem("demarches", JSON.stringify(demarches));
    } catch {
      /* kept for this visit only */
    }
  }, [demarches]);

  const add = (demarche: Demarche) =>
    setDemarches((list) => [
      demarche,
      ...fresh(list).filter((d) => d.reference !== demarche.reference),
    ]);
  const clear = () => setDemarches([]);
  return <DemarchesContext value={{ demarches, add, clear }}>{children}</DemarchesContext>;
}

export function useDemarches(): Value {
  return useContext(DemarchesContext)!;
}
