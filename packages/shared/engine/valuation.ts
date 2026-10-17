// Valuation from comparables (SPEC 7.2). Owner: C. Pure: no I/O, no clock, no randomness.
// SQL (`selectComparables`) returns pool candidates within the widest radius with their distance;
// this file filters the pool, widens the radius, adjusts, weights and computes the estimate, so the
// same code values a pasted listing in the browser.
// TODO(P0.5): switch the input/output types to B's `Listing` / `Valuation` schemas when they land.
import { VALUATION as C } from "./config";

export type Tri = "yes" | "no" | "unknown";
export type UnitType = "apartment" | "condo" | "basement" | "house" | "townhouse" | "room";
export type Confidence = "low" | "medium" | "high";
export type PriceLabel = "underpriced" | "reasonable" | "overpriced";

/** The listing being valued: only the fields valuation reads. */
export interface ValuationSubject {
  id: string;
  monthlyRentCad: number;
  unitType: UnitType | null;
  bedrooms: number | null;
  bathrooms: number | null;
  sqft: number | null;
  utilitiesIncluded: Tri;
  parking: Tri;
  furnished: Tri;
  laundryInSuite: Tri;
}

/** A candidate from SQL: a listing plus its distance from the subject. */
export interface ComparableCandidate extends ValuationSubject {
  distanceM: number;
  /** ISO timestamp. */
  lastSeenAt: string;
  duplicateOf: string | null;
  /** Same building (RentSafeTO building id, else Address Points id); null = unknown, counted alone. */
  buildingKey: string | null;
}

export interface Benchmark {
  label: string;
  valueCad: number;
  period: string;
  sourceId: string;
}

export type AdjustmentCode = keyof typeof C.adjustmentsCad;

export interface Adjustment {
  code: AdjustmentCode;
  /** Added to each affected comparable's rent; negative = the comparable had it and this one doesn't. */
  amountCad: number;
  /** How many comparables got this adjustment. */
  count: number;
  label: string;
}

export interface ValuedComparable {
  listingId: string;
  rentCad: number;
  adjustedRentCad: number;
  distanceM: number;
  weight: number;
  lastSeenAt: string;
}

export interface Valuation {
  status: "ok" | "insufficient_data";
  estimatedRentCad?: number;
  lowCad?: number;
  highCad?: number;
  /** Positive = the listing is below the estimate. */
  differenceCad?: number;
  differencePct?: number;
  priceLabel: PriceLabel | "unknown";
  comparableCount: number;
  radiusM: number;
  windowDays: number;
  confidence: Confidence;
  comparables: ValuedComparable[];
  adjustments: Adjustment[];
  benchmark: Benchmark | null;
  method: string;
}

const DAY_MS = 86_400_000;

/**
 * Value `subject` against `candidates` (already within the widest radius). `now` dates recency.
 * Returns `insufficient_data` (label `unknown`) when fewer than 5 comparables are in the pool at 3 km.
 * One building's floor plans count as at most `maxPerBuilding` comparables, in weight and in the
 * counts behind the 5-comparable floor and confidence, so a single building can't decide the price.
 */
export function valuate(
  subject: ValuationSubject,
  candidates: ComparableCandidate[],
  benchmark: Benchmark | null,
  now: Date,
): Valuation {
  const pool = candidates.filter((c) => inPool(subject, c, now));
  const widest = C.radiiM[C.radiiM.length - 1];
  const radiusM =
    C.radiiM.find((r) => effectiveCount(withinRadius(pool, r)) >= C.minComparables) ?? widest;
  const chosen = withinRadius(pool, radiusM);
  const effective = effectiveCount(chosen);
  const base = { radiusM, windowDays: C.windowDays, benchmark, comparableCount: chosen.length };

  if (effective < C.minComparables) {
    return {
      ...base,
      status: "insufficient_data",
      priceLabel: "unknown",
      confidence: "low",
      comparables: [],
      adjustments: [],
      method: `Fewer than ${C.minComparables} comparable listings within ${km(widest)} in the last ${C.windowDays} days${chosen.length > effective ? ` (floor plans in one building count as at most ${C.maxPerBuilding})` : ""}.`,
    };
  }

  const adjustments = new Map<string, Adjustment>();
  const points: { value: number; weight: number }[] = [];
  const perBuilding = groupSizes(chosen);
  const comparables: ValuedComparable[] = chosen.map((c) => {
    let adjustedRentCad = c.monthlyRentCad;
    for (const code of Object.keys(C.adjustmentsCad) as AdjustmentCode[]) {
      const amountCad = adjustmentFor(code, subject[code], c[code]);
      if (amountCad === 0) continue;
      adjustedRentCad += amountCad;
      const key = `${code}:${amountCad}`;
      const entry = adjustments.get(key) ?? { code, amountCad, count: 0, label: "" };
      entry.count++;
      entry.label = adjustmentLabel(code, amountCad, entry.count);
      adjustments.set(key, entry);
    }
    const weight =
      weightOf(subject, c, now) * Math.min(1, C.maxPerBuilding / perBuilding.get(groupOf(c))!);
    points.push({ value: adjustedRentCad, weight });
    return {
      listingId: c.id,
      rentCad: c.monthlyRentCad,
      adjustedRentCad,
      distanceM: Math.round(c.distanceM),
      weight: round(weight, 3),
      lastSeenAt: c.lastSeenAt,
    };
  });

  const estimate = Math.round(weightedQuantile(points, 0.5));
  const low = Math.round(weightedQuantile(points, 0.25));
  const high = Math.round(weightedQuantile(points, 0.75));
  const confidence = confidenceOf(effective, (high - low) / estimate);
  const differenceCad = estimate - subject.monthlyRentCad;
  const differencePct = round((100 * differenceCad) / estimate, 1);

  return {
    ...base,
    status: "ok",
    estimatedRentCad: estimate,
    lowCad: low,
    highCad: high,
    differenceCad,
    differencePct,
    priceLabel: priceLabel(differencePct, confidence),
    confidence,
    comparables: comparables.sort((a, b) => b.weight - a.weight || a.distanceM - b.distanceM),
    adjustments: [...adjustments.values()],
    method: `Weighted median of ${comparables.length} comparable ${poolLabel(subject)} within ${km(radiusM)}, seen in the last ${C.windowDays} days, adjusted to this listing's utilities, parking, furniture and laundry.${chosen.length > effective ? ` Floor plans in one building count as at most ${C.maxPerBuilding} comparables.` : ""}`,
  };
}

/** SPEC 7.2 price label. `differencePct` > 0 = listed below the estimate. */
export function priceLabel(differencePct: number, confidence: Confidence): PriceLabel {
  const band = C.labelBandPct[confidence];
  if (differencePct >= band) return "underpriced";
  if (differencePct <= -band) return "overpriced";
  return "reasonable";
}

// --- Pool --------------------------------------------------------------------------------

/**
 * Same unit-type class, same bedrooms (rooms: any), bathrooms within ±1 (unknown passes),
 * seen in the window, not a duplicate, not the listing itself.
 */
export function inPool(subject: ValuationSubject, c: ComparableCandidate, now: Date): boolean {
  if (c.id === subject.id || c.duplicateOf !== null) return false;
  if (ageDays(c.lastSeenAt, now) > C.windowDays) return false;
  if (!sameClass(subject.unitType, c.unitType)) return false;
  if (subject.unitType !== "room") {
    if (subject.bedrooms === null || c.bedrooms !== subject.bedrooms) return false;
  }
  if (subject.bathrooms !== null && c.bathrooms !== null)
    return Math.abs(subject.bathrooms - c.bathrooms) <= C.maxBathroomDifference;
  return true;
}

/** Rooms only with rooms; a basement with basements and apartments; everything else together. */
function sameClass(subject: UnitType | null, other: UnitType | null): boolean {
  if (subject === "room" || other === "room") return subject === other;
  if (subject === "basement") return other === "basement" || other === "apartment";
  return other !== "basement";
}

function poolLabel(subject: ValuationSubject): string {
  if (subject.unitType === "room") return "rooms";
  const beds = subject.bedrooms === 0 ? "studio" : `${subject.bedrooms}-bedroom`;
  return subject.unitType === "basement"
    ? `${beds} basement and apartment listings`
    : `${beds} listings`;
}

function withinRadius(pool: ComparableCandidate[], radiusM: number): ComparableCandidate[] {
  return pool.filter((c) => c.distanceM <= radiusM);
}

function groupOf(c: ComparableCandidate): string {
  return c.buildingKey === null ? `listing:${c.id}` : `building:${c.buildingKey}`;
}

function groupSizes(list: ComparableCandidate[]): Map<string, number> {
  const sizes = new Map<string, number>();
  for (const c of list) sizes.set(groupOf(c), (sizes.get(groupOf(c)) ?? 0) + 1);
  return sizes;
}

/** Comparable count with each building capped at maxPerBuilding. */
function effectiveCount(list: ComparableCandidate[]): number {
  let n = 0;
  for (const size of groupSizes(list).values()) n += Math.min(size, C.maxPerBuilding);
  return n;
}

// --- Adjustments and weights -------------------------------------------------------------

/** Put the comparable on the subject's terms; unknown on either side → no adjustment. */
function adjustmentFor(code: AdjustmentCode, subject: Tri, comparable: Tri): number {
  if (subject === "unknown" || comparable === "unknown" || subject === comparable) return 0;
  return subject === "yes" ? C.adjustmentsCad[code] : -C.adjustmentsCad[code];
}

const FEATURE: Record<AdjustmentCode, string> = {
  utilitiesIncluded: "utilities included",
  parking: "parking",
  furnished: "furnished",
  laundryInSuite: "in-suite laundry",
};

function adjustmentLabel(code: AdjustmentCode, amountCad: number, count: number): string {
  const which = `${count} comparable${count === 1 ? "" : "s"}`;
  const sign = amountCad > 0 ? "+" : "−";
  return amountCad > 0
    ? `This listing has ${FEATURE[code]}, ${which} didn't: ${sign}$${Math.abs(amountCad)} to compare`
    : `${which} had ${FEATURE[code]}, this listing doesn't: ${sign}$${Math.abs(amountCad)} to compare`;
}

function weightOf(subject: ValuationSubject, c: ComparableCandidate, now: Date): number {
  const distance = 1 / (1 + c.distanceM / C.distanceScaleM);
  const age = ageDays(c.lastSeenAt, now);
  const recency =
    age <= C.recencyFullDays
      ? 1
      : 1 - ((1 - C.recencyFloor) * (age - C.recencyFullDays)) / (C.windowDays - C.recencyFullDays);
  let similarity = 1;
  if (subject.bathrooms !== null && c.bathrooms !== null)
    similarity -= C.similarity.perBathroom * Math.abs(subject.bathrooms - c.bathrooms);
  if (
    subject.sqft !== null &&
    c.sqft !== null &&
    Math.abs(c.sqft - subject.sqft) / subject.sqft > C.similarity.sqftTolerance
  )
    similarity -= C.similarity.sqftPenalty;
  return distance * Math.max(recency, C.recencyFloor) * similarity;
}

function ageDays(iso: string, now: Date): number {
  return Math.max(0, (now.getTime() - new Date(iso).getTime()) / DAY_MS);
}

// --- Statistics --------------------------------------------------------------------------

/**
 * Weighted quantile: the first value whose cumulative weight reaches q of the total. When it lands
 * exactly on a boundary, average with the next value, so equal weights give the usual median.
 */
export function weightedQuantile(points: { value: number; weight: number }[], q: number): number {
  const sorted = [...points].sort((a, b) => a.value - b.value);
  const total = sorted.reduce((sum, p) => sum + p.weight, 0);
  const target = q * total;
  let cumulative = 0;
  for (let i = 0; i < sorted.length; i++) {
    cumulative += sorted[i].weight;
    if (Math.abs(cumulative - target) < 1e-9 && i + 1 < sorted.length)
      return (sorted[i].value + sorted[i + 1].value) / 2;
    if (cumulative > target) return sorted[i].value;
  }
  return sorted[sorted.length - 1].value;
}

function confidenceOf(count: number, spread: number): Confidence {
  const { high, medium } = C.confidence;
  if (count >= high.minCount && spread <= high.maxSpread) return "high";
  if (count >= medium.minCount || spread <= medium.maxSpread) return "medium";
  return "low";
}

function km(m: number): string {
  return `${m / 1000} km`;
}

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
