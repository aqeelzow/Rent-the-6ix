import { test } from "vitest";
import assert from "node:assert/strict";
import { areaPointsLookup, areaResolution } from "./areas";

const row = (name: string, kind: "neighbourhood" | "ward", lat: number, lng: number, exact = false, contains = true) => ({
  name,
  kind,
  lat,
  lng,
  exact,
  contains,
  score: exact ? 1 : contains ? 0.6 : 0.45,
});

test("an area name the query is part of resolves to that area's labelled centroid", () => {
  const result = areaResolution("Liberty Village", [row("Fort York-Liberty Village", "neighbourhood", 43.637, -79.404)]);
  assert.equal(result?.status, "resolved");
  if (result?.status !== "resolved") return;
  assert.deepEqual(result.destination.resolved, {
    lng: -79.404,
    lat: 43.637,
    source: "known_place",
    representativePoint: true,
    label: "Fort York-Liberty Village neighbourhood representative point",
  });
});

test("a name covering several areas averages them instead of picking one", () => {
  const result = areaResolution("scarborough", [
    row("Agincourt South-Malvern West", "neighbourhood", 43.78, -79.28),
    row("Bendale South", "neighbourhood", 43.75, -79.26),
  ]);
  assert.equal(result?.status, "resolved");
  if (result?.status !== "resolved") return;
  assert.equal(result.destination.resolved.lat, 43.765);
  assert.equal(result.destination.resolved.lng, -79.27);
  assert.equal(result.destination.label, "scarborough area representative point");
});

test("an exact name is not diluted by looser matches", () => {
  const result = areaResolution("annex", [
    row("Annex", "neighbourhood", 43.668, -79.404, true, true),
    row("Annex West", "neighbourhood", 43.67, -79.42, false, true),
  ]);
  assert.equal(result?.status, "resolved");
  if (result?.status !== "resolved") return;
  assert.equal(result.destination.resolved.lat, 43.668);
  assert.equal(result.destination.label, "Annex neighbourhood representative point");
});

test("an area nobody matched stays unresolved so the next lookup can answer", () => {
  assert.equal(areaResolution("123 nowhere street", []), undefined);
});

test("the database lookup normalizes the query and returns the area", async () => {
  const calls: { statement: string; parameters: string[] }[] = [];
  const lookup = areaPointsLookup(() => ({
    unsafe: async (statement, parameters) => {
      calls.push({ statement, parameters });
      return [{ name: "Downtown Yonge East", kind: "neighbourhood", lat: 43.656, lng: -79.378, exact: false, contains: true, score: 0.55 }];
    },
  }));
  const result = await lookup("  Downtown  ", new AbortController().signal);
  assert.equal(result?.status, "resolved");
  assert.deepEqual(calls[0].parameters, ["downtown"]);
});

test("two renters searching the same area share one query instead of one being dropped", async () => {
  let calls = 0;
  const lookup = areaPointsLookup(() => ({
    unsafe: async () => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return [row("Fort York-Liberty Village", "neighbourhood", 43.637, -79.404)];
    },
  }));
  const [first, second] = await Promise.all([
    lookup("Liberty Village", new AbortController().signal),
    lookup(" liberty  village ", new AbortController().signal),
  ]);
  assert.equal(first?.status, "resolved");
  assert.equal(second?.status, "resolved");
  assert.equal(calls, 1, "the second caller joins the first query instead of losing its answer");
});

test("an aborted caller gives up without cancelling the shared read", async () => {
  const lookup = areaPointsLookup(() => ({
    unsafe: async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return [row("Annex", "neighbourhood", 43.668, -79.404, true, true)];
    },
  }));
  const controller = new AbortController();
  const cancelled = lookup("Annex", controller.signal);
  controller.abort();
  assert.equal(await cancelled, undefined);
  assert.equal((await lookup("Annex", new AbortController().signal))?.status, "resolved");
});

test("a missing or broken database leaves the area unresolved", async () => {
  assert.equal(await areaPointsLookup(() => null)("Downtown", new AbortController().signal), undefined);
  const broken = areaPointsLookup(() => ({
    unsafe: async () => {
      throw new Error("database is down");
    },
  }));
  assert.equal(await broken("Downtown", new AbortController().signal), undefined);
});
