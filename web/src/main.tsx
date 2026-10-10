import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/ubuntu/latin-400.css";
import "@fontsource/ubuntu/latin-500.css";
import "@fontsource/ubuntu/latin-700.css";
import App from "./App";
import { DemarchesProvider } from "./demarches";
import { SettingsProvider } from "./settings";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SettingsProvider>
      <DemarchesProvider>
        <App />
      </DemarchesProvider>
    </SettingsProvider>
  </StrictMode>,
);
