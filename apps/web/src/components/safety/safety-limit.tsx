"use client";

import { useId, useRef, useState } from "react";
import { t, type MessageKey } from "@/lib/format/messages";

const s = (key: string, params?: Record<string, string | number>) =>
  t(`results.safetyLimit.${key}` as MessageKey, params);

// Slider positions in tenths of the city rate: 0.5× to 2.0×, then "No limit" (ranking only).
const MIN = 5;
const MAX = 20;
const NO_LIMIT = MAX + 1;
/** Arrow keys step one tenth per press; wait for a pause before re-running the search. */
const KEY_PAUSE_MS = 500;
/** Where 1.0× (the city rate) falls along the track, in percent. */
const CITY_AT = ((10 - MIN) / (NO_LIMIT - MIN)) * 100;
const oneDecimal = new Intl.NumberFormat("en-CA", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** "0.8" for a relative rate, as the slider and chips show it. */
export function formatRelativeRate(rate: number): string {
  return oneDecimal.format(rate);
}

const fromPosition = (position: number) => (position === NO_LIMIT ? null : position / 10);

/**
 * The safety limit: keep only neighbourhoods at most this many times the city's police-reported
 * rate (SPEC 7.6), or "No limit" so safety only changes the ranking. A native range input, so
 * screen readers hear "0.8× the city rate" rather than a bare number.
 */
export function SafetyLimit({
  value,
  onChange,
  commitOnRelease = false,
}: {
  /** null = no limit (a preference); a number = the must-have's maximum relative rate. */
  value: number | null;
  onChange: (value: number | null) => void;
  /** Report only when the slider is let go (where each change re-runs a search). */
  commitOnRelease?: boolean;
}) {
  const id = useId();
  const [local, setLocal] = useState(value);
  // Follow changes made elsewhere (a reset, a chip removed) while the slider is on screen.
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    setLocal(value);
  }
  const keyTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const position = local === null ? NO_LIMIT : Math.min(MAX, Math.max(MIN, Math.round(local * 10)));
  const text = local === null ? s("none") : s("value", { rate: formatRelativeRate(local) });
  const commit = (next: number | null) => {
    clearTimeout(keyTimer.current);
    if (commitOnRelease && next !== value) onChange(next);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium">
          {s("label")}
        </label>
        <output htmlFor={id} className="figures text-sm font-medium">
          {text}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={MIN}
        max={NO_LIMIT}
        step={1}
        value={position}
        aria-valuetext={text}
        onChange={(event) => {
          const next = fromPosition(Number(event.target.value));
          setLocal(next);
          if (!commitOnRelease) onChange(next);
        }}
        onPointerUp={(event) => commit(fromPosition(Number(event.currentTarget.value)))}
        onKeyUp={(event) => {
          const next = fromPosition(Number(event.currentTarget.value));
          clearTimeout(keyTimer.current);
          keyTimer.current = setTimeout(() => commit(next), KEY_PAUSE_MS);
        }}
        onBlur={() => commit(local)}
        className="accent-primary h-6 w-full cursor-pointer"
      />
      <div aria-hidden className="text-muted-foreground figures relative h-4 text-xs">
        <span className="absolute left-0">{formatRelativeRate(MIN / 10)}×</span>
        {/* The city rate (1.0×) sits where it falls on the track, not in the middle. */}
        <span className="absolute -translate-x-1/2" style={{ left: `${CITY_AT}%` }}>
          {formatRelativeRate(1)}× {s("city")}
        </span>
        <span className="absolute right-0">{s("none")}</span>
      </div>
      <p className="text-muted-foreground text-xs">{s("help")}</p>
    </div>
  );
}
