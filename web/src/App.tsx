import { useEffect } from "react"
import { AppShell } from "@/components/shell/app-shell"
import { AccountsScreen } from "@/components/screens/accounts"
import { CardsScreen } from "@/components/screens/cards"
import { DemarchesScreen } from "@/components/screens/demarches"
import { HomeScreen } from "@/components/screens/home"
import { OperationsScreen } from "@/components/screens/operations"
import { ProfileScreen } from "@/components/screens/profile"
import { useLocation } from "@/lib/router"

const SCREENS: Record<string, { title: string; screen: () => React.ReactNode }> = {
  "/": { title: "Accueil", screen: HomeScreen },
  "/comptes": { title: "Mes comptes", screen: AccountsScreen },
  "/operations": { title: "Opérations", screen: OperationsScreen },
  "/cartes": { title: "Mes cartes", screen: CardsScreen },
  "/demarches": { title: "Mes démarches", screen: DemarchesScreen },
  "/profil": { title: "Profil", screen: ProfileScreen },
}

export default function App() {
  const { pathname } = useLocation()
  const route = SCREENS[pathname.replace(/\/+$/, "") || "/"] ?? SCREENS["/"]

  useEffect(() => {
    document.title = `${route.title} · Compass (démo)`
  }, [route])

  return (
    <AppShell>
      <route.screen />
    </AppShell>
  )
}
