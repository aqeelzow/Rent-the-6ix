import { NearbyResponseSchema } from "@rentthe6ix/shared/schemas";
import { describe, expect, it, vi } from "vitest";
import { createNearbyRoute, nearbyFromRows, type NearbyRow } from "./nearby";

vi.mock("../db", () => ({ getClient: vi.fn(() => null) }));

const id = "11111111-1111-4111-8111-111111111111";
const base = {
  name: null,
  category: null,
  subcategory: null,
  is_rapid: null,
  route_types: null,
  lat: null,
  lng: null,
  distance_m: null,
  location_precision: null,
};
const row = (over: Partial<NearbyRow> & Pick<NearbyRow, "kind" | "id">): NearbyRow => ({
  ...base,
  lat: 43.66,
  lng: -79.4,
  ...over,
});
const rows: NearbyRow[] = [
  { ...base, kind: "listing", id, location_precision: "street" },
  row({
    kind: "place",
    id: "g2",
    name: "Metro",
    category: "grocery",
    subcategory: "supermarket",
    distance_m: 640.4,
  }),
  row({
    kind: "place",
    id: "g1",
    name: "FreshCo",
    category: "grocery",
    subcategory: "supermarket",
    distance_m: 212.6,
  }),
  row({ kind: "place", id: "l1", name: "Lillian H. Smith", category: "library", distance_m: 980 }),
  row({
    kind: "stop",
    id: "s2",
    name: "Spadina Ave at College St",
    is_rapid: false,
    route_types: ["0"],
    distance_m: 120,
  }),
  row({
    kind: "stop",
    id: "s1",
    name: "College St at Huron St",
    is_rapid: false,
    route_types: ["0"],
    distance_m: 80,
  }),
  row({
    kind: "rapid",
    id: "r1",
    name: "Queen's Park Station",
    is_rapid: true,
    route_types: ["1"],
    distance_m: 1150.2,
  }),
];

describe("nearbyFromRows", () => {
  it("groups places by the requested categories, nearest first, in whole metres", () => {
    const nearby = nearbyFromRows(id, ["grocery", "library", "park"], rows)!;
    expect(NearbyResponseSchema.parse(nearby)).toEqual(nearby);
    expect(nearby).toMatchObject({
      listingId: id,
      locationPrecision: "street",
      method: "straight_line",
    });
    expect(
      nearby.categories.map((c) => [c.category, c.places.map((p) => [p.name, p.distanceM])]),
    ).toEqual([
      [
        "grocery",
        [
          ["FreshCo", 213],
          ["Metro", 640],
        ],
      ],
      ["library", [["Lillian H. Smith", 980]]],
      ["park", []],
    ]);
    expect(nearby.stops.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(nearby.nearestRapid).toMatchObject({
      name: "Queen's Park Station",
      isRapid: true,
      distanceM: 1150,
    });
  });

  it("is null when the listing doesn't exist, and has no rapid stop when none came back", () => {
    expect(nearbyFromRows(id, ["grocery"], rows.slice(1))).toBeNull();
    expect(nearbyFromRows(id, ["grocery"], rows.slice(0, 2))!.nearestRapid).toBeNull();
  });
});

describe("GET /api/listings/[id]/nearby", () => {
  const fakeClient = (result: NearbyRow[]) => {
    const sql = vi.fn(async () => result);
    return () => sql as never;
  };
  const call = (
    listingId: string,
    query = "",
    client: Parameters<typeof createNearbyRoute>[0] = fakeClient(rows),
  ) =>
    createNearbyRoute(client)(new Request(`http://x/api/listings/${listingId}/nearby${query}`), {
      params: Promise.resolve({ id: listingId }),
    });

  it("returns every category by default, or just the ones asked for", async () => {
    const all = await call(id);
    expect(all.status).toBe(200);
    expect((await all.json()).categories).toHaveLength(8);
    const some = await (await call(id, "?categories=grocery,library,grocery")).json();
    expect(some.categories.map((c: { category: string }) => c.category)).toEqual([
      "grocery",
      "library",
    ]);
  });

  it("validates the id and categories, and reports a missing listing or database", async () => {
    expect((await call("not-a-uuid")).status).toBe(422);
    expect((await call(id, "?categories=casino")).status).toBe(422);
    expect((await call(id, "?categories=")).status).toBe(422);
    expect((await call(id, "", fakeClient([]))).status).toBe(404);
    expect((await call(id, "", () => null)).status).toBe(503);
  });
});
