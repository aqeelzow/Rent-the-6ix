import { test } from "vitest";
import assert from "node:assert/strict";
import { sampleListings } from "../../../../../packages/shared/fixtures/index";
import type { Listing, TravelTarget } from "../../../../../packages/shared/schemas/index";
import { amenityDistances, nearestAmenity, poiBatchStatement, poiStatement, rapidTransitBatchStatement, rapidTransitStatement, type SqlParameter } from "./pois";

const recorder = (rows: unknown[]) => {
  const calls: { statement: string; parameters: SqlParameter[] }[] = [];
  const client = () => ({
    unsafe: async (statement: string, parameters: SqlParameter[]) => {
      calls.push({ statement, parameters });
      return rows;
    },
  });
  return { calls, client };
};

test("looks up the nearest shop of the requested category around the listing", async () => {
  const { calls, client } = recorder([{ lat: 43.6399, lng: -79.4298 }]);
  const nearest = nearestAmenity(client);
  assert.deepEqual(await nearest({ lat: 43.6395, lng: -79.431 }, "grocery"), { lat: 43.6399, lng: -79.4298 });
  assert.equal(calls[0].statement, poiStatement);
  assert.deepEqual(calls[0].parameters, ["grocery", -79.431, 43.6395]);
});

test("rapid transit comes from GTFS stops, not the POI table", async () => {
  const { calls, client } = recorder([{ lat: 43.6453, lng: -79.3806 }]);
  const nearest = nearestAmenity(client);
  assert.deepEqual(await nearest({ lat: 43.6395, lng: -79.431 }, "rapid_transit"), { lat: 43.6453, lng: -79.3806 });
  assert.equal(calls[0].statement, rapidTransitStatement);
  assert.deepEqual(calls[0].parameters, [-79.431, 43.6395]);
});

test("ads in one building share a single lookup", async () => {
  const { calls, client } = recorder([{ lat: 43.6399, lng: -79.4298 }]);
  const nearest = nearestAmenity(client);
  await nearest({ lat: 43.6395, lng: -79.431 }, "grocery");
  await nearest({ lat: 43.63951, lng: -79.43102 }, "grocery");
  assert.equal(calls.length, 1, "the second address is in the same 100 m cell");
  await nearest({ lat: 43.6395, lng: -79.431 }, "pharmacy");
  assert.equal(calls.length, 2, "a different category is a different lookup");
});

test("fills the nearest shop for every listing in one query per category", async () => {
  const calls: { statement: string; parameters: SqlParameter[] }[] = [];
  const fill = amenityDistances(
    () => ({ unsafe: async (statement, parameters) => { calls.push({ statement, parameters }); return [{ idx: 1, lat: 43.64, lng: -79.43 }, { idx: 2, lat: 43.65, lng: -79.44 }]; } }),
    () => new Date("2026-10-17T12:00:00Z"),
  );
  const listings: Listing[] = [
    { ...sampleListings[0], id: "00000000-0000-4000-8000-000000000001", location: { lat: 43.6395, lng: -79.431 } },
    { ...sampleListings[1], id: "00000000-0000-4000-8000-000000000002", location: { lat: 43.7, lng: -79.3 } },
  ];
  const targets: TravelTarget[] = [
    { id: "grocery", kind: "amenity", label: "Groceries", category: "grocery", mode: "walk", hard: false },
    { id: "park", kind: "amenity", label: "Park", category: "park", mode: "walk", alternativeModes: ["bike"], hard: false },
  ];
  const rows = await fill(listings, targets);
  assert.equal(calls.length, 2, "one batched query per category, not one per listing");
  assert.equal(calls[0].statement, poiBatchStatement);
  assert.equal(rows.length, 6, "2 listings × (1 walk + 2 modes)");
  assert.ok(rows.every(row => row.method === "straight_line" && row.minutes === null && row.computedAt === "2026-10-17T12:00:00.000Z"));
  assert.ok(rows.every(row => row.distanceM > 0));
});

test("rapid transit is batched from GTFS stops and a missing database fills nothing", async () => {
  const statements: string[] = [];
  const fill = amenityDistances(() => ({ unsafe: async (statement) => { statements.push(statement); return [{ idx: 1, lat: 43.6453, lng: -79.3806 }]; } }));
  const target: TravelTarget = { id: "subway", kind: "amenity", label: "Subway", category: "rapid_transit", mode: "transit", hard: false };
  const rows = await fill([sampleListings[0]], [target]);
  assert.equal(statements[0], rapidTransitBatchStatement);
  assert.equal(rows.length, 1);
  assert.deepEqual(await amenityDistances(() => null)([sampleListings[0]], [target]), [], "no database means no rows");
});

test("a missing category, empty table or broken database means no amenity", async () => {
  assert.equal(await nearestAmenity(() => null)({ lat: 43.6, lng: -79.4 }, "grocery"), null);
  const { client } = recorder([]);
  assert.equal(await nearestAmenity(client)({ lat: 43.6, lng: -79.4 }, "grocery"), null);
  const broken = nearestAmenity(() => ({
    unsafe: async () => {
      throw new Error("database is down");
    },
  }));
  assert.equal(await broken({ lat: 43.6, lng: -79.4 }, "grocery"), null);
});
