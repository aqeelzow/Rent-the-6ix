import { carbonRank, type CarbonMode, type CommuteCarbon } from "@rentthe6ix/shared/engine/carbon";
import {
  distanceToPreferredArea,
  preferredReference,
  type PreferredReference,
} from "@rentthe6ix/shared/engine/preferred-area";
import type { SearchIntent, SearchResultItem } from "@/lib/store/types";

// Presentation rules for the two travel facts on a result card. Pure and tested, because the
// honest-label rules matter here: an unquantified transit trip is never shown as zero, and a
// straight-line distance is never shown as a duration.

export type CarbonSummary =
  | { kind: "unrouted" }
  | { kind: "carFree" }
  | { kind: "figure"; grams: number; mode: CarbonMode }
  | { kind: "transitUnknown"; driveGrams: number | null };

/** What the carbon badge can say, most certain first. */
export function carbonSummary(carbon: CommuteCarbon): CarbonSummary {
  if (!carbon.routed) return { kind: "unrouted" };
  if (carbon.gramsPerTrip !== null) {
    if (carbon.gramsPerTrip === 0 && carbon.carFree === "yes") return { kind: "carFree" };
    const mode = carbon.targets.find((target) => target.gramsPerTrip !== null)?.mode;
    if (mode) return { kind: "figure", grams: carbon.gramsPerTrip, mode };
  }
  return { kind: "transitUnknown", driveGrams: carbon.driveGramsPerTrip };
}

/** Grams below a kilogram read as grams, because "0.4 kg" hides how small the number is. */
export function formatCo2e(grams: number): string {
  if (grams < 1_000) return `${Math.round(grams)} g`;
  const kg = grams / 1_000;
  return `${kg >= 10 ? Math.round(kg) : kg.toFixed(1)} kg`;
}

/** Metres below a kilometre read as metres, so a 400 m walk to the shops is not "0.4 km". */
export function formatDistance(metres: number): string {
  if (metres < 1_000) return `${Math.round(metres / 10) * 10} m`;
  const km = metres / 1_000;
  return `${km >= 10 ? Math.round(km) : km.toFixed(1)} km`;
}

/**
 * The point every "how far is this?" figure on the results page is measured from: the renter's own
 * resolved place, else a radius area. Null when they named neither, so no ordering is invented.
 */
export function preferredAreaReference(intent: SearchIntent | null): PreferredReference | null {
  return intent ? preferredReference(intent) : null;
}

/**
 * Which listings the "closest to my area" option puts first: nearest straight-line distance, then
 * the ones whose location is unknown — never mixed in as if they were close.
 */
export function orderByPreferredDistance(
  results: SearchResultItem[],
  reference: PreferredReference | null,
): SearchResultItem[] {
  if (!reference) return [...results];
  return results
    .map((result, index) => ({
      result,
      index,
      metres: distanceToPreferredArea({ location: result.listing.location }, reference),
    }))
    .sort((a, b) => {
      if (a.metres === null && b.metres === null) return a.index - b.index;
      if (a.metres === null) return 1;
      if (b.metres === null) return -1;
      return a.metres - b.metres || a.index - b.index;
    })
    .map(({ result }) => result);
}

/**
 * Which listings the "lowest carbon" option puts first: car-free commutes, then the smallest
 * figure, then the ones nothing is known about — never the other way round.
 */
export function orderByCarbon(
  results: SearchResultItem[],
  carbonOf: (result: SearchResultItem) => CommuteCarbon,
): SearchResultItem[] {
  return [...results].sort((a, b) => carbonRank(carbonOf(a)) - carbonRank(carbonOf(b)));
}

/** The preferred-area line, or null when the renter named no place to measure from. */
export function preferredAreaText(
  metres: number | null,
  reference: PreferredReference | null,
): { distance: string; place: string | null } | null {
  if (metres === null || !reference) return null;
  return { distance: formatDistance(metres), place: reference.label };
}
