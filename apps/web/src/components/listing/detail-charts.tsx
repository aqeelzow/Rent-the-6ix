"use client";

import { useEffect, useRef, useState } from "react";
import { travelAdvice } from "@rentthe6ix/shared/engine/travel";
import { modeIcons } from "@/components/mode-icons";
import { t, type MessageKey } from "@/lib/format/messages";
import { formatCad, formatCount } from "@/lib/format/number";
import type { SearchResultItem } from "@/lib/store/types";
import type { ModeTime, TargetTravel } from "./detail-data";

// Charts for the listing dashboard. Plain SVG and HTML; every value they draw is also written
// out (direct labels, the comparables table), so nothing is read from colour or shape alone.

const l = (key: string, params?: Record<string, string | number>) =>
  t(`listing.${key}` as MessageKey, params);
const decimal = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 1 });
const km = (metres: number) => decimal.format(metres / 1000);
const compactCad = (value: number) =>
  value >= 1000 ? `$${decimal.format(value / 1000)}K` : formatCad(value);

type Valuation = SearchResultItem["valuation"];

/** Clean tick values across [min, max]. */
function ticks(min: number, max: number, count = 5): number[] {
  const raw = (max - min) / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) out.push(v);
  return out;
}

/**
 * Where this rent sits among similar listings: each comparable's rent on this listing's terms as
 * a dot, the typical range as a band, the estimate as a line, and this listing as the marked dot.
 */
export function PricePosition({ valuation, rent }: { valuation: Valuation; rent: number }) {
  const [active, setActive] = useState<number | null>(null);
  // Draw at the container's real width so labels keep their size on phones.
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(720);
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(280, Math.round(entry.contentRect.width))),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const comparables = valuation.comparables;
  const values = [
    rent,
    ...comparables.map((c) => c.adjustedRentCad),
    ...(valuation.lowCad ? [valuation.lowCad] : []),
    ...(valuation.highCad ? [valuation.highCad] : []),
  ];
  const span = Math.max(...values) - Math.min(...values) || 500;
  const min = Math.min(...values) - span * 0.08;
  const max = Math.max(...values) + span * 0.08;

  const W = width;
  const R = 5;
  const padX = 16;
  const x = (v: number) => padX + ((v - min) / (max - min)) * (W - padX * 2);

  // Stack dots that would overlap into rows (a simple beeswarm).
  const rowsEnd: number[] = [];
  const placed = comparables
    .map((c, index) => ({ c, index, cx: x(c.adjustedRentCad) }))
    .sort((a, b) => a.cx - b.cx)
    .map((dot) => {
      let row = rowsEnd.findIndex((end) => dot.cx - end > R * 2 + 3);
      if (row === -1) row = rowsEnd.length;
      rowsEnd[row] = dot.cx;
      return { ...dot, row };
    });
  const rowCount = Math.max(1, rowsEnd.length);
  const top = 34;
  const dotsH = rowCount * (R * 2 + 3);
  const axisY = top + dotsH + 16;
  const H = axisY + 26;
  const rowY = (row: number) => top + dotsH - R - row * (R * 2 + 3);
  const hovered = active === null ? null : comparables[active];

  return (
    <figure className="flex flex-col gap-2">
      <div ref={frame} className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          role="img"
          aria-label={l("chart.priceAria", {
            rent: formatCad(rent),
            count: formatCount(comparables.length),
          })}
        >
          {valuation.lowCad && valuation.highCad && (
            <rect
              x={x(valuation.lowCad)}
              y={top - 8}
              width={x(valuation.highCad) - x(valuation.lowCad)}
              height={axisY - top + 8}
              className="fill-primary/10"
              rx="4"
            />
          )}
          <line
            x1={padX}
            x2={W - padX}
            y1={axisY}
            y2={axisY}
            className="stroke-border"
            strokeWidth="1"
          />
          {ticks(min, max, W < 480 ? 3 : 5).map((v) => (
            <text
              key={v}
              x={x(v)}
              y={axisY + 18}
              textAnchor="middle"
              className="fill-muted-foreground figures text-[11px]"
            >
              {compactCad(v)}
            </text>
          ))}
          {valuation.estimatedRentCad && (
            <g>
              <line
                x1={x(valuation.estimatedRentCad)}
                x2={x(valuation.estimatedRentCad)}
                y1={top - 8}
                y2={axisY}
                className="stroke-foreground"
                strokeWidth="2"
                strokeLinecap="round"
              />
              <text
                x={x(valuation.estimatedRentCad)}
                y={top - 14}
                textAnchor="middle"
                className="fill-foreground text-[11px] font-medium"
              >
                {l("chart.estimate", { value: formatCad(valuation.estimatedRentCad) })}
              </text>
            </g>
          )}
          {placed.map(({ c, index, cx, row }) => (
            <circle
              key={c.listingId}
              cx={cx}
              cy={rowY(row)}
              r={active === index ? R + 2 : R}
              className="fill-score-safety stroke-card cursor-default"
              strokeWidth="2"
              onPointerEnter={() => setActive(index)}
              onPointerLeave={() => setActive(null)}
            />
          ))}
          <g>
            <line
              x1={x(rent)}
              x2={x(rent)}
              y1={top - 4}
              y2={axisY}
              className="stroke-primary"
              strokeWidth="2"
              strokeDasharray="0"
            />
            <circle
              cx={x(rent)}
              cy={axisY}
              r="7"
              className="fill-primary stroke-card"
              strokeWidth="2"
            />
          </g>
        </svg>
        {hovered && (
          <div
            className="bg-popover text-popover-foreground figures pointer-events-none absolute top-0 rounded-md border px-2 py-1 text-xs shadow-sm"
            style={{
              left: `${(x(hovered.adjustedRentCad) / W) * 100}%`,
              transform: "translateX(-50%)",
            }}
          >
            {l("chart.comparableTip", {
              adjusted: formatCad(hovered.adjustedRentCad),
              rent: formatCad(hovered.rentCad),
              km: km(hovered.distanceM),
            })}
          </div>
        )}
      </div>
      <figcaption className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="bg-primary size-3 rounded-full" />
          {l("chart.thisListing", { value: formatCad(rent) })}
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="bg-score-safety size-2.5 rounded-full" />
          {l("chart.similar")}
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="bg-primary/10 h-3 w-5 rounded-sm" />
          {valuation.lowCad && valuation.highCad
            ? l("chart.rangeValue", {
                low: formatCad(valuation.lowCad),
                high: formatCad(valuation.highCad),
              })
            : l("chart.range")}
        </span>
      </figcaption>
    </figure>
  );
}

/**
 * Adjustments that bring similar listings onto this listing's terms: bars grow left (cheaper)
 * or right (dearer) from a zero line, with the signed amount at the tip.
 */
export function AdjustmentBars({ adjustments }: { adjustments: Valuation["adjustments"] }) {
  const largest = Math.max(...adjustments.map((a) => Math.abs(a.amountCad)), 1);
  return (
    <ul className="figures flex flex-col gap-2 text-sm">
      {adjustments.map((adjustment) => {
        const share = (Math.abs(adjustment.amountCad) / largest) * 50;
        const up = adjustment.amountCad > 0;
        return (
          <li key={adjustment.label} className="flex flex-col gap-1">
            <span>{adjustment.label}</span>
            <div className="relative flex h-3 items-center">
              <span aria-hidden className="bg-border absolute left-1/2 h-full w-px" />
              <span
                aria-hidden
                className={`absolute h-2.5 ${up ? "bg-score-home left-1/2 rounded-r" : "bg-score-price right-1/2 rounded-l"}`}
                style={{ width: `${share}%` }}
              />
            </div>
            <span className={`text-muted-foreground text-xs ${up ? "text-right" : ""}`}>
              {up ? "+" : "−"}
              {formatCad(Math.abs(adjustment.amountCad))}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

const partStroke = {
  value: "stroke-score-value",
  price: "stroke-score-price",
  travel: "stroke-score-travel",
  home: "stroke-score-home",
  safety: "stroke-score-safety",
} as const;

/**
 * The match score as a half-ring: one arc per part, each as long as the points it adds, so the
 * filled arc reads as the total. The part names and points sit in the legend under it.
 */
export function ScoreGauge({
  total,
  parts,
}: {
  total: number;
  parts: { id: keyof typeof partStroke; points: number }[];
}) {
  // A semicircle path measured as 100 units, so arc lengths are points out of 100.
  const arc = "M 16 104 A 88 88 0 0 1 192 104";
  // Each arc starts where the parts before it end.
  const starts = parts.map((_, index) =>
    parts.slice(0, index).reduce((sum, part) => sum + part.points, 0),
  );
  return (
    <svg viewBox="0 0 208 116" className="w-full max-w-64" aria-hidden>
      <path d={arc} pathLength={100} fill="none" strokeWidth="14" className="stroke-muted" />
      {parts.map((part, index) => {
        const from = starts[index];
        // A 1-unit gap between arcs keeps neighbouring colours apart.
        const length = Math.max(0, part.points - 1);
        return (
          <path
            key={part.id}
            d={arc}
            pathLength={100}
            fill="none"
            strokeWidth="14"
            strokeDasharray={`${length} 100`}
            strokeDashoffset={-from}
            className={partStroke[part.id]}
          />
        );
      })}
      <text
        x="104"
        y="92"
        textAnchor="middle"
        className="fill-foreground figures text-[44px] font-semibold"
      >
        {total}
      </text>
      <text x="104" y="112" textAnchor="middle" className="fill-muted-foreground text-[11px]">
        {l("stats.scoreOutOf")}
      </text>
    </svg>
  );
}

/** Where the rent sits against the typical range: a track from low to high with a marker. */
export function RangeBar({ low, high, rent }: { low: number; high: number; rent: number }) {
  const min = Math.min(low, rent);
  const max = Math.max(high, rent);
  const span = max - min || 1;
  const at = (v: number) => `${((v - min) / span) * 100}%`;
  return (
    <div aria-hidden className="relative mt-1 h-2.5 rounded-full bg-black/10">
      <span
        className="bg-foreground/35 absolute inset-y-0 rounded-full"
        style={{ left: at(low), width: `${((high - low) / span) * 100}%` }}
      />
      <span
        className="bg-foreground absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white"
        style={{ left: at(rent) }}
      />
    </div>
  );
}

export function modeTimeText(time: ModeTime): string {
  if (time.kind === "routed") {
    return l(time.mode === "drive" ? "travel.routedDrive" : "travel.routed", {
      minutes: formatCount(time.minutes),
    });
  }
  if (time.kind === "straight_line") {
    // Under 1.5 km the two addresses are a walk apart; beyond that the renter needs transport.
    return l(travelAdvice(time.distanceM) === "walkable" ? "travel.walkable" : "travel.transport", { km: km(time.distanceM) });
  }
  return l("travel.missing");
}

/**
 * Travel time to each place by mode, as bars on one shared minutes scale. Straight-line
 * distances get no bar: they are never minutes (SPEC 7.4).
 */
export function TravelBars({ table }: { table: TargetTravel[] }) {
  const longest = Math.max(
    ...table.flatMap((target) =>
      target.modes.map((time) => (time.kind === "routed" ? time.minutes : 0)),
    ),
    10,
  );
  return (
    <div className="flex flex-col gap-5">
      {table.map((target) => (
        <div key={target.id} className="flex flex-col gap-2">
          <h3 className="font-medium">{target.label}</h3>
          <ul className="flex flex-col gap-1.5">
            {target.modes.map((time) => {
              const Icon = modeIcons[time.mode];
              const chosen = target.chosen.includes(time.mode);
              return (
                <li
                  key={time.mode}
                  className="grid grid-cols-[6.5rem_1fr] items-center gap-3 text-sm"
                >
                  <span className={`flex items-center gap-2 ${chosen ? "font-semibold" : ""}`}>
                    <Icon aria-hidden className="text-muted-foreground size-4 shrink-0" />
                    <span className="capitalize">
                      {t(`filters.modes.${time.mode}` as MessageKey)}
                    </span>
                  </span>
                  {time.kind === "routed" ? (
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className={`h-3 rounded-r ${chosen ? "bg-primary" : "bg-primary/45"}`}
                        style={{ width: `${(time.minutes / longest) * 75}%` }}
                      />
                      <span className="figures shrink-0 font-medium">{modeTimeText(time)}</span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground">{modeTimeText(time)}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
