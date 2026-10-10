import { useCallback, useEffect, useRef, useState } from "react";
import {
  Accessibility as AccessibilityIcon,
  AudioLines,
  ClipboardList,
  House,
  MessageSquareText,
  type LucideIcon,
} from "lucide-react";
import { Assistant, type Intent } from "./assistant/Assistant";
import { useDemarches } from "./demarches";
import { Accessibility } from "./pages/Accessibility";
import { Demarches } from "./pages/Demarches";
import { Home } from "./pages/Home";
import { BRAND } from "./site";

type Route = "accueil" | "assistant" | "demarches" | "accessibilite";

const ROUTES: { route: Route; label: string; icon: LucideIcon }[] = [
  { route: "accueil", label: "Accueil", icon: House },
  { route: "assistant", label: "Assistant", icon: MessageSquareText },
  { route: "demarches", label: "Mes démarches", icon: ClipboardList },
  { route: "accessibilite", label: "Accessibilité", icon: AccessibilityIcon },
];

// Hash routes (#/assistant): the server only serves index.html at /.
function currentRoute(): Route {
  const name = location.hash.replace(/^#\/?/, "");
  return ROUTES.find((r) => r.route === name)?.route ?? "accueil";
}

function go(route: Route) {
  location.hash = `#/${route}`;
}

function BrandLink() {
  return (
    <a className="brand" href="#/accueil" aria-label={`${BRAND}, assistant : accueil`}>
      <span className="brand-mark" aria-hidden="true">
        <AudioLines />
      </span>
      <span className="brand-name" aria-hidden="true">
        {BRAND}
        <small>Assistant</small>
      </span>
      <span className="demo-pill" aria-hidden="true">
        Démo
      </span>
    </a>
  );
}

export default function App() {
  const [route, setRoute] = useState(currentRoute);
  const [intent, setIntent] = useState<Intent | null>(null);
  const [live, setLive] = useState(false); // a call is on: shown everywhere
  const { demarches } = useDemarches();
  const main = useRef<HTMLElement>(null);
  const intents = useRef(0);
  const first = useRef(true);

  useEffect(() => {
    const onHash = () => setRoute(currentRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // A new page: back to the top, title, and the screen reader's focus on its heading.
  useEffect(() => {
    const label = ROUTES.find((r) => r.route === route)!.label;
    document.title = `${label} · ${BRAND} Assistant (démo)`;
    if (first.current) {
      first.current = false;
      return;
    }
    if (main.current) main.current.scrollTop = 0;
    document.querySelector<HTMLElement>(`[data-route="${route}"] h1`)?.focus();
  }, [route]);

  const openAssistant = (request: Omit<Intent, "id">) => {
    setIntent({ ...request, id: ++intents.current });
    go("assistant");
  };
  const onLiveChange = useCallback((on: boolean) => setLive(on), []);

  const navLinks = (className: string) =>
    ROUTES.map(({ route: r, label, icon: Icon }) => (
      <a
        key={r}
        href={`#/${r}`}
        className={className}
        aria-current={route === r ? "page" : undefined}
      >
        <Icon aria-hidden="true" />
        <span>{label}</span>
        {r === "demarches" && demarches.length > 0 && (
          <span className="badge">
            <span className="sr-only">(</span>
            {demarches.length}
            <span className="sr-only">)</span>
          </span>
        )}
      </a>
    ));

  return (
    <div className="shell">
      <button className="skip-link" onClick={() => main.current?.focus()}>
        Aller au contenu
      </button>
      <header className="topbar">
        <div className="container topbar-inner">
          <BrandLink />
          <nav className="topnav" aria-label="Menu principal">
            {navLinks("topnav-link")}
          </nav>
        </div>
      </header>

      <main ref={main} className={`main route-${route}`} tabIndex={-1}>
        {route === "accueil" && (
          <Home onAssistant={openAssistant} onAccessibility={() => go("accessibilite")} />
        )}
        {route === "demarches" && <Demarches onAssistant={() => openAssistant({ mode: "voice" })} />}
        {route === "accessibilite" && <Accessibility />}
        {/* Always there, hidden on the other pages: a call or a chat goes on meanwhile. */}
        <Assistant hidden={route !== "assistant"} intent={intent} onLiveChange={onLiveChange} />
      </main>

      {route !== "assistant" && (
        <a className={`fab ${live ? "live" : ""}`} href="#/assistant">
          <AudioLines aria-hidden="true" />
          {live ? "Appel en cours" : "Assistant"}
        </a>
      )}

      <nav className="tabbar" aria-label="Menu principal">
        {navLinks("tab")}
      </nav>
    </div>
  );
}
