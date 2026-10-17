import { t, type MessageKey } from "@/lib/format/messages";
import type { SearchIntent, SearchResultItem } from "@/lib/store/types";
import { estimateTravelMinutes, targetDistanceM, targetModes } from "@rentthe6ix/shared/engine/travel";

// Result presentation uses the same distance-based time estimates as filtering and scoring.

type Target = SearchIntent["travelTargets"][number];
type Row = SearchResultItem["travel"][number];
export type Mode = Row["mode"];
type Caveat = SearchResultItem["matchScore"]["caveats"][number];
type Part = SearchResultItem["matchScore"]["parts"][number];

export type TravelSummary =
  | { kind: "estimated"; target: string; mode: Mode; minutes: number; distanceM: number }
  | { kind: "missing"; target: string; mode: Mode };

/** The first travel targets, each with its fastest estimated time among the requested modes. */
export function travelSummaries(
  result: SearchResultItem,
  targets: Target[],
  limit = 2,
): TravelSummary[] {
  return targets.slice(0, limit).map((target) => {
    const metres = targetDistanceM(target, result.travel, result.listing.location);
    if (metres === null) return { kind: "missing", target: target.label, mode: target.mode };
    const fastest = targetModes(target).map(mode => ({ mode, minutes: estimateTravelMinutes(metres, mode) })).sort((a, b) => a.minutes - b.minutes)[0]!;
    return { kind: "estimated", target: target.label, ...fastest, distanceM: metres };
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

const NOTE_SUFFIX = ": not confirmed";

/** Engine field codes (`filters.ts`) → the words renters see. */
const noteLabels: Record<string, MessageKey> = {
  area: "results.notes.area",
  rent: "results.notes.rent",
  bedrooms: "results.notes.bedrooms",
  bathrooms: "results.notes.bathrooms",
  sizeSqft: "results.notes.size",
  unitTypes: "results.notes.unitTypes",
  buildingAge: "results.notes.buildingAge",
  airConditioning: "results.notes.airConditioning",
  petsAllowed: "results.notes.pets",
  furnished: "results.notes.furnished",
  parking: "results.notes.parking",
  laundryInSuite: "results.notes.laundry",
  utilitiesIncluded: "results.notes.utilities",
  availableBy: "results.notes.availableBy",
  leaseTerm: "results.notes.lease",
  priceFairness: "results.notes.priceFairness",
  safety: "results.notes.safety",
};

/**
 * "airConditioning: not confirmed" → "Air conditioning not confirmed".
 * Other notes keep their words and only drop the field-code form.
 */
export function plainHardFilterNote(note: string): string {
  if (!note.endsWith(NOTE_SUFFIX)) return note;
  const name = note.slice(0, -NOTE_SUFFIX.length);
  const key = noteLabels[name];
  return t("results.notes.notConfirmed", { label: key ? t(key) : name });
}

export type AcFact = "central" | "yes" | "not_stated";

/**
 * AC on a result card. Known AC always shows. Unknown shows "not stated" only when the
 * renter asked for AC, so a blank field is never read as "no".
 */
export function acFact(
  airConditioning: SearchResultItem["listing"]["airConditioning"],
  acInSearch: boolean,
): AcFact | null {
  if (airConditioning === "central") return "central";
  if (airConditioning === "yes") return "yes";
  if (airConditioning === "unknown" && acInSearch) return "not_stated";
  return null;
}
