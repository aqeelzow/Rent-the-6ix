import { describe, expect, it } from "vitest";
import { decodePolyline, fastestPath } from "./otp";
import { createRouteHandler } from "./route-handler";

describe("decodePolyline", () => {
  it("decodes Google's example into [lng, lat] pairs", () => {
    expect(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@")).toEqual([
      [-120.2, 38.5],
      [-120.95, 40.7],
      [-126.453, 43.252],
    ]);
  });
});

describe("fastestPath", () => {
  const leg = (mode: string, seconds: number) => ({
    mode,
    duration: seconds,
    distance: 500,
    route: mode === "TRAM" ? { shortName: "301" } : null,
    legGeometry: { points: "_p~iF~ps|U_ulLnnqC" },
  });

  it("takes the fastest transit itinerary that rides something, with each leg's shape", () => {
    const path = fastestPath(
      [
        { duration: 600, legs: [leg("WALK", 600)] },
        { duration: 900, legs: [leg("WALK", 180), leg("TRAM", 540), leg("WALK", 180)] },
      ],
      "transit",
    );
    expect(path?.minutes).toBe(15);
    expect(path?.legs.map((l) => [l.mode, l.minutes, l.route])).toEqual([
      ["WALK", 3, null],
      ["TRAM", 9, "301"],
      ["WALK", 3, null],
    ]);
    expect(path?.legs[1]?.coordinates).toEqual([
      [-120.2, 38.5],
      [-120.95, 40.7],
    ]);
  });

  it("is null when transit only offers a walk", () => {
    expect(fastestPath([{ duration: 600, legs: [leg("WALK", 600)] }], "transit")).toBeNull();
  });
});

describe("GET /api/route", () => {
  const request = (query: string) => new Request(`http://localhost/api/route?${query}`);
  const ok = "from=43.4723,-80.5449&to=43.4516,-80.4925&mode=transit";

  it("is unavailable without a router", async () => {
    const response = await createRouteHandler({})(request(ok));
    expect(response.status).toBe(503);
  });

  it("rejects points outside Waterloo and unknown modes", async () => {
    const handler = createRouteHandler({ OTP_URL: "http://otp" }, () => ({
      path: async () => null,
    }));
    expect((await handler(request("from=43.65,-79.38&to=43.4516,-80.4925&mode=walk"))).status).toBe(
      400,
    );
    expect((await handler(request(ok.replace("transit", "plane")))).status).toBe(400);
  });

  it("returns the router's path, or 404 when it finds none", async () => {
    const path = { minutes: 15, distanceM: 4000, legs: [] };
    const found = createRouteHandler({ OTP_URL: "http://otp" }, () => ({ path: async () => path }));
    const response = await found(request(ok));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(path);
    const none = createRouteHandler({ OTP_URL: "http://otp" }, () => ({ path: async () => null }));
    expect((await none(request(ok))).status).toBe(404);
  });
});
