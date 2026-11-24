import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { benchmarkFor, GRT_MONTHLY_PASS_CAD, type BenchmarkRow } from "./benchmark";

const row = (
  id: string,
  dwelling: string,
  valueCad: number,
  extra: Partial<BenchmarkRow["key"]> = {},
  period = "2026 Q2",
): BenchmarkRow => ({
  id,
  key: { geo: "Kitchener–Cambridge–Waterloo CMA", dwelling, basis: "asking", ...extra },
  valueCad,
  period,
  sourceId: "statcan-46100092",
});

// The rows D loaded on 2026-10-17 (db/seed/benchmarks.json).
const rows: BenchmarkRow[] = [
  row("apt-0", "Apartment", 1750, { bedrooms: 0 }),
  row("apt-1", "Apartment", 1740, { bedrooms: 1 }),
  row("apt-2", "Apartment", 2120, { bedrooms: 2 }),
  row("apt-3", "Apartment", 2410, { bedrooms: 3, bedroomsPlus: true }),
  row("house-2", "House", 2710, { bedrooms: 2 }),
  row("house-3", "House", 2760, { bedrooms: 3, bedroomsPlus: true }),
  row("room", "Room", 770),
  row("apt-1-paid", "Apartment", 1770, { bedrooms: 1, basis: "paid" }),
];

const value = (unitType: Parameters<typeof benchmarkFor>[0]["unitType"], bedrooms: number | null) =>
  benchmarkFor({ unitType, bedrooms }, rows)?.valueCad ?? null;

describe("benchmarkFor", () => {
  it("picks the asking rent for the dwelling and bedroom count, never paid rent", () => {
    expect(benchmarkFor({ unitType: "condo", bedrooms: 1 }, rows)).toEqual({
      label: "Kitchener–Cambridge–Waterloo CMA average asking rent, 1-bedroom apartments",
      valueCad: 1740,
      period: "2026 Q2",
      sourceId: "statcan-46100092",
    });
    expect(value("apartment", 0)).toBe(1750);
    expect(value("basement", 2)).toBe(2120);
    expect(value(null, 2)).toBe(2120);
    expect(value("room", null)).toBe(770);
    expect(value("house", 3)).toBe(2760);
    expect(value("townhouse", 2)).toBe(2710);
  });

  it("uses the 3+ row for larger units and apartments for small houses", () => {
    expect(value("apartment", 5)).toBe(2410);
    expect(benchmarkFor({ unitType: "house", bedrooms: 4 }, rows)?.label).toBe(
      "Kitchener–Cambridge–Waterloo CMA average asking rent, 3+-bedroom houses",
    );
    expect(benchmarkFor({ unitType: "house", bedrooms: 1 }, rows)?.label).toBe(
      "Kitchener–Cambridge–Waterloo CMA average asking rent, 1-bedroom apartments",
    );
    expect(benchmarkFor({ unitType: "apartment", bedrooms: 0 }, rows)?.label).toBe(
      "Kitchener–Cambridge–Waterloo CMA average asking rent, studio apartments",
    );
  });

  it("is null without a size or a matching row, and takes the latest quarter", () => {
    expect(value("apartment", null)).toBeNull();
    expect(benchmarkFor({ unitType: "apartment", bedrooms: 1 }, [])).toBeNull();
    const older = row("apt-1-q1", "Apartment", 2000, { bedrooms: 1 }, "2026 Q1");
    const newer = row("apt-1-q3", "Apartment", 2100, { bedrooms: 1 }, "2026 Q3");
    expect(value("apartment", 1)).toBe(1740);
    expect(
      benchmarkFor({ unitType: "apartment", bedrooms: 1 }, [older, newer, ...rows]),
    ).toMatchObject({ valueCad: 2100, period: "2026 Q3" });
  });
});

it("seeds the GRT pass used in the monthly cost view and eight asking-rent quarters", () => {
  const { rows } = JSON.parse(
    readFileSync(new URL("../../../db/seed/benchmarks.json", import.meta.url), "utf8"),
  ) as { rows: (BenchmarkRow & { kind: string })[] };
  expect(rows.find((row) => row.kind === "transit")?.valueCad).toBe(GRT_MONTHLY_PASS_CAD);
  expect(new Set(rows.filter((row) => row.key.basis === "asking").map((row) => row.period)).size).toBe(8);
});
