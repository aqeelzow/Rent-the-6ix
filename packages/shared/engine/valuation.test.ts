import { describe, expect, it } from "vitest";
import {
  buildingSimilarity,
  inPool,
  priceLabel,
  valuate,
  weightedQuantile,
  type Benchmark,
  type ComparableCandidate,
  type ValuationSubject,
} from "./valuation";

const NOW = new Date("2026-10-16T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

const subject: ValuationSubject = {
  id: "s",
  monthlyRentCad: 2500,
  unitType: "apartment",
  bedrooms: 1,
  bathrooms: 1,
  sqft: null,
  utilitiesIncluded: "unknown",
  parking: "unknown",
  furnished: "unknown",
  laundryInSuite: "unknown",
};

let next = 0;
function comp(overrides: Partial<ComparableCandidate> = {}): ComparableCandidate {
  return {
    ...subject,
    id: `c${next++}`,
    distanceM: 500,
    lastSeenAt: daysAgo(1),
    duplicateOf: null,
    buildingKey: null,
    ...overrides,
  };
}
const comps = (rents: number[], overrides: Partial<ComparableCandidate> = {}) =>
  rents.map((monthlyRentCad) => comp({ monthlyRentCad, ...overrides }));

const benchmark: Benchmark = {
  label: "Toronto CMA asking rent, 1 bedroom",
  valueCad: 2400,
  period: "2026 Q2",
  sourceId: "statcan-46-10-0092-01",
};

describe("pool", () => {
  it("keeps same class, same bedrooms, bathrooms ±1, recent, not duplicates, not itself", () => {
    expect(inPool(subject, comp(), NOW)).toBe(true);
    expect(inPool(subject, comp({ id: "s" }), NOW)).toBe(false);
    expect(inPool(subject, comp({ duplicateOf: "x" }), NOW)).toBe(false);
    expect(inPool(subject, comp({ lastSeenAt: daysAgo(61) }), NOW)).toBe(false);
    expect(inPool(subject, comp({ bedrooms: 2 }), NOW)).toBe(false);
    expect(inPool(subject, comp({ bathrooms: 2 }), NOW)).toBe(true);
    expect(inPool(subject, comp({ bathrooms: 2.5 }), NOW)).toBe(false);
    expect(inPool(subject, comp({ bathrooms: null }), NOW)).toBe(true);
  });

  it("rooms only with rooms; basements with basements and apartments", () => {
    const room = { ...subject, unitType: "room" as const, bedrooms: 4 };
    expect(inPool(room, comp({ unitType: "room", bedrooms: 3 }), NOW)).toBe(true);
    expect(inPool(room, comp({ unitType: "apartment" }), NOW)).toBe(false);
    expect(inPool(subject, comp({ unitType: "room" }), NOW)).toBe(false);

    const basement = { ...subject, unitType: "basement" as const };
    expect(inPool(basement, comp({ unitType: "apartment" }), NOW)).toBe(true);
    expect(inPool(basement, comp({ unitType: "condo" }), NOW)).toBe(false);
    expect(inPool(subject, comp({ unitType: "basement" }), NOW)).toBe(false);
    expect(inPool(subject, comp({ unitType: "condo" }), NOW)).toBe(true);
    expect(inPool(subject, comp({ unitType: null }), NOW)).toBe(true);
  });

  it("can't value a whole unit with unknown bedrooms", () => {
    expect(inPool({ ...subject, bedrooms: null }, comp(), NOW)).toBe(false);
  });
});

describe("radius widening and the 5-comparable floor", () => {
  it("uses 1 km when it has 5 there", () => {
    const v = valuate(subject, comps([2400, 2500, 2600, 2550, 2450]), null, NOW);
    expect(v).toMatchObject({ status: "ok", radiusM: 1000, comparableCount: 5 });
  });

  it("widens to 2 km, then 3 km, and only counts comparables inside the chosen radius", () => {
    const near = comps([2400, 2500, 2600], { distanceM: 800 });
    const mid = comps([2450, 2550], { distanceM: 1800 });
    const far = comps([9000], { distanceM: 2900 });
    expect(valuate(subject, [...near, ...mid, ...far], null, NOW)).toMatchObject({
      radiusM: 2000,
      comparableCount: 5,
    });
    expect(valuate(subject, [...near, mid[0], ...far], null, NOW)).toMatchObject({
      radiusM: 3000,
      comparableCount: 5,
    });
  });

  it("fewer than 5 at 3 km → insufficient data, label unknown, benchmark still shown", () => {
    const v = valuate(subject, comps([2400, 2500, 2600, 2550]), benchmark, NOW);
    expect(v).toMatchObject({
      status: "insufficient_data",
      priceLabel: "unknown",
      comparableCount: 4,
      radiusM: 3000,
      benchmark,
    });
    expect(v.estimatedRentCad).toBeUndefined();
    // What was found is still listed, and the count matches the list.
    expect(v.comparables).toHaveLength(4);
  });
});

describe("adjustments", () => {
  it("puts comparables on the listing's terms; unknown is never adjusted", () => {
    const withUtilities = { ...subject, utilitiesIncluded: "yes" as const, parking: "no" as const };
    const v = valuate(
      withUtilities,
      [
        ...comps([2000, 2000, 2000], { utilitiesIncluded: "no", parking: "yes" }),
        ...comps([2000, 2000], { utilitiesIncluded: "unknown", parking: "unknown" }),
      ],
      null,
      NOW,
    );
    const adjusted = v.comparables.map((c) => c.adjustedRentCad).sort();
    // +150 for utilities the comparable didn't include, −100 for parking it had.
    expect(adjusted).toEqual([2000, 2000, 2050, 2050, 2050]);
    expect(v.adjustments).toEqual([
      expect.objectContaining({ code: "utilitiesIncluded", amountCad: 150, count: 3 }),
      expect.objectContaining({ code: "parking", amountCad: -100, count: 3 }),
    ]);
    expect(v.adjustments[0].label).toBe(
      "This listing has utilities included, 3 comparables didn't: +$150 to compare",
    );
  });

  it("partly included utilities are half a step", () => {
    const partial = { ...subject, utilitiesIncluded: "partial" as const };
    const v = valuate(
      partial,
      [
        ...comps([2000, 2000, 2000], { utilitiesIncluded: "no" }),
        ...comps([2000, 2000], { utilitiesIncluded: "yes" }),
      ],
      null,
      NOW,
    );
    expect(v.comparables.map((c) => c.adjustedRentCad).sort()).toEqual([
      1925, 1925, 2075, 2075, 2075,
    ]);
    expect(v.adjustments.map((a) => a.label)).toEqual([
      "This listing includes more utilities than 3 comparables: +$75 to compare",
      "2 comparables included more utilities than this listing: −$75 to compare",
    ]);
  });
});

describe("building similarity", () => {
  const cand = (extra: object) => ({ ...comps([2000])[0], ...extra });
  it("weights basements against above-ground units and far-apart building ages down", () => {
    const basement = { ...subject, unitType: "basement" as const };
    expect(buildingSimilarity(basement, cand({ unitType: "house" }))).toBe(0.3);
    expect(buildingSimilarity(basement, cand({ unitType: "basement" }))).toBe(1);
    expect(buildingSimilarity(basement, cand({ unitType: null }))).toBe(1);
    const tower = { ...subject, yearBuilt: 2022 };
    expect(buildingSimilarity(tower, cand({ yearBuilt: 2019 }))).toBe(1.5);
    expect(buildingSimilarity(tower, cand({ yearBuilt: 1965 }))).toBe(0.5);
    expect(buildingSimilarity(tower, cand({ yearBuilt: 2000 }))).toBe(1);
    expect(buildingSimilarity(tower, cand({ yearBuilt: null }))).toBe(1);
  });

  it("a basement is valued mostly from basements", () => {
    const basement = { ...subject, unitType: "basement" as const };
    const v = valuate(
      basement,
      [
        ...comps([1600, 1600, 1600], { unitType: "basement" }),
        ...comps([2600, 2600, 2600], { unitType: "apartment" }),
      ],
      null,
      NOW,
    );
    expect(v.estimatedRentCad).toBe(1600);
  });
});

describe("weights and the estimate", () => {
  it("weighted quantiles: equal weights give the usual median; weight pulls it", () => {
    const even = [1, 2, 3, 4].map((value) => ({ value, weight: 1 }));
    expect(weightedQuantile(even, 0.5)).toBe(2.5);
    expect(
      weightedQuantile(
        [1, 2, 3].map((value) => ({ value, weight: 1 })),
        0.5,
      ),
    ).toBe(2);
    expect(
      weightedQuantile(
        [
          { value: 1, weight: 1 },
          { value: 2, weight: 1 },
          { value: 10, weight: 5 },
        ],
        0.5,
      ),
    ).toBe(10);
  });

  it("nearer, fresher, more similar comparables weigh more", () => {
    const v = valuate(
      { ...subject, sqft: 600 },
      [
        comp({ id: "near", distanceM: 0 }),
        comp({ id: "far", distanceM: 1000 }),
        comp({ id: "old", distanceM: 0, lastSeenAt: daysAgo(60) }),
        comp({ id: "bath", distanceM: 0, bathrooms: 2 }),
        comp({ id: "big", distanceM: 0, sqft: 900 }),
      ],
      null,
      NOW,
    );
    const w = Object.fromEntries(v.comparables.map((c) => [c.listingId, c.weight]));
    expect(w).toEqual({ near: 1, far: 0.333, old: 0.5, bath: 0.85, big: 0.9 });
    expect(v.comparables[0].listingId).toBe("near");
  });

  it("estimate, range and difference (positive = listed below)", () => {
    const v = valuate(subject, comps([2000, 2200, 2400, 2600, 2800]), null, NOW);
    expect(v).toMatchObject({
      estimatedRentCad: 2400,
      lowCad: 2200,
      highCad: 2600,
      differenceCad: -100,
      differencePct: -4.2,
      priceLabel: "reasonable",
    });
    expect(v.method).toBe(
      "Weighted median of 5 comparable 1-bedroom listings within 1 km, seen in the last 60 days, adjusted to this listing's utilities, parking, furniture and laundry; comparables of the same building type and age count more.",
    );
  });
});

describe("confidence", () => {
  const tight = (n: number) => comps(Array.from({ length: n }, (_, i) => 2400 + (i % 3) * 50));
  const wide = (n: number) => comps(Array.from({ length: n }, (_, i) => 1500 + (i % 5) * 400));

  it("high: ≥ 12 comparables and a tight spread", () => {
    expect(valuate(subject, tight(12), null, NOW).confidence).toBe("high");
  });
  it("medium: ≥ 8 comparables, or a spread ≤ 25%", () => {
    expect(valuate(subject, wide(8), null, NOW).confidence).toBe("medium");
    expect(valuate(subject, tight(5), null, NOW).confidence).toBe("medium");
  });
  it("low: few comparables and a wide spread", () => {
    expect(valuate(subject, wide(5), null, NOW).confidence).toBe("low");
  });
});

describe("priceLabel", () => {
  it("±10% at medium/high confidence", () => {
    for (const c of ["medium", "high"] as const) {
      expect(priceLabel(10, c)).toBe("underpriced");
      expect(priceLabel(9.9, c)).toBe("reasonable");
      expect(priceLabel(-9.9, c)).toBe("reasonable");
      expect(priceLabel(-10, c)).toBe("overpriced");
    }
  });
  it("±15% at low confidence", () => {
    expect(priceLabel(12, "low")).toBe("reasonable");
    expect(priceLabel(15, "low")).toBe("underpriced");
    expect(priceLabel(-14.9, "low")).toBe("reasonable");
    expect(priceLabel(-15, "low")).toBe("overpriced");
  });
  it("valuate labels a listing well below the estimate as underpriced", () => {
    const v = valuate(
      { ...subject, monthlyRentCad: 2000 },
      comps([2400, 2400, 2400, 2450, 2350]),
      null,
      NOW,
    );
    expect(v).toMatchObject({ priceLabel: "underpriced", differenceCad: 400, differencePct: 16.7 });
  });
});

describe("same-building floor plans", () => {
  it("count as at most 2 comparables toward the floor", () => {
    const tower = comps([2400, 2420, 2440, 2460, 2480, 2500], { buildingKey: "b1", distanceM: 0 });
    const v = valuate(subject, tower, null, NOW);
    expect(v).toMatchObject({ status: "insufficient_data", comparableCount: 6, effectiveCount: 2 });
    expect(v.method).toContain("floor plans in one building count as at most 2");
    // Three more buildings bring it to 2 + 3 = 5.
    const others = comps([2600, 2650, 2700], { distanceM: 800 });
    const mixed = valuate(subject, [...tower, ...others], null, NOW);
    expect(mixed).toMatchObject({ status: "ok", comparableCount: 9, effectiveCount: 5 });
  });

  it("share the weight of 2, so one building can't decide the estimate", () => {
    const tower = comps(Array(10).fill(2000), { buildingKey: "b1", distanceM: 0 });
    const others = comps([3000, 3000, 3000, 3000, 3000], { distanceM: 0 });
    const v = valuate(subject, [...tower, ...others], null, NOW);
    // Uncapped, 10 of 15 equal weights at $2,000 would make the median $2,000.
    expect(v.estimatedRentCad).toBe(3000);
    const towerWeight = v.comparables.find((c) => c.rentCad === 2000)!.weight;
    expect(towerWeight).toBe(0.2);
    // Confidence counts 2 + 5 = 7 comparables, not 15.
    expect(v.confidence).not.toBe("high");
  });
});
