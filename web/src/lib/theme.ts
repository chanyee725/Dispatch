import { useEffect } from "react";
import { setTheme, useApp, type ThemeChoice } from "@/store";

export type { ThemeChoice };

/**
 * Theme from the store (server prefs, shared by every project). Applies <html class="dark">,
 * mirrors the choice into localStorage for the no-flash script, and follows the OS on "system".
 */
export function useTheme(): [ThemeChoice, (t: ThemeChoice) => void] {
  const theme = useApp(s => s.prefs?.theme ?? "system");
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const root = document.documentElement;
      // "monitor" is a dark-first theme: it carries .dark (so dark: variants work) plus .monitor (its own tokens).
      root.classList.toggle("dark", theme === "dark" || theme === "monitor" || (theme === "system" && mq.matches));
      root.classList.toggle("monitor", theme === "monitor");
    };
    apply();
    try {
      if (theme === "system") localStorage.removeItem("dispatch-theme");
      else localStorage.setItem("dispatch-theme", theme);
    } catch {
      /* private mode */
    }
    if (theme !== "system") return;
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);
  return [theme, setTheme];
}
