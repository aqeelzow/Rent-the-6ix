// Safe to import from server components: no React here (layout.tsx inlines the script).

export const THEME_KEY = "rentkdubs-theme";
/** The key before the rename (#10): still read, so a saved pick survives. */
export const LEGACY_THEME_KEY = "rt6-theme";

/**
 * Runs in <head> before first paint so a dark page never flashes light. Kept tiny and
 * self-contained: it can't import anything.
 */
export const themeScript = `(function(){try{var t=localStorage.getItem("${THEME_KEY}")||localStorage.getItem("${LEGACY_THEME_KEY}");var d=t?t==="dark":matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.classList.toggle("dark",d);document.documentElement.style.colorScheme=d?"dark":"light"}catch(e){}})()`;
