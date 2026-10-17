import { describe, expect, it } from "vitest";
import { benchmarkFor, type BenchmarkRow } from "./benchmark";

const row = (
  id: string,
  dwelling: string,
  valueCad: number,
  extra: Partial<BenchmarkRow["key"]> = {},
  period = "2026 Q2",
): BenchmarkRow => ({
  id,
  key: { geo: "Toronto CMA", dwelling, basis: "asking", ...extra },
  valueCad,
  period,
  sourceId: "statcan-46100092",
});

// The rows D loaded on 2026-10-17 (db/seed/benchmarks.json).
const rows: BenchmarkRow[] = [
  row("apt-0", "Apartment", 1750, { bedrooms: 0 }),
  row("apt-1", "Apartment", 2090, { bedrooms: 1 }),
  row("apt-2", "Apartment", 2650, { bedrooms: 2 }),
  row("apt-3", "Apartment", 3270, { bedrooms: 3, bedroomsPlus: true }),
  row("house-2", "House", 2710, { bedrooms: 2 }),
  row("house-3", "House", 3630, { bedrooms: 3, bedroomsPlus: true }),
  row("room", "Room", 840),
  row("apt-1-paid", "Apartment", 1840, { bedrooms: 1, basis: "paid" }),
];

const value = (unitType: Parameters<typeof benchmarkFor>[0]["unitType"], bedrooms: number | null) =>
  benchmarkFor({ unitType, bedrooms }, rows)?.valueCad ?? null;

describe("benchmarkFor", () => {
  it("picks the asking rent for the dwelling and bedroom count, never paid rent", () => {
    expect(benchmarkFor({ unitType: "condo", bedrooms: 1 }, rows)).toEqual({
      label: "Toronto-area average asking rent, 1-bedroom apartments",
      valueCad: 2090,
      period: "2026 Q2",
      sourceId: "statcan-46100092",
    });
    expect(value("apartment", 0)).toBe(1750);
    expect(value("basement", 2)).toBe(2650);
    expect(value(null, 2)).toBe(2650);
    expect(value("room", null)).toBe(840);
    expect(value("house", 3)).toBe(3630);
    expect(value("townhouse", 2)).toBe(2710);
  });

  it("uses the 3+ row for larger units and apartments for small houses", () => {
    expect(value("apartment", 5)).toBe(3270);
    expect(benchmarkFor({ unitType: "house", bedrooms: 4 }, rows)?.label).toBe(
      "Toronto-area average asking rent, 3+-bedroom houses",
    );
    expect(benchmarkFor({ unitType: "house", bedrooms: 1 }, rows)?.label).toBe(
      "Toronto-area average asking rent, 1-bedroom apartments",
    );
    expect(benchmarkFor({ unitType: "apartment", bedrooms: 0 }, rows)?.label).toBe(
      "Toronto-area average asking rent, studio apartments",
    );
  });

  it("is null without a size or a matching row, and takes the latest quarter", () => {
    expect(value("apartment", null)).toBeNull();
    expect(benchmarkFor({ unitType: "apartment", bedrooms: 1 }, [])).toBeNull();
    const older = row("apt-1-q1", "Apartment", 2000, { bedrooms: 1 }, "2026 Q1");
    const newer = row("apt-1-q3", "Apartment", 2100, { bedrooms: 1 }, "2026 Q3");
    expect(value("apartment", 1)).toBe(2090);
    expect(
      benchmarkFor({ unitType: "apartment", bedrooms: 1 }, [older, newer, ...rows]),
    ).toMatchObject({ valueCad: 2100, period: "2026 Q3" });
  });
});
