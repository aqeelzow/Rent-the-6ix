import type { SearchIntent, SearchResultItem } from "@/lib/store/types";

// What a result card shows, computed from B's SearchResult. Pure, so the honest-label rules
// (CLAUDE.md) are tested here: straight-line distance is never minutes, thin data is never a label.

type Target = SearchIntent["travelTargets"][number];
type Row = SearchResultItem["travel"][number];
export type Mode = Row["mode"];
type Caveat = SearchResultItem["matchScore"]["caveats"][number];
type Part = SearchResultItem["matchScore"]["parts"][number];

export type TravelSummary =
  | { kind: "routed"; target: string; mode: Mode; minutes: number }
  | { kind: "straight_line"; target: string; mode: Mode; distanceM: number }
  | { kind: "missing"; target: string; mode: Mode };

/** The first travel targets, each with its best routed time, else its straight-line distance. */
export function travelSummaries(
  result: SearchResultItem,
  targets: Target[],
  limit = 2,
): TravelSummary[] {
  return targets.slice(0, limit).map((target) => {
    const modes: Mode[] = [target.mode, ...(target.alternativeModes ?? [])];
    const rows = result.travel.filter(
      (row) => row.targetId === target.id && modes.includes(row.mode),
    );
    const routed = rows
      .filter(
        (row): row is Row & { minutes: number } => row.method === "otp" && row.minutes !== null,
      )
      .sort((a, b) => a.minutes - b.minutes)[0];
    if (routed) {
      return {
        kind: "routed",
        target: target.label,
        mode: routed.mode,
        minutes: Math.round(routed.minutes),
      };
    }
    const line = rows
      .filter((row) => row.method === "straight_line")
      .sort((a, b) => a.distanceM - b.distanceM)[0];
    if (line)
      return {
        kind: "straight_line",
        target: target.label,
        mode: line.mode,
        distanceM: line.distanceM,
      };
    return { kind: "missing", target: target.label, mode: target.mode };
  });
}

const severityRank: Record<Caveat["severity"], number> = { high: 0, warning: 1, info: 2 };

/** The most severe caveat (first one wins a tie), for the card's single caveat line. */
export function topCaveat(caveats: Caveat[]): Caveat | null {
  return caveats.reduce<Caveat | null>(
    (top, caveat) =>
      !top || severityRank[caveat.severity] < severityRank[top.severity] ? caveat : top,
    null,
  );
}

export type PriceSummary =
  | { label: "unknown"; comparableCount: number }
  | {
      label: "underpriced" | "reasonable" | "overpriced";
      /** Whole percent; positive means below the estimate. */
      percent: number;
      direction: "below" | "above" | "in_line";
      comparableCount: number;
      confidence: SearchResultItem["valuation"]["confidence"];
    };

export function priceSummary(valuation: SearchResultItem["valuation"]): PriceSummary {
  if (
    valuation.status !== "ok" ||
    valuation.priceLabel === "unknown" ||
    valuation.differencePct === undefined
  ) {
    return { label: "unknown", comparableCount: valuation.comparableCount };
  }
  const percent = Math.round(Math.abs(valuation.differencePct));
  return {
    label: valuation.priceLabel,
    percent,
    direction: percent === 0 ? "in_line" : valuation.differencePct > 0 ? "below" : "above",
    comparableCount: valuation.comparableCount,
    confidence: valuation.confidence,
  };
}

export type ScoreSegment = { id: Part["id"]; points: number };

/**
 * Segments of the score bar: each known part contributes score × effective weight, so the
 * segments add up to the total (SPEC 7.5). Parts without a score are left out, not shown as zero.
 */
export function scoreSegments(matchScore: SearchResultItem["matchScore"]): ScoreSegment[] {
  return matchScore.parts
    .filter(
      (part): part is Part & { score: number } => part.score !== null && part.effectiveWeight > 0,
    )
    .map((part) => ({ id: part.id, points: part.score * part.effectiveWeight }));
}

/** "2023–2025" from the years a safety rate averages. */
export function yearSpan(years: number[]): string {
  const sorted = [...years].sort((a, b) => a - b);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (first === undefined || last === undefined) return "";
  return first === last ? String(first) : `${first}–${last}`;
}

/** Whole days between when a listing was last seen and now (never negative). */
export function daysSince(iso: string, now: number): number {
  return Math.max(0, Math.floor((now - Date.parse(iso)) / 86_400_000));
}
