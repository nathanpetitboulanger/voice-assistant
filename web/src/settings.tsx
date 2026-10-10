import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Mode } from "./tools";

// The visitor's display and assistant preferences, remembered on this device.
export type Settings = {
  textSize: "normal" | "large" | "xlarge";
  contrast: boolean;
  pushToTalk: boolean; // noisy room: « Parler » then « Envoyer », no voice detection
  mode: Mode; // the assistant's mode when opened from the menu
};

const DEFAULTS: Settings = { textSize: "normal", contrast: false, pushToTalk: false, mode: "voice" };

function load(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem("settings") ?? "{}");
    // The push-to-talk choice of the previous version of the page.
    const pushToTalk = localStorage.getItem("pushToTalk") === "1";
    return { ...DEFAULTS, pushToTalk, ...saved };
  } catch {
    return DEFAULTS; // private browsing, or storage blocked
  }
}

type Value = { settings: Settings; update: (change: Partial<Settings>) => void };

const SettingsContext = createContext<Value | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(load);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.textSize = settings.textSize;
    root.dataset.contrast = settings.contrast ? "high" : "normal";
    try {
      localStorage.setItem("settings", JSON.stringify(settings));
    } catch {
      /* not remembered */
    }
  }, [settings]);

  const update = (change: Partial<Settings>) => setSettings((s) => ({ ...s, ...change }));
  return <SettingsContext value={{ settings, update }}>{children}</SettingsContext>;
}

export function useSettings(): Value {
  return useContext(SettingsContext)!;
}
