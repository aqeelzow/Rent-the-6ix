"use client";

import { Moon, Sun } from "lucide-react";
import { t } from "@/lib/format/messages";
import { applyTheme, useTheme } from "@/lib/theme/theme";

/** Switches between light and dark; the icon shows the mode it switches to. */
export function ThemeToggle() {
  const theme = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  const Icon = theme === "dark" ? Sun : Moon;
  return (
    <button
      type="button"
      onClick={() => applyTheme(next)}
      aria-label={t(next === "dark" ? "layout.theme.toDark" : "layout.theme.toLight")}
      title={t(next === "dark" ? "layout.theme.toDark" : "layout.theme.toLight")}
      className="text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring/50 grid size-10 place-items-center rounded-md outline-none focus-visible:ring-3"
    >
      <Icon aria-hidden className="size-5" />
    </button>
  );
}
