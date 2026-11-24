import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CensusSeed, districtIndicators } from "./census.ts";

const seed = CensusSeed.parse(
  JSON.parse(
    readFileSync(new URL("../../../../db/seed/waterloo-census-2021.json", import.meta.url), "utf8"),
  ),
);
const fact = (rows: ReturnType<typeof districtIndicators>, id: string) =>
  rows.find((row) => row.indicator_id === id)?.value;

describe("Waterloo census", () => {
  it("reconciles the published block and DA totals without filling suppressed observations", () => {
    const { disseminationAreas, disseminationBlocks } = seed;
    const counts = districtIndicators("waterloo", disseminationAreas, disseminationBlocks);
    expect(new Set(disseminationAreas.map(({ id }) => id)).size).toBe(155);
    expect(new Set(disseminationBlocks.map(({ id }) => id)).size).toBe(764);
    expect(fact(counts, "population")).toBe(121436);
    expect(fact(counts, "private_dwellings")).toBe(52049);
    expect(fact(counts, "occupied_private_dwellings")).toBe(47040);
    expect(fact(counts, "renter_households")).toBe(18130);
    expect(fact(counts, "renter_households_pct")).toBeNull();
    expect(fact(counts, "renters_shelter_cost_30pct")).toBeNull();
  });

  it("weights published rates and keeps districts with suppressed rates unavailable", () => {
    const da = seed.disseminationAreas[0];
    const a = {
      ...da,
      observations: { "229": 75000, "1400": 500, "1402": 100, "1476": 100, "1478": 40 },
    };
    const b = {
      ...da,
      observations: { "229": 90000, "1400": 800, "1402": 200, "1476": 200, "1478": 70 },
    };
    const complete = districtIndicators("district", [a, b], []);
    expect(fact(complete, "renters_shelter_cost_30pct")).toBe(60);
    expect(fact(complete, "renter_households_pct")).toBe(23.1);
    expect(fact(complete, "median_household_income")).toBe(90000);
    const incomplete = districtIndicators(
      "district",
      [
        a,
        {
          ...b,
          observations: { ...b.observations, "1478": { flag: 2 } },
        },
      ],
      [],
    );
    expect(fact(incomplete, "renters_shelter_cost_30pct")).toBeNull();
  });
});
