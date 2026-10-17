import { afterEach, describe, expect, it, vi } from "vitest";
import { sampleListings } from "../../../../../packages/shared/fixtures/index";
import { ValuationSchema } from "../../../../../packages/shared/schemas/index";
import { clearValuationCache, listingContext, listingValuation } from "./valuation";

const NOW = new Date("2026-10-17T12:00:00Z");
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const fields = {
  unit_type: "apartment",
  bedrooms: 1,
  bathrooms: 1,
  sqft: null,
  utilities_included: "unknown",
  parking: "unknown",
  furnished: "unknown",
  laundry_in_suite: "unknown",
};
const subject = {
  id: id(1),
  monthly_rent_cad: 2000,
  ...fields,
  utilities_included: "yes",
  lng: -79.4,
  lat: 43.65,
};
const candidate = (n: number, rent: number, extra: object = {}) => ({
  id: id(n),
  monthly_rent_cad: rent,
  ...fields,
  utilities_included: "no",
  distance_m: 300 + n,
  last_seen_at: new Date("2026-10-16T00:00:00Z"),
  duplicate_of: null,
  building_key: `pt:${n}`,
  ...extra,
});
const five = () => [2400, 2450, 2500, 2550, 2600].map((r, i) => candidate(i + 2, r));

type FakeSql = Parameters<typeof listingValuation>[0];

/**
 * A fake `postgres` client: each SELECT returns the next queued result; inline fragments
 * (sql`ST_MakePoint(…)`) are just values.
 */
function fakeSql(...results: object[][]) {
  const sql = vi.fn((strings: TemplateStringsArray) =>
    strings.join("?").includes("SELECT")
      ? Promise.resolve(results.shift() ?? [])
      : { fragment: strings.join("?") },
  );
  Object.assign(sql, { unsafe: (s: string) => s });
  return sql as unknown as FakeSql & typeof sql;
}

const selects = (sql: ReturnType<typeof fakeSql>) =>
  sql.mock.calls.filter(([s]) => s.join("").includes("SELECT")).length;

afterEach(() => clearValuationCache());

// D's StatCan rows as the benchmarks subselect returns them.
const statcan = (bedrooms: number, valueCad: number, basis = "asking") => ({
  id: `apt-${bedrooms}-${basis}`,
  key: { geo: "Toronto CMA", dwelling: "Apartment", bedrooms, basis },
  valueCad,
  period: "2026 Q2",
  sourceId: "statcan-46100092",
});
const benchmarks = [statcan(1, 1840, "paid"), statcan(1, 2090), statcan(2, 2650)];
const statcan1br = {
  label: "Toronto-area average asking rent, 1-bedroom apartments",
  valueCad: 2090,
  period: "2026 Q2",
  sourceId: "statcan-46100092",
};

describe("listingValuation", () => {
  it("values a stored listing from its SQL candidates", async () => {
    const v = await listingValuation(fakeSql([subject], five()), id(1), NOW);
    expect(v).toMatchObject({ status: "ok", comparableCount: 5, radiusM: 1000 });
    // Utilities included here, not in the comparables: +$150 each to compare.
    expect(v!.estimatedRentCad).toBe(2650);
    expect(v!.priceLabel).toBe("underpriced");
  });

  it("is null for an unknown listing and cached for 6 h", async () => {
    expect(await listingValuation(fakeSql([]), id(9), NOW)).toBeNull();
    const sql = fakeSql([subject], [candidate(2, 2400)]);
    await listingValuation(sql, id(1), NOW);
    const before = selects(sql);
    await listingValuation(sql, id(1), new Date(NOW.getTime() + 3_600_000));
    expect(selects(sql)).toBe(before);
  });

  it("output passes the shared ValuationSchema, with or without a benchmark", async () => {
    const benchmark = {
      label: "Toronto CMA asking rent, 1 bedroom",
      valueCad: 2500,
      period: "2026 Q2",
      sourceId: "statcan",
    };
    const withBenchmark = await listingValuation(fakeSql([subject], five()), id(1), NOW, benchmark);
    expect(() => ValuationSchema.parse(withBenchmark)).not.toThrow();
    clearValuationCache();
    const without = await listingValuation(fakeSql([subject], five()), id(1), NOW);
    expect(() => ValuationSchema.parse(without)).not.toThrow();
  });

  it("adds the StatCan asking rent for the listing's bedrooms, without moving the estimate", async () => {
    const v = await listingValuation(fakeSql([{ ...subject, benchmarks }], five()), id(1), NOW);
    expect(v!.benchmark).toEqual(statcan1br);
    expect(v!.estimatedRentCad).toBe(2650);
    expect(() => ValuationSchema.parse(v)).not.toThrow();
    // An empty benchmarks table gives no line, not an error.
    clearValuationCache();
    const none = await listingValuation(
      fakeSql([{ ...subject, benchmarks: null }], five()),
      id(1),
      NOW,
    );
    expect(none).toMatchObject({ status: "ok", benchmark: null });
  });

  it("insufficient data still lists what it found", async () => {
    const v = await listingValuation(
      fakeSql([subject], [candidate(2, 2400), candidate(3, 2500)]),
      id(1),
      NOW,
    );
    expect(v).toMatchObject({
      status: "insufficient_data",
      priceLabel: "unknown",
      comparableCount: 2,
    });
    expect(v!.comparables).toHaveLength(2);
  });
});

describe("listingContext", () => {
  const listing = {
    ...sampleListings[0],
    id: id(50),
    bedrooms: 1,
    unitType: "apartment" as const,
    buildingId: null,
  };

  it("values any listing, stored or pasted, and adds its caveats", async () => {
    const sql = fakeSql([candidate(2, 2400), candidate(3, 2500)]);
    const { valuation, caveats } = await listingContext(sql, listing, NOW);
    expect(valuation).toMatchObject({ status: "insufficient_data", comparableCount: 2 });
    expect(caveats.map((c) => c.code)).toContain("insufficient_comparables");
  });

  it("adds the benchmark from the stored-listing query and caches it", async () => {
    const sql = fakeSql(five(), [
      { deposit: null, asking_rent_cad: null, observed_at: null, benchmarks },
    ]);
    const { valuation } = await listingContext(sql, listing, NOW);
    expect(valuation.benchmark).toEqual(statcan1br);
    const again = await listingContext(fakeSql([]), listing, NOW);
    expect(again.valuation.benchmark).toEqual(statcan1br);
  });

  it("flags a price drop from the first observation", async () => {
    const sql = fakeSql(five(), [
      {
        deposit: true,
        asking_rent_cad: listing.monthlyRentCad + 200,
        observed_at: new Date("2026-10-01T00:00:00Z"),
      },
    ]);
    const { caveats } = await listingContext(sql, listing, NOW);
    expect(caveats.find((c) => c.code === "price_dropped")?.explanation).toContain(
      "since 2026-10-01",
    );
  });

  it("passes the scam flag stored at ingest to the caveats", async () => {
    const sql = fakeSql(five(), [{ deposit: true, asking_rent_cad: null, observed_at: null }]);
    const { caveats } = await listingContext(sql, listing, NOW);
    expect(caveats[0].code).toBe("deposit_before_viewing");
  });

  it("flags a newer building valued mostly against older ones", async () => {
    const old = [2400, 2450, 2500, 2550, 2600].map((r, i) =>
      candidate(i + 2, r, { year_built: 1968 }),
    );
    const sql = fakeSql(old, []);
    const { caveats } = await listingContext(sql, { ...listing, yearBuilt: 2023 }, NOW);
    expect(caveats.map((c) => c.code)).toContain("newer_building");
  });

  it("reads the RentSafeTO building for the low-score caveat", async () => {
    const sql = fakeSql(
      five(),
      [],
      [{ latest_score: "58.0", score_date: new Date("2025-03-01T00:00:00Z") }],
    );
    const { caveats } = await listingContext(sql, { ...listing, buildingId: "RSN-1" }, NOW);
    const low = caveats.find((c) => c.code === "rentsafeto_low");
    expect(low?.explanation).toContain(
      "58% in its latest City of Toronto RentSafeTO evaluation (2025-03-01)",
    );
  });
});
