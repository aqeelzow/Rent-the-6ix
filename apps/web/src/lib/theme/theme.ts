import { useSyncExternalStore } from "react";
import { THEME_KEY } from "./theme-script";

/**
 * Light or dark. The renter's pick is kept in localStorage; with no pick the site follows the
 * device setting. `.dark` on <html> switches the tokens in globals.css.
 */
export type Theme = "light" | "dark";

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Private windows can refuse storage; the theme still applies for this visit.
  }
}

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

/** The theme on screen now, kept in step with every toggle. Light on the server. */
export function useTheme(): Theme {
  return useSyncExternalStore(
    subscribe,
    () => (document.documentElement.classList.contains("dark") ? "dark" : "light"),
    () => "light",
  );
}
