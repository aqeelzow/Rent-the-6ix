import { SafetySchema } from "@rentthe6ix/shared/schemas";
import { describe, expect, it, vi } from "vitest";
import { crimeTableFromRows, crimeTableSource, safetyForListing } from "./safety";

vi.mock("../db", () => ({ getClient: vi.fn(() => null) }));

const period = "2023–2025";
const rows = (areaId: string, [assault, autotheft, breakenter, robbery, theftover]: number[]) => [
  { area_id: areaId, indicator_id: "crime:assault", value: assault, period },
  { area_id: areaId, indicator_id: "crime:autotheft", value: autotheft, period },
  { area_id: areaId, indicator_id: "crime:breakenter", value: breakenter, period },
  { area_id: areaId, indicator_id: "crime:robbery", value: robbery, period },
  { area_id: areaId, indicator_id: "crime:theftover", value: theftover, period },
  // A non-major indicator is ignored for the combined rate.
  { area_id: areaId, indicator_id: "crime:biketheft", value: 999, period },
];

const table = crimeTableFromRows([
  ...rows("001", [600, 150, 150, 50, 50]),
  ...rows("002", [1200, 300, 300, 100, 100]),
]);

describe("crimeTableFromRows", () => {
  it("groups the five major indicators per neighbourhood with their years", () => {
    expect(table.byArea.get("001")).toEqual({
      areaId: "001",
      years: [2023, 2024, 2025],
      byType: { assault: 600, autotheft: 150, breakenter: 150, robbery: 50, theftover: 50 },
      population: null,
    });
  });

  it("uses the neighbourhood average for the city until populations are loaded", () => {
    expect(table.city).toMatchObject({ combined: 1500, method: "neighbourhood_mean" });
    const weighted = crimeTableFromRows(
      [...rows("001", [600, 150, 150, 50, 50]), ...rows("002", [1200, 300, 300, 100, 100])],
      [
        { area_id: "001", value: 30_000 },
        { area_id: "002", value: 10_000 },
      ],
    );
    expect(weighted.city).toMatchObject({ combined: 1250, method: "population_weighted" });
  });
});

describe("safetyForListing", () => {
  it("gives a schema-valid figure and its score for a known neighbourhood", () => {
    const { safety, safetyScore } = safetyForListing(table, "001");
    expect(SafetySchema.parse(safety)).toEqual(safety);
    expect(safety).toMatchObject({ areaId: "001", rate: 1000, relativeRate: 0.67 });
    // Scored from the rounded relative rate the renter sees (0.67).
    expect(safetyScore).toBeCloseTo(88.67, 2);
  });

  it("stays unknown without a table, a neighbourhood or its data", () => {
    expect(safetyForListing(null, "001")).toEqual({ safety: null, safetyScore: null });
    expect(safetyForListing(table, null)).toEqual({ safety: null, safetyScore: null });
    expect(safetyForListing(table, "999")).toEqual({ safety: null, safetyScore: null });
  });
});

describe("crimeTableSource", () => {
  it("resolves null without a database", async () => {
    expect(await crimeTableSource(() => null)()).toBeNull();
  });

  it("reads once and reuses the table", async () => {
    const sql = Object.assign(
      vi.fn((strings: TemplateStringsArray) =>
        Promise.resolve(
          strings.join("?").includes("population") ? [] : rows("001", [600, 150, 150, 50, 50]),
        ),
      ),
      { fragment: true },
    );
    // The IN list helper: sql(values) returns a fragment.
    const client = vi.fn(
      () =>
        new Proxy(sql, {
          apply: (target, self, args) =>
            Array.isArray(args[0]) && !("raw" in args[0])
              ? "fragment"
              : Reflect.apply(target, self, args),
        }) as never,
    );
    const source = crimeTableSource(client);
    const first = await source();
    const second = await source();
    expect(first?.byArea.get("001")?.byType.assault).toBe(600);
    expect(second).toBe(first);
    expect(sql).toHaveBeenCalledTimes(2); // crime rows + populations, once
  });
});
