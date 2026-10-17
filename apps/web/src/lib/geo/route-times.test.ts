import { test, vi } from "vitest";
import assert from "node:assert/strict";
import { distanceM } from "../../../../../packages/shared/engine/travel";
import { sampleListings } from "../../../../../packages/shared/fixtures/index";
import { TravelTimeRowSchema, type Listing, type TravelTarget } from "../../../../../packages/shared/schemas/index";
import { createRouteTimes, originCell, RouteTimeCache } from "./route-times";

const campus: TravelTarget = {
  id: "campus",
  kind: "place",
  label: "Campus",
  resolved: { lat: 43.6629, lng: -79.3957, source: "known_place" },
  mode: "walk",
  hard: false,
};

const at = (lat: number, lng: number, index = 0): Listing => ({
  ...sampleListings[index],
  location: { lat, lng },
});

const signal = () => new AbortController().signal;

test("routes every listing × target pair and labels the answered rows as OTP", async () => {
  const route = vi.fn(async () => ({ minutes: 9, distanceM: 900 }));
  const routeTimes = createRouteTimes({ route }, { now: () => Date.parse("2026-10-17T13:00:00Z") });
  // Two ads in the same 100 m cell: one router call, two rows.
  const origins = [at(43.6395, -79.431, 0), at(43.6396, -79.4311, 1)];
  const rows = await routeTimes(origins, [campus], "walk", 3_000, signal());
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(TravelTimeRowSchema.parse(row).method, "otp");
    assert.equal(row.minutes, 9);
    assert.equal(row.mode, "walk");
    assert.equal(row.targetId, "campus");
    assert.equal(row.distanceM, 900);
  }
  assert.deepEqual(new Set(rows.map((row) => row.listingId)), new Set(origins.map((listing) => listing.id)));
  assert.equal(route.mock.calls.length, 1, "the second listing shares the first one's origin cell");
});

test("reuses cached minutes across searches instead of re-routing the same cell", async () => {
  const route = vi.fn(async () => ({ minutes: 14, distanceM: 2_000 }));
  const cache = new RouteTimeCache();
  const routeTimes = createRouteTimes({ route }, { cache });
  const origins = [at(43.6395, -79.431)];
  const first = await routeTimes(origins, [campus], "transit", 3_000, signal());
  const second = await routeTimes(origins, [campus], "transit", 3_000, signal());
  assert.equal(route.mock.calls.length, 1);
  const shape = (row: (typeof first)[number]) => ({ ...row, computedAt: undefined });
  // `computedAt` is stamped per call; the routed answer is what must be reused.
  assert.deepEqual(second.map(shape), first.map(shape));
  assert.equal(second[0].method, "otp");
});

test("lists far apart, and different destinations, are routed separately", async () => {
  const route = vi.fn(async () => ({ minutes: 20, distanceM: 4_000 }));
  const routeTimes = createRouteTimes({ route });
  const downtown: TravelTarget = { ...campus, id: "downtown", resolved: { lat: 43.6487, lng: -79.3817, source: "known_place" } };
  const rows = await routeTimes([at(43.6395, -79.431), at(43.7000, -79.3000)], [campus, downtown], "bike", 3_000, signal());
  assert.equal(rows.length, 4);
  assert.equal(route.mock.calls.length, 4, "2 cells × 2 destinations");
  assert.notEqual(originCell({ lat: 43.6395, lng: -79.431 }), originCell({ lat: 43.7, lng: -79.3 }));
});

test("labels a straight-line row with distance and no minutes when the router has no answer", async () => {
  const routeTimes = createRouteTimes({ route: async () => null });
  const listing = at(43.6395, -79.431);
  const [row] = await routeTimes([listing], [campus], "walk", 3_000, signal());
  assert.equal(row.method, "straight_line");
  assert.equal(row.minutes, null);
  assert.equal(row.distanceM, Math.round(distanceM(listing.location, campus.resolved!)));
  assert.equal(TravelTimeRowSchema.parse(row).distanceM, row.distanceM);
});

test("never throws when the router throws or the budget is already spent", async () => {
  const broken = createRouteTimes({
    route: async () => {
      throw new Error("router exploded");
    },
  });
  const rows = await broken([at(43.6395, -79.431)], [campus], "drive", 3_000, signal());
  assert.equal(rows.length, 1);
  assert.equal(rows[0].method, "straight_line");

  const route = vi.fn(async () => ({ minutes: 5, distanceM: 500 }));
  const unpaid = createRouteTimes({ route });
  const late = await unpaid([at(43.6395, -79.431)], [campus], "drive", 0, signal());
  assert.equal(late[0].method, "straight_line");
  assert.equal(route.mock.calls.length, 0, "no router time for a zero budget");
});

test("answers inside the budget even when the router never answers at all", async () => {
  // The search drops a late response wholesale, so returning late is the same as returning nothing.
  const route = vi.fn(() => new Promise<never>(() => {}));
  const origins = [43.6395, 43.65, 43.66].map((lat, index) => at(lat, -79.4 - index * 0.01, index));
  const started = Date.now();
  const rows = await createRouteTimes({ route }, { concurrency: 2 })(origins, [campus], "walk", 400, signal());
  const elapsed = Date.now() - started;
  assert.equal(rows.length, 3);
  assert.ok(rows.every((row) => row.method === "straight_line"));
  assert.ok(elapsed < 400, `returned after ${elapsed}ms, at or past the 400ms budget`);
});

const grocery: TravelTarget = { id: "grocery", kind: "amenity", label: "Grocery", category: "grocery", mode: "walk", hard: false };

test("leaves amenity targets unrouted when there is no destination to route to", async () => {
  const route = vi.fn(async () => ({ minutes: 5, distanceM: 500 }));
  const rows = await createRouteTimes({ route })([at(43.6395, -79.431)], [grocery], "walk", 3_000, signal());
  assert.deepEqual(rows, []);
  assert.equal(route.mock.calls.length, 0);
});

test("routes an amenity to each listing's own nearest shop, then reuses the answer", async () => {
  const route = vi.fn(async () => ({ minutes: 4, distanceM: 300 }));
  const destinationFor = vi.fn(async (listing: Listing) => ({ lat: Math.round(listing.location.lat * 100) / 100, lng: -79.43 }));
  const routeTimes = createRouteTimes({ route }, { destinationFor });
  const origins = [at(43.6395, -79.431, 0), at(43.7000, -79.3000, 1)];
  const first = await routeTimes(origins, [grocery], "walk", 3_000, signal());
  assert.equal(first.length, 2);
  assert.ok(first.every((row) => row.method === "otp" && row.targetId === "grocery" && row.poiId === null));
  assert.equal(destinationFor.mock.calls.length, 2, "each cell gets its own shop");
  assert.equal(route.mock.calls.length, 2, "different shops are different trips");
  const second = await routeTimes(origins, [grocery], "walk", 3_000, signal());
  assert.equal(route.mock.calls.length, 2, "the routed minutes are cached per cell and shop");
  assert.ok(second.every((row) => row.method === "otp"));
});

test("shows nothing rather than a distance when an amenity has no nearby shop", async () => {
  const route = vi.fn(async () => ({ minutes: 4, distanceM: 300 }));
  const rows = await createRouteTimes({ route }, { destinationFor: async () => null })([at(43.6395, -79.431)], [grocery], "walk", 3_000, signal());
  assert.deepEqual(rows, []);
  assert.equal(route.mock.calls.length, 0);
});

test("returns nothing once the search has been cancelled", async () => {
  const route = vi.fn(async () => ({ minutes: 5, distanceM: 500 }));
  const controller = new AbortController();
  controller.abort();
  assert.deepEqual(await createRouteTimes({ route })([at(43.6395, -79.431)], [campus], "walk", 3_000, controller.signal), []);
  assert.equal(route.mock.calls.length, 0);
});

test("keeps router requests within the concurrency limit", async () => {
  let inFlight = 0;
  let peak = 0;
  const route = vi.fn(async () => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    inFlight--;
    return { minutes: 11, distanceM: 1_200 };
  });
  const origins = [43.6395, 43.65, 43.66, 43.67, 43.68].map((lat, index) => at(lat, -79.4 - index * 0.01, index));
  const rows = await createRouteTimes({ route }, { concurrency: 2 })(origins, [campus], "walk", 5_000, signal());
  assert.equal(rows.length, 5);
  assert.ok(peak <= 2, `peak concurrency ${peak} exceeded 2`);
  assert.ok(rows.every((row) => row.method === "otp"));
});

test("the cache expires entries and stays bounded", () => {
  const cache = new RouteTimeCache(10, 2);
  cache.set("a", { minutes: 5, distanceM: 500 }, 0);
  assert.deepEqual(cache.get("a", 5), { minutes: 5, distanceM: 500 });
  assert.equal(cache.get("a", 11), null, "entries older than the TTL are gone");
  cache.set("b", { minutes: 5, distanceM: 500 }, 0);
  cache.set("c", { minutes: 6, distanceM: 600 }, 0);
  cache.set("d", { minutes: 7, distanceM: 700 }, 0);
  assert.equal(cache.size, 2, "the oldest entry is evicted at the limit");
  assert.equal(cache.get("b", 0), null);
});
