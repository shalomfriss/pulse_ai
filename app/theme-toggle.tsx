"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const current = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    setTheme(current);
  }, []);

  const dark = theme === "dark";

  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      aria-pressed={dark}
      title={dark ? "Use light mode" : "Use dark mode"}
      onClick={() => {
        const next: Theme = dark ? "light" : "dark";
        setTheme(next);
        applyTheme(next);
        try { window.localStorage.setItem("pulse-theme", next); } catch { /* Preference remains active for this page. */ }
      }}
    >
      <span aria-hidden="true">{dark ? "☀" : "☾"}</span>
      <b>{dark ? "LIGHT" : "DARK"}</b>
    </button>
  );
}
