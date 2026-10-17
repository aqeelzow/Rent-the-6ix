import type { Caveat, TravelTarget, TravelTimeRow } from "../schemas/index";
import { defaultMinutes, targetModes } from "./travel";

/**
 * Travel carbon (new, owner D). Answers one question a renter asks when comparing homes:
 * *how much does getting to the places I care about emit?*
 *
 * Two rules keep this honest, because an emissions number that flatters a listing is worse
 * than no number (SPEC 9.4, CLAUDE.md):
 *
 * 1. **No emissions without a route.** Kilometres are used only from a row the router answered
 *    (`method: 'otp'`). A straight-line distance is never turned into grams — it would understate
 *    a trip that has to go around the lake or follow a street grid.
 * 2. **Transit is not zero.** The TTC publishes fleet totals, not passenger-kilometres, so no
 *    per-passenger-km factor can be published for it. A transit trip therefore reports *unknown*,
 *    which is displayed as "not counted", never as clean.
 *
 * Scope is the renter's commute as they described it: one-way trips to their saved places, direct
 * operational emissions only. Home energy, food, flights and goods are out of scope and said so.
 */

export type CarbonMode = TravelTimeRow["mode"];

/** A published or deliberately absent emissions factor, with what it does and does not cover. */
export type CarbonFactor = {
  mode: CarbonMode;
  /** Grams of CO2e per kilometre for one traveller; null when no defensible figure exists. */
  gramsPerKm: number | null;
  /** Where the number comes from, or why there is none. */
  basis: string;
  sourceUrl: string | null;
};

/**
 * Driving: NRCan's 2023 average on-road fuel consumption for Canadian cars (7.7 L/100 km) times
 * the EPA's gasoline combustion factor (8,887 g CO2e per US gallon, ≈ 2.347 kg/L) ≈ 181 g CO2e
 * per vehicle-kilometre. One occupant makes that the per-passenger figure too; a car with more
 * people divides it.
 */
export const CARBON_FACTORS: readonly CarbonFactor[] = [
  {
    mode: "walk",
    gramsPerKm: 0,
    basis:
      "No direct operational emissions. Food energy for the walk is not included, so this is not a life-cycle zero.",
    sourceUrl: null,
  },
  {
    mode: "bike",
    gramsPerKm: 0,
    basis:
      "No direct operational emissions. Published food-energy estimates for cycling range around 16–50 g CO2e/km and depend on diet, so they are deliberately not added.",
    sourceUrl: "https://ourworldindata.org/travel-carbon-footprint",
  },
  {
    mode: "drive",
    gramsPerKm: 181,
    basis:
      "Average Canadian gasoline car, 2023: 7.7 L/100 km (NRCan) × 8,887 g CO2 per US gallon (US EPA) ≈ 181 g CO2e/km. Single occupant, tailpipe only — no traffic, parking, or fuel life-cycle.",
    sourceUrl:
      "https://oee.nrcan.gc.ca/corporate/statistics/neud/dpa/showTable.cfm?type=HB&sector=tran&juris=00&rn=7&page=0",
  },
  {
    mode: "transit",
    gramsPerKm: null,
    basis:
      "Not published for Toronto: the TTC and the City report fleet and system totals, not passenger-kilometres, so no per-passenger-km factor can be derived. Shown as not counted rather than as zero.",
    sourceUrl: "https://www.ttc.ca/about-the-ttc/Moving-toward-a-sustainable-future/GHG-emissions-inventory",
  },
];

/** Commute days a year, for the annual figure only. */
export const COMMUTE_DAYS_PER_YEAR = 232;

const FACTORS = new Map(CARBON_FACTORS.map((factor) => [factor.mode, factor]));

export const carbonFactor = (mode: CarbonMode): CarbonFactor => FACTORS.get(mode)!;

/** Grams for one trip, or null when the mode has no published factor. */
export function tripCarbonGrams(mode: CarbonMode, distanceM: number): number | null {
  const factor = carbonFactor(mode).gramsPerKm;
  if (factor === null || !Number.isFinite(distanceM) || distanceM < 0) return null;
  return Math.round((factor * distanceM) / 1000);
}

export type TargetCarbon = {
  targetId: string;
  /** The mode the figure belongs to, or null when nothing is known for this target. */
  mode: CarbonMode | null;
  gramsPerTrip: number | null;
  minutes: number | null;
  method: TravelTimeRow["method"] | null;
  /** Reached by walking, cycling or transit inside the renter's own time limit. */
  carFree: boolean;
};

export type CommuteCarbon = {
  targets: TargetCarbon[];
  /** Sum over every target — null if even one target has no figure, so it can never understate. */
  gramsPerTrip: number | null;
  /** The same trips driven instead, where the router gave a driving distance. */
  driveGramsPerTrip: number | null;
  annualKg: number | null;
  /** "yes" only when every target is reached without a car; "unknown" when any is unproven. */
  carFree: "yes" | "no" | "unknown";
  /** True when at least one target is routed at all. */
  routed: boolean;
};

const MODES_BY_CLEANLINESS: CarbonMode[] = ["walk", "bike", "transit", "drive"];

/**
 * Carbon for the renter's own trips, from the travel rows a search or detail page already holds.
 * Each target is represented by the mode the renter asked for when that mode has a published
 * factor, otherwise by the cleanest accepted mode that does — so a transit-only target stays
 * unknown rather than silently inheriting a walk alternative's zero.
 */
export function commuteCarbon(
  targets: readonly TravelTarget[],
  rows: readonly TravelTimeRow[],
): CommuteCarbon {
  let gramsTotal: number | null = 0;
  let driveTotal: number | null = 0;
  let routed = false;
  let everyTargetCarFree = targets.length > 0;
  let anyUnknown = targets.length === 0;

  const perTarget = targets.map((target): TargetCarbon => {
    const modes = targetModes(target);
    const routedRows = modes
      .map((mode) => rows.find((row) => row.targetId === target.id && row.mode === mode))
      .filter((row): row is TravelTimeRow => row !== undefined && row.method === "otp" && row.minutes !== null);
    const driveRow = rows.find((row) => row.targetId === target.id && row.mode === "drive");
    if (routedRows.length) routed = true;

    const limit = (mode: CarbonMode) => target.maxMinutes ?? defaultMinutes(target, mode);
    // Car-free means the renter's own time limit is met by something other than driving.
    const carFree = routedRows.some(
      (row) => row.mode !== "drive" && row.minutes !== null && row.minutes <= limit(row.mode),
    );

    // The renter's own mode represents the trip when a published factor exists for it; otherwise
    // the cleanest mode they accepted does. Skips modes with no figure, which is why a transit-only
    // target stays unknown instead of silently becoming its alternative.
    let best: { mode: CarbonMode; grams: number; row: TravelTimeRow } | null = null;
    for (const mode of [target.mode, ...MODES_BY_CLEANLINESS]) {
      const row = routedRows.find((candidate) => candidate.mode === mode);
      if (!row) continue;
      const grams = tripCarbonGrams(mode, row.distanceM);
      if (grams === null) continue;
      best = { mode, grams, row };
      break;
    }

    if (gramsTotal !== null) gramsTotal = best ? gramsTotal + best.grams : null;
    if (driveTotal !== null) {
      const driveGrams =
        driveRow && driveRow.method === "otp" ? tripCarbonGrams("drive", driveRow.distanceM) : null;
      driveTotal = driveGrams === null ? null : driveTotal + driveGrams;
    }
    if (!best) anyUnknown = true;
    if (!carFree) everyTargetCarFree = false;

    return {
      targetId: target.id,
      mode: best?.mode ?? null,
      gramsPerTrip: best?.grams ?? null,
      minutes: best?.row.minutes ?? null,
      method: best?.row.method ?? null,
      carFree,
    };
  });

  const carFree: CommuteCarbon["carFree"] =
    everyTargetCarFree && !anyUnknown ? "yes" : anyUnknown ? "unknown" : "no";

  return {
    targets: perTarget,
    gramsPerTrip: gramsTotal,
    driveGramsPerTrip: driveTotal,
    annualKg: gramsTotal === null ? null : (gramsTotal * 2 * COMMUTE_DAYS_PER_YEAR) / 1000,
    carFree,
    routed,
  };
}

/**
 * Sort key for the "lowest carbon" option: car-free commutes first, then the smallest known
 * figure, then the listings nothing is known about. Unknown never sorts as if it were clean.
 */
export function carbonRank(carbon: CommuteCarbon): number {
  if (carbon.carFree === "yes") return 0;
  if (carbon.gramsPerTrip !== null) return 1 + carbon.gramsPerTrip / 1_000_000;
  return 2;
}

export const CARBON_CAVEATS: Caveat[] = [
  {
    severity: "info",
    code: "carbon_commute_only",
    title: "Commute travel only",
    explanation:
      "This counts one-way trips to the places you asked about. Home heating, electricity, food, flights and goods are not included, so it is not a household footprint.",
  },
  {
    severity: "info",
    code: "carbon_transit_not_published",
    title: "Transit is not counted",
    explanation:
      "No per-passenger-kilometre factor is published for Toronto transit, so a transit trip is shown as not counted rather than as zero. Walking and cycling are counted as no direct emissions.",
  },
  {
    severity: "warning",
    code: "carbon_single_occupant_drive",
    title: "Driving assumes one occupant",
    explanation:
      "The driving figure is a single-occupant tailpipe estimate from 2023 average Canadian gasoline-car fuel use. It ignores traffic, parking, cold starts and the life-cycle cost of the fuel, and it halves with two occupants.",
  },
  {
    severity: "warning",
    code: "carbon_needs_a_route",
    title: "No emissions without a route",
    explanation:
      "A figure appears only where the router answered. Distances shown as straight-line are never converted into emissions, because the real trip is longer.",
  },
  {
    severity: "info",
    code: "carbon_electricity_grid",
    title: "Transit's electricity is not the same everywhere",
    explanation:
      "Ontario's grid is low-carbon compared with most, which is one reason bus and rail transit differ. That difference cannot be quantified here without passenger-kilometres.",
  },
];
