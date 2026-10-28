"use client";

import { useSyncExternalStore } from "react";

type Theme = "light" | "dark";

const media = () => window.matchMedia("(prefers-color-scheme: dark)");

function current(): Theme {
  const set = document.documentElement.dataset.theme;
  if (set === "light" || set === "dark") return set;
  return media().matches ? "dark" : "light";
}

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  media().addEventListener("change", onChange);
  return () => {
    observer.disconnect();
    media().removeEventListener("change", onChange);
  };
}

export default function ThemeToggle() {
  const theme = useSyncExternalStore<Theme | null>(subscribe, current, () => null);

  const choose = (next: Theme) => {
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("theme", next);
    } catch {}
  };

  return (
    <div className="theme-toggle">
      <button aria-pressed={theme === "light"} onClick={() => choose("light")}>
        light
      </button>
      <span aria-hidden>/</span>
      <button aria-pressed={theme === "dark"} onClick={() => choose("dark")}>
        dark
      </button>
    </div>
  );
}
