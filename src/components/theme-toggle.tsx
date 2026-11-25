"use client";

import { useSyncExternalStore } from "react";

type Theme = "system" | "light" | "dark";
const EVENT = "spr-theme-change";

function read(): Theme {
  try {
    const t = localStorage.getItem("spr-theme");
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

function choose(t: Theme) {
  try {
    if (t === "system") {
      localStorage.removeItem("spr-theme");
      document.documentElement.removeAttribute("data-theme");
    } else {
      localStorage.setItem("spr-theme", t);
      document.documentElement.setAttribute("data-theme", t);
    }
  } catch {}
  window.dispatchEvent(new Event(EVENT));
}

export function ThemeToggle() {
  // localStorage is an external store; server snapshot is "system" to match prerendered HTML.
  const theme = useSyncExternalStore(subscribe, read, () => "system" as Theme);

  return (
    <div className="grid grid-cols-3 gap-1 rounded-2xl bg-surface-2 p-1" role="radiogroup" aria-label="Theme">
      {(["system", "light", "dark"] as const).map((t) => (
        <button
          key={t}
          role="radio"
          aria-checked={theme === t}
          onClick={() => choose(t)}
          className={`min-h-11 rounded-xl text-sm font-medium capitalize transition-colors ${
            theme === t ? "bg-text text-bg" : "text-muted"
          }`}
        >
          {t}
        </button>
      ))}
    </div>
  );
}
