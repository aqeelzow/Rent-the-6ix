import { SafetySchema } from "@rentthe6ix/shared/schemas";
import { describe, expect, it, vi } from "vitest";
import { crimeTableFromRows, type CrimeTable } from "./safety";
import { createSafetyRoute } from "./safety-route";

vi.mock("../db", () => ({ getClient: vi.fn(() => null) }));

const period = "2023–2025";
const rows = (areaId: string, [assault, autotheft, breakenter, robbery, theftover]: number[]) => [
  { area_id: areaId, indicator_id: "crime:assault", value: assault, period },
  { area_id: areaId, indicator_id: "crime:autotheft", value: autotheft, period },
  { area_id: areaId, indicator_id: "crime:breakenter", value: breakenter, period },
  { area_id: areaId, indicator_id: "crime:robbery", value: robbery, period },
  { area_id: areaId, indicator_id: "crime:theftover", value: theftover, period },
];
const table = crimeTableFromRows(
  [...rows("083", [600, 150, 150, 50, 50]), ...rows("002", [1200, 300, 300, 100, 100])],
  [
    { area_id: "083", value: 30_000 },
    { area_id: "002", value: 10_000 },
  ],
);

const call = (
  kind: string,
  id: string,
  source: () => Promise<CrimeTable | null> = async () => table,
) =>
  createSafetyRoute(source)(new Request(`http://x/api/areas/${kind}/${id}/safety`), {
    params: Promise.resolve({ kind, id }),
  });

describe("GET /api/areas/[kind]/[id]/safety", () => {
  it("returns the neighbourhood's rate against a population-weighted city rate", async () => {
    const response = await call("neighbourhood", "83");
    expect(response.status).toBe(200);
    const safety = SafetySchema.parse(await response.json());
    // City: (1,000 × 30,000 + 2,000 × 10,000) / 40,000 = 1,250, so 1,000 / 1,250 = 0.8.
    expect(safety).toMatchObject({ areaId: "083", rate: 1000, relativeRate: 0.8 });
    expect(safety.caveats.at(-1)!.explanation).not.toMatch(/each neighbourhood counted equally/);
  });

  it("has nothing for wards, unknown neighbourhoods or malformed ids", async () => {
    expect((await call("ward", "10")).status).toBe(404);
    const unknown = await call("neighbourhood", "999");
    expect(unknown.status).toBe(404);
    expect((await unknown.json()).error.code).toBe("area_not_found");
    expect((await call("neighbourhood", "abc")).status).toBe(422);
    expect((await call("city", "1")).status).toBe(422);
  });

  it("is unavailable without a database", async () => {
    expect((await call("neighbourhood", "083", async () => null)).status).toBe(503);
  });
});
