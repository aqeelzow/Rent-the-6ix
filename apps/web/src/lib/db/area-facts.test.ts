import { AreaFactsSchema } from "@rentthe6ix/shared/schemas";
import { describe, expect, it, vi } from "vitest";
import { areaIdFor, assembleAreaFacts, cityValueOf, type IndicatorRow } from "./area-facts";

vi.mock("../db", () => ({ getClient: vi.fn(() => null) }));

const row = (
  area: string,
  indicator: string,
  value: number | null,
  over: Partial<IndicatorRow> = {},
): IndicatorRow => ({
  area_id: area,
  indicator_id: indicator,
  value,
  unit: "u",
  period: "2026-10",
  source_id: "src",
  sample_size: null,
  note: null,
  area_km2: 10,
  ...over,
});

describe("cityValueOf", () => {
  it("sums counts, weights densities by area and the renter share by households", () => {
    expect(
      cityValueOf("libraries", [row("01", "libraries", 4), row("02", "libraries", 3)], null),
    ).toBe(7);
    expect(
      cityValueOf(
        "rapid_transit_within_800m_pct",
        [row("01", "x", 50, { area_km2: 10 }), row("02", "x", 0, { area_km2: 30 })],
        null,
      ),
    ).toBe(12.5);
    expect(
      cityValueOf(
        "renter_households_pct",
        [row("001", "x", 60, { sample_size: 1000 }), row("002", "x", 20, { sample_size: 3000 })],
        null,
      ),
    ).toBe(30);
  });

  it("uses every evaluated building for the RentSafeTO average and has no city median income", () => {
    expect(cityValueOf("rentsafeto_avg_score", [row("01", "x", 90)], 88.4)).toBe(88.4);
    expect(cityValueOf("median_household_income", [row("001", "x", 80000)], null)).toBeNull();
    expect(cityValueOf("libraries", [row("01", "libraries", null)], null)).toBeNull();
  });
});

describe("assembleAreaFacts", () => {
  const facts = assembleAreaFacts({
    kind: "ward",
    area: { id: "10", name: "Spadina-Fort York", number: 10 },
    indicators: [
      row("10", "libraries", 3, { source_id: "library-branch-general-information" }),
      row("13", "libraries", 3, { source_id: "library-branch-general-information" }),
      row("10", "crime:assault", 900),
      row("10", "population", 120000),
    ],
    rents: [
      { bedrooms: 1, n_area: 703, median_area: 2500, n_city: 9000, median_city: 2290.5 },
      { bedrooms: 3, n_area: 4, median_area: 4500, n_city: 900, median_city: 3600 },
    ],
    cityRentSafeAverage: null,
    sources: [
      {
        id: "library-branch-general-information",
        title: "Libraries",
        url: "https://x",
        retrieved_at: new Date("2026-10-17"),
      },
      { id: "unused", title: "Unused", url: "https://y", retrieved_at: null },
    ],
    today: "2026-10-17",
  });

  it("gives the area's figures with city values, leaving out crime and population", () => {
    expect(AreaFactsSchema.parse(facts)).toEqual(facts);
    expect(facts.facts.map((f) => f.indicatorId)).toEqual([
      "libraries",
      "median_asking_rent_1br",
      "median_asking_rent_3br",
      "listing_count_30d",
    ]);
    expect(facts.facts[0]).toMatchObject({ value: 3, cityValue: 6 });
  });

  it("shows thin listing samples as not enough data, and lists only the sources used", () => {
    const rent = (b: number) =>
      facts.facts.find((f) => f.indicatorId === `median_asking_rent_${b}br`)!;
    expect(rent(1)).toMatchObject({ value: 2500, cityValue: 2291, sampleSize: 703 });
    expect(rent(3).value).toBeNull();
    expect(rent(3).note).toMatch(/fewer than 5 listings/);
    expect(facts.facts.at(-1)).toMatchObject({ value: 707, cityValue: 9900 });
    expect(facts.sources.map((s) => s.id)).toEqual([
      "library-branch-general-information",
      "rentthe6ix-listings",
    ]);
  });
});

describe("areaIdFor", () => {
  it("pads ward and neighbourhood numbers and rejects anything else", () => {
    expect(areaIdFor("ward", "1")).toBe("01");
    expect(areaIdFor("ward", "26")).toBeNull();
    expect(areaIdFor("neighbourhood", "83")).toBe("083");
    expect(areaIdFor("neighbourhood", "x")).toBeNull();
  });
});
