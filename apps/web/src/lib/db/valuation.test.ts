import { afterEach, describe, expect, it, vi } from "vitest";
import { ValuationSchema } from "../../../../../packages/shared/schemas/index";
import { clearValuationCache, listingValuation, toApiValuation } from "./valuation";

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
const subject = { id: id(1), monthly_rent_cad: 2000, ...fields, utilities_included: "yes" };
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

/** A fake `postgres` client: each tagged-template call returns the next queued result. */
function fakeSql(...results: object[][]) {
  const sql = vi.fn(async () => results.shift() ?? []) as unknown as Parameters<
    typeof listingValuation
  >[0];
  (sql as unknown as { unsafe: (s: string) => string }).unsafe = (s: string) => s;
  return sql;
}

afterEach(() => clearValuationCache());

describe("listingValuation", () => {
  it("values a stored listing from its SQL candidates", async () => {
    const sql = fakeSql(
      [subject],
      [2400, 2450, 2500, 2550, 2600].map((r, i) => candidate(i + 2, r)),
    );
    const v = await listingValuation(sql, id(1), NOW);
    expect(v).toMatchObject({ status: "ok", comparableCount: 5, radiusM: 1000 });
    // Utilities included here, not in the comparables: +$150 each to compare.
    expect(v!.estimatedRentCad).toBe(2650);
    expect(v!.priceLabel).toBe("underpriced");
  });

  it("is null for an unknown listing and cached for 6 h", async () => {
    expect(await listingValuation(fakeSql([]), id(9), NOW)).toBeNull();
    const sql = fakeSql([subject], [candidate(2, 2400)]);
    await listingValuation(sql, id(1), NOW);
    await listingValuation(sql, id(1), new Date(NOW.getTime() + 3_600_000));
    expect(sql).toHaveBeenCalledTimes(2);
  });

  it("API shape passes ValuationSchema once a benchmark exists", async () => {
    const sql = fakeSql(
      [subject],
      [2400, 2450, 2500, 2550, 2600].map((r, i) => candidate(i + 2, r)),
    );
    const benchmark = {
      label: "Toronto CMA asking rent, 1 bedroom",
      valueCad: 2500,
      period: "2026 Q2",
      sourceId: "statcan",
    };
    const v = await listingValuation(sql, id(1), NOW, benchmark);
    expect(() => ValuationSchema.parse(toApiValuation(v!))).not.toThrow();
  });

  it("insufficient data still lists what it found", async () => {
    const sql = fakeSql([subject], [candidate(2, 2400), candidate(3, 2500)]);
    const v = await listingValuation(sql, id(1), NOW);
    expect(v).toMatchObject({
      status: "insufficient_data",
      priceLabel: "unknown",
      comparableCount: 2,
    });
    expect(v!.comparables).toHaveLength(2);
  });
});
