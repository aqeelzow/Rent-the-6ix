import { describe, expect, it } from "vitest";
import { CaveatSchema, TravelTargetSchema, type TravelTarget, type TravelTimeRow } from "../schemas/index";
import {
  CARBON_CAVEATS,
  CARBON_FACTORS,
  COMMUTE_DAYS_PER_YEAR,
  carbonFactor,
  carbonRank,
  commuteCarbon,
  tripCarbonGrams,
} from "./carbon";

const target = (overrides: Partial<TravelTarget> = {}): TravelTarget =>
  TravelTargetSchema.parse({
    id: "campus",
    kind: "place",
    label: "Campus",
    query: "campus",
    mode: "walk",
    hard: false,
    ...overrides,
  });

const row = (overrides: Partial<TravelTimeRow> & Pick<TravelTimeRow, "mode">): TravelTimeRow => ({
  listingId: "00000000-0000-4000-8000-000000000001",
  targetId: "campus",
  distanceM: 2_000,
  minutes: 20,
  poiId: null,
  computedAt: "2026-10-17T12:00:00.000Z",
  method: "otp",
  ...overrides,
});

describe("factors", () => {
  it("publishes a figure for walking, cycling and driving, and refuses one for transit", () => {
    expect(tripCarbonGrams("walk", 5_000)).toBe(0);
    expect(tripCarbonGrams("bike", 5_000)).toBe(0);
    expect(tripCarbonGrams("drive", 5_000)).toBe(905); // 5 km × 181 g
    expect(tripCarbonGrams("transit", 5_000)).toBeNull();
    expect(carbonFactor("transit").gramsPerKm).toBeNull();
    expect(carbonFactor("transit").basis).toMatch(/passenger-kilometres/);
  });

  it("never turns a nonsense distance into a number", () => {
    expect(tripCarbonGrams("drive", Number.NaN)).toBeNull();
    expect(tripCarbonGrams("drive", -1)).toBeNull();
    expect(tripCarbonGrams("drive", 0)).toBe(0);
  });

  it("keeps every caveat renderable by the schemas the UI validates against", () => {
    for (const caveat of CARBON_CAVEATS) expect(() => CaveatSchema.parse(caveat)).not.toThrow();
    expect(CARBON_CAVEATS.some((caveat) => caveat.code === "carbon_transit_not_published")).toBe(true);
    expect(CARBON_CAVEATS.some((caveat) => caveat.code === "carbon_needs_a_route")).toBe(true);
  });

  it("records a source for the factors that carry a number", () => {
    for (const factor of CARBON_FACTORS) {
      expect(factor.basis.length).toBeGreaterThan(40);
      if (factor.gramsPerKm !== null && factor.gramsPerKm > 0) expect(factor.sourceUrl).toBeTruthy();
    }
  });
});

describe("commuteCarbon", () => {
  it("reports the cleanest known mode per target and totals the one-way trip", () => {
    const carbon = commuteCarbon(
      [target({ mode: "walk", alternativeModes: ["drive"] })],
      [row({ mode: "walk" }), row({ mode: "drive", distanceM: 4_000 })],
    );
    expect(carbon.gramsPerTrip).toBe(0);
    expect(carbon.driveGramsPerTrip).toBe(724);
    expect(carbon.carFree).toBe("yes");
    expect(carbon.targets[0]).toMatchObject({ mode: "walk", gramsPerTrip: 0, carFree: true });
  });

  it("reports the renter's own mode even when it is slower than their limit", () => {
    const carbon = commuteCarbon(
      [target({ mode: "walk", maxMinutes: 25 })],
      [row({ mode: "walk", distanceM: 4_000, minutes: 50 }), row({ mode: "drive", distanceM: 4_000 })],
    );
    // Walking 50 minutes misses the 25-minute limit, so this home is not car-free — but the trip
    // the renter asked to measure is still the walking one, and driving is reported separately.
    expect(carbon.targets[0].carFree).toBe(false);
    expect(carbon.carFree).toBe("no");
    expect(carbon.gramsPerTrip).toBe(0);
    expect(carbon.driveGramsPerTrip).toBe(724);
  });

  it("falls back to the cleanest accepted mode when the renter's own mode has no figure", () => {
    const carbon = commuteCarbon(
      [target({ mode: "transit", alternativeModes: ["bike"] })],
      [row({ mode: "transit", distanceM: 6_000, minutes: 30 }), row({ mode: "bike", distanceM: 5_000, minutes: 20 })],
    );
    expect(carbon.targets[0]).toMatchObject({ mode: "bike", gramsPerTrip: 0, carFree: true });
    expect(carbon.gramsPerTrip).toBe(0);
  });

  it("treats an unquantified transit trip as unknown, never as zero", () => {
    const carbon = commuteCarbon([target({ mode: "transit" })], [row({ mode: "transit", distanceM: 6_000 })]);
    expect(carbon.gramsPerTrip).toBeNull();
    expect(carbon.annualKg).toBeNull();
    expect(carbon.carFree).toBe("unknown");
    expect(carbon.targets[0]).toMatchObject({ mode: null, gramsPerTrip: null, carFree: true });
  });

  it("counts a transit trip as car-free but still refuses a figure for it", () => {
    const carbon = commuteCarbon(
      [target({ mode: "transit", maxMinutes: 40 })],
      [row({ mode: "transit", distanceM: 6_000, minutes: 30 })],
    );
    expect(carbon.targets[0].carFree).toBe(true);
    expect(carbon.carFree).toBe("unknown");
    expect(carbon.gramsPerTrip).toBeNull();
  });

  it("stays null rather than understating when one of several targets is unknown", () => {
    const carbon = commuteCarbon(
      [target({ id: "campus", mode: "walk" }), target({ id: "work", mode: "transit", label: "Work" })],
      [row({ mode: "walk", distanceM: 1_000 }), row({ mode: "transit", targetId: "work", distanceM: 9_000 })],
    );
    expect(carbon.targets[0].gramsPerTrip).toBe(0);
    expect(carbon.targets[1].gramsPerTrip).toBeNull();
    expect(carbon.gramsPerTrip).toBeNull();
    expect(carbon.carFree).toBe("unknown");
  });

  it("never converts a straight-line distance into emissions", () => {
    const carbon = commuteCarbon(
      [target({ mode: "drive" })],
      [row({ mode: "drive", distanceM: 5_000, minutes: null, method: "straight_line" })],
    );
    expect(carbon.gramsPerTrip).toBeNull();
    expect(carbon.driveGramsPerTrip).toBeNull();
    expect(carbon.routed).toBe(false);
    expect(carbon.targets[0]).toMatchObject({ method: null, minutes: null });
  });

  it("annualises the one-way trip over commute days", () => {
    const carbon = commuteCarbon([target({ mode: "drive" })], [row({ mode: "drive", distanceM: 10_000 })]);
    expect(carbon.gramsPerTrip).toBe(1_810);
    expect(carbon.annualKg).toBeCloseTo((1_810 * 2 * COMMUTE_DAYS_PER_YEAR) / 1000, 6);
  });

  it("reports nothing at all when there are no targets", () => {
    const carbon = commuteCarbon([], []);
    expect(carbon.gramsPerTrip).toBe(0);
    expect(carbon.carFree).toBe("unknown");
    expect(carbon.targets).toEqual([]);
  });
});

describe("carbonRank", () => {
  const rank = (rows: TravelTimeRow[], targets: TravelTarget[]) => carbonRank(commuteCarbon(targets, rows));

  it("puts car-free commutes first, then the smallest figure, then the unknown ones", () => {
    const walk = rank([row({ mode: "walk" })], [target({ mode: "walk" })]);
    const near = rank([row({ mode: "drive", distanceM: 1_000 })], [target({ mode: "drive" })]);
    const far = rank([row({ mode: "drive", distanceM: 30_000 })], [target({ mode: "drive" })]);
    const unknown = rank([row({ mode: "transit", distanceM: 5_000 })], [target({ mode: "transit" })]);
    expect(walk).toBeLessThan(near);
    expect(near).toBeLessThan(far);
    expect(far).toBeLessThan(unknown);
  });
});
