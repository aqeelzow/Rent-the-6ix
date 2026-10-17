import type { AreaFact } from "@rentthe6ix/shared/schemas";
import { formatDate } from "@/lib/format/date";
import { t, type MessageKey } from "@/lib/format/messages";
import { formatCad, formatCount } from "@/lib/format/number";

// How an area figure reads on the page (SPEC 9.1–9.3): the unit decides the format, thin data says
// "Not enough data" and a missing figure "Not available" (unknown is never shown as zero).

const f = (key: string, params?: Record<string, string | number>) =>
  t(`areas.facts.${key}` as MessageKey, params);
const decimal = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 1 });
const month = new Intl.DateTimeFormat("en-CA", { month: "long", year: "numeric", timeZone: "UTC" });

/** One number in the figure's unit: "$2,500 a month", "13.8%", "90.4 / 100", "11 per km²", "63". */
export function formatFactNumber(value: number, unit: string): string {
  if (unit === "CAD/month") return f("perMonth", { amount: formatCad(value) });
  if (unit === "CAD") return formatCad(value);
  if (unit.startsWith("%")) return `${decimal.format(value)}%`;
  if (unit === "score out of 100") return f("outOf100", { score: decimal.format(value) });
  if (unit === "stops per km²") return f("perKm2", { n: decimal.format(value) });
  return Number.isInteger(value) ? formatCount(value) : decimal.format(value);
}

/** The area's value, or why there isn't one. */
export function factValueText(fact: AreaFact): string {
  if (fact.value !== null) return formatFactNumber(fact.value, fact.unit);
  return fact.note?.includes("fewer than") ? f("notEnoughData") : f("notAvailable");
}

export function cityValueText(fact: AreaFact): string {
  return fact.cityValue === null ? f("noCity") : formatFactNumber(fact.cityValue, fact.unit);
}

/** "30 days to 2026-10-17" → "30 days to Oct 17, 2026"; "2026-10" → "October 2026". */
export function periodLabel(period: string): string {
  return period
    .replace(/\d{4}-\d{2}-\d{2}/, (date) => formatDate(date))
    .replace(/\b(\d{4})-(\d{2})\b/, (_whole, year: string, mm: string) =>
      month.format(new Date(Date.UTC(Number(year), Number(mm) - 1, 1))),
    );
}

/** The figure's plain name; an id without one is shown as it is. */
export function factLabel(indicatorId: string): string {
  const key = `areas.indicators.${indicatorId}` as MessageKey;
  const label = t(key);
  return label === key ? indicatorId : label;
}
