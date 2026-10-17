import { describe, expect, it } from "vitest";
import { SafetySchema } from "../schemas/index";
import {
  SAFETY_CAVEATS,
  cityRates,
  safetyFor,
  safetyScore,
  yearsFromPeriod,
  type CrimeRates,
} from "./safety";

const years = [2023, 2024, 2025];
const hood = (
  areaId: string,
  [assault, autotheft, breakenter, robbery, theftover]: number[],
  population?: number,
): CrimeRates => ({
  areaId,
  years,
  byType: { assault, autotheft, breakenter, robbery, theftover },
  population,
});

// Combined rates: A = 1,000, B = 2,000 per 100,000.
const a = hood("001", [600, 150, 150, 50, 50], 30_000);
const b = hood("002", [1200, 300, 300, 100, 100], 10_000);

describe("safetyScore (SPEC 7.6)", () => {
  it("is 100 at or below 0.5×, 0 at or above 2×, and linear in between", () => {
    expect(safetyScore(0.2)).toBe(100);
    expect(safetyScore(0.5)).toBe(100);
    expect(safetyScore(1)).toBeCloseTo(66.67, 2);
    expect(safetyScore(1.25)).toBe(50);
    expect(safetyScore(2)).toBe(0);
    expect(safetyScore(3)).toBe(0);
  });
});

describe("cityRates", () => {
  it("weights by population when every neighbourhood has one (all crimes ÷ all residents)", () => {
    const city = cityRates([a, b])!;
    // (1,000 × 30,000 + 2,000 × 10,000) / 40,000 = 1,250
    expect(city.method).toBe("population_weighted");
    expect(city.combined).toBeCloseTo(1250, 6);
    expect(city.byType.assault).toBeCloseTo(750, 6);
    expect(city.years).toEqual(years);
  });

  it("falls back to the plain neighbourhood average without populations", () => {
    const city = cityRates([
      { ...a, population: null },
      { ...b, population: null },
    ])!;
    expect(city.method).toBe("neighbourhood_mean");
    expect(city.combined).toBeCloseTo(1500, 6);
  });

  it("leaves out neighbourhoods missing a major type, and is null with none left", () => {
    const partial = { ...b, byType: { ...b.byType, robbery: null } };
    expect(cityRates([a, partial])!.combined).toBeCloseTo(1000, 6);
    expect(cityRates([partial])).toBeNull();
    expect(cityRates([])).toBeNull();
  });
});

describe("safetyFor", () => {
  const city = cityRates([a, b])!;

  it("gives the combined rate, the rate relative to the city, the types and the years", () => {
    const safety = safetyFor(a, city)!;
    expect(SafetySchema.parse(safety)).toEqual(safety);
    expect(safety).toMatchObject({ areaId: "001", rate: 1000, relativeRate: 0.8, years });
    expect(safety.byType).toEqual({
      assault: 600,
      autotheft: 150,
      breakenter: 150,
      robbery: 50,
      theftover: 50,
    });
  });

  it("always carries the caveats, including how the city rate was worked out", () => {
    const codes = safetyFor(a, city)!.caveats.map((c) => c.code);
    expect(codes).toEqual([...SAFETY_CAVEATS.map((c) => c.code), "safety_city_rate"]);
    const mean = cityRates([
      { ...a, population: null },
      { ...b, population: null },
    ])!;
    expect(safetyFor(a, mean)!.caveats.at(-1)!.explanation).toMatch(
      /each neighbourhood counted equally/,
    );
  });

  it("returns null rates (never a guess) when a major type is missing, and stays schema-valid", () => {
    const partial = { ...a, byType: { ...a.byType, theftover: null } };
    const safety = safetyFor(partial, city)!;
    expect(safety.rate).toBeNull();
    expect(safety.relativeRate).toBeNull();
    expect(SafetySchema.safeParse(safety).success).toBe(true);
    expect(safetyFor(a, null)!.relativeRate).toBeNull();
  });

  it("is null without a neighbourhood or without years", () => {
    expect(safetyFor(null, city)).toBeNull();
    expect(safetyFor({ ...a, years: [] }, city)).toBeNull();
  });

  it("never uses words that label a place (SPEC 7.6)", () => {
    const text = JSON.stringify(safetyFor(a, city));
    expect(text).not.toMatch(/\b(safe|unsafe|dangerous|sketchy|rough)\b/i);
  });
});

describe("yearsFromPeriod", () => {
  it("reads the loader's period strings", () => {
    expect(yearsFromPeriod("2023–2025")).toEqual([2023, 2024, 2025]);
    expect(yearsFromPeriod("2023-2025")).toEqual([2023, 2024, 2025]);
    expect(yearsFromPeriod("2025")).toEqual([2025]);
    expect(yearsFromPeriod("recent")).toEqual([]);
    expect(yearsFromPeriod("2025–2023")).toEqual([]);
  });
});
