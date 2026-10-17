import { test } from "vitest";
import assert from "node:assert/strict";
import { nearestAmenity, poiStatement, rapidTransitStatement } from "./pois";

const recorder = (rows: unknown[]) => {
  const calls: { statement: string; parameters: (string | number)[] }[] = [];
  const client = () => ({
    unsafe: async (statement: string, parameters: (string | number)[]) => {
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
