import { AreaChoroplethSchema } from "@rentthe6ix/shared/schemas";
import { describe, expect, it, vi } from "vitest";
import { createChoroplethRoute, crimeChoropleth } from "./area-choropleth";
import { crimeTableFromRows } from "./safety";
import { wardCrimeFrom } from "./ward-crime";

vi.mock("../db", () => ({ getClient: vi.fn(() => null) }));

const period = "2023–2025";
const rows = (areaId: string, [assault, autotheft, breakenter, robbery, theftover]: number[]) => [
  { area_id: areaId, indicator_id: "crime:assault", value: assault, period },
  { area_id: areaId, indicator_id: "crime:autotheft", value: autotheft, period },
  { area_id: areaId, indicator_id: "crime:breakenter", value: breakenter, period },
  { area_id: areaId, indicator_id: "crime:robbery", value: robbery, period },
  { area_id: areaId, indicator_id: "crime:theftover", value: theftover, period },
];
// City: (1,000 × 30,000 + 2,000 × 10,000) / 40,000 = 1,250 per 100,000.
const table = crimeTableFromRows(
  [...rows("083", [600, 150, 150, 50, 50]), ...rows("084", [1200, 300, 300, 100, 100])],
  [
    { area_id: "083", value: 30_000 },
    { area_id: "084", value: 10_000 },
  ],
);
const square = {
  type: "MultiPolygon" as const,
  coordinates: [
    [
      [
        [-79.4, 43.6],
        [-79.39, 43.6],
        [-79.39, 43.61],
        [-79.4, 43.6],
      ],
    ],
  ],
};

describe("crimeChoropleth", () => {
  it("gives each neighbourhood its rate relative to the city, with the years and caveats", () => {
    const layer = crimeChoropleth(
      [
        { id: "083", name: "Dufferin Grove", geometry: square },
        { id: "084", name: "Little Portugal", geometry: square },
        { id: "999", name: "No data", geometry: square },
      ],
      table,
    );
    expect(AreaChoroplethSchema.parse(layer)).toEqual(layer);
    expect(layer.features.map((f) => f.value)).toEqual([0.8, 1.6, null]);
    expect(layer).toMatchObject({
      indicator: "crime",
      unit: "× city rate",
      period: "2023–2025",
      cityValue: 1,
    });
    expect(layer.caveats.length).toBeGreaterThan(3);
  });
});

describe("wardCrimeFrom", () => {
  it("lists the neighbourhoods covering a ward, largest share first, without boundary slivers", () => {
    const crime = wardCrimeFrom(
      [
        { id: "084", name: "Little Portugal", share: 0.35 },
        { id: "083", name: "Dufferin Grove", share: 0.64 },
        { id: "085", name: "Sliver", share: 0.004 },
      ],
      table,
    );
    expect(crime.neighbourhoods.map((n) => [n.name, n.safety?.relativeRate])).toEqual([
      ["Dufferin Grove", 0.8],
      ["Little Portugal", 1.6],
    ]);
    expect(crime.caveats.length).toBeGreaterThan(3);
  });
});

describe("GET /api/areas", () => {
  const call = (query: string) =>
    createChoroplethRoute(
      () => null,
      async () => table,
    )(new Request(`http://x/api/areas${query}`), undefined);

  it("validates the query and needs a database", async () => {
    expect((await call("?kind=city&indicator=crime")).status).toBe(422);
    expect((await call("?kind=ward&indicator=DROP TABLE")).status).toBe(422);
    expect((await call("?kind=neighbourhood")).status).toBe(422);
    expect((await call("?kind=neighbourhood&indicator=crime")).status).toBe(503);
  });
});
