import { test, vi } from "vitest";
import assert from "node:assert/strict";
import { OtpClient, fastestTrip, torontoDate } from "./otp";

const response = (body: unknown, ok = true) =>
  ({ ok, json: async () => body }) as unknown as Response;

const itinerary = (minutes: number, legs: { mode: string; distance?: number }[]) => ({
  duration: minutes * 60,
  legs,
});

test("fastestTrip takes the quickest itinerary and sums the distance actually travelled", () => {
  const trip = fastestTrip(
    [
      itinerary(30, [{ mode: "WALK", distance: 2_000 }]),
      itinerary(18, [
        { mode: "WALK", distance: 300 },
        { mode: "SUBWAY", distance: 4_200 },
        { mode: "WALK", distance: 200 },
      ]),
    ],
    "transit",
  );
  assert.deepEqual(trip, { minutes: 18, distanceM: 4_700 });
});

test("transit ignores walk-only itineraries, which OTP returns first on TRANSIT requests", () => {
  const real = itinerary(44, [
    { mode: "WALK", distance: 400 },
    { mode: "SUBWAY", distance: 3_800 },
  ]);
  assert.deepEqual(fastestTrip([itinerary(69, [{ mode: "WALK", distance: 5_000 }]), real], "transit"), {
    minutes: 44,
    distanceM: 4_200,
  });
  // No service at this hour: no made-up time, the caller shows distance instead.
  assert.equal(fastestTrip([itinerary(69, [{ mode: "WALK", distance: 5_000 }])], "transit"), null);
  assert.equal(fastestTrip([], "walk"), null);
  // Walk requests may legitimately be walk-only.
  assert.equal(fastestTrip([itinerary(69, [{ mode: "WALK", distance: 5_000 }])], "walk")?.minutes, 69);
});

test("route sends one pair per request in OTP's own transport-mode name", async () => {
  const calls: { query: string; variables: Record<string, unknown> }[] = [];
  const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
    calls.push(JSON.parse(String(init.body)));
    return response({ data: { plan: { itineraries: [itinerary(12, [{ mode: "BICYCLE", distance: 3_100 }])] } } });
  });
  const client = new OtpClient({ url: "http://otp:8080/", fetch: fetchImpl as unknown as typeof fetch });
  const trip = await client.route(
    { lat: 43.6395, lng: -79.431 },
    { lat: 43.6629, lng: -79.3957 },
    "bike",
    { departure: { date: "2026-10-16", time: "08:30:00" } },
  );
  assert.deepEqual(trip, { minutes: 12, distanceM: 3_100 });
  assert.equal(fetchImpl.mock.calls[0][0], "http://otp:8080/otp/gtfs/v1");
  assert.match(calls[0].query, /mode: BICYCLE/);
  // OTP spells longitude `lon`; sending `lng` is a GraphQL validation error, so pin the wire shape.
  assert.deepEqual(calls[0].variables, {
    from: { lat: 43.6395, lon: -79.431 },
    to: { lat: 43.6629, lon: -79.3957 },
    date: "2026-10-16",
    time: "08:30:00",
  });
});

test("route returns null instead of throwing on every failure it can meet", async () => {
  const failures = [
    vi.fn(async () => response({}, false)),
    vi.fn(async () => response({ errors: [{ message: "no graph" }] })),
    vi.fn(async () => {
      throw new Error("connect ECONNREFUSED");
    }),
    vi.fn(async () => ({
      ok: true,
      json: async () => {
        throw new Error("invalid json");
      },
    })),
  ] as unknown as (typeof fetch)[];
  for (const fetchImpl of failures) {
    const client = new OtpClient({ url: "http://otp:8080", fetch: fetchImpl });
    assert.equal(await client.route({ lat: 43.6, lng: -79.4 }, { lat: 43.66, lng: -79.39 }, "walk"), null);
  }
  // An empty plan is "no route", not a zero-minute trip.
  const empty = new OtpClient({
    url: "http://otp:8080",
    fetch: vi.fn(async () => response({ data: { plan: { itineraries: [] } } })) as unknown as typeof fetch,
  });
  assert.equal(await empty.route({ lat: 43.6, lng: -79.4 }, { lat: 43.66, lng: -79.39 }, "drive"), null);
});

test("route aborts with the caller's signal and its own timeout", async () => {
  const hanging = vi.fn(
    (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      }),
  );
  const client = new OtpClient({ url: "http://otp:8080", fetch: hanging as unknown as typeof fetch, timeoutMs: 20 });
  const started = Date.now();
  assert.equal(await client.route({ lat: 43.6, lng: -79.4 }, { lat: 43.66, lng: -79.39 }, "walk"), null);
  assert.ok(Date.now() - started < 1_000, "the timeout must end the request, not leave it hanging");

  const caller = new AbortController();
  const slow = new OtpClient({
    url: "http://otp:8080",
    fetch: hanging as unknown as typeof fetch,
    timeoutMs: 5_000,
  });
  const pending = slow.route({ lat: 43.6, lng: -79.4 }, { lat: 43.66, lng: -79.39 }, "walk", {
    signal: caller.signal,
  });
  caller.abort();
  assert.equal(await pending, null);
});

test("an invalid coordinate never reaches the router", async () => {
  const fetchImpl = vi.fn();
  const client = new OtpClient({ url: "http://otp:8080", fetch: fetchImpl as unknown as typeof fetch });
  assert.equal(await client.route({ lat: NaN, lng: -79.4 }, { lat: 43.66, lng: -79.39 }, "walk"), null);
  assert.equal(fetchImpl.mock.calls.length, 0);
});

test("torontoDate reports the city's calendar day, not the host machine's", () => {
  // 03:30 UTC on the 17th is still the 16th in Toronto (EDT, UTC−4).
  assert.equal(torontoDate(new Date("2026-10-17T03:30:00Z")), "2026-10-16");
  assert.equal(torontoDate(new Date("2026-10-17T05:30:00Z")), "2026-10-17");
});
