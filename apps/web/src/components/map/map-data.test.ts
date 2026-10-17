import { searchFixture, travelIntent } from "@rentthe6ix/shared/fixtures";
import { describe, expect, it } from "vitest";
import {
  boundsOf,
  circlePolygon,
  placePins,
  resultsToGeoJSON,
  routesToPlaces,
  scoreBand,
} from "./map-data";

const results = searchFixture.status === "completed" ? searchFixture.results : [];

describe("scoreBand", () => {
  it("splits scores at 75 and 50", () => {
    expect([100, 75, 74, 50, 49, 0].map(scoreBand)).toEqual([
      "high",
      "high",
      "mid",
      "mid",
      "low",
      "low",
    ]);
  });
});

describe("resultsToGeoJSON", () => {
  it("draws exact locations as pins and approximate ones as circles", () => {
    const { points, areas } = resultsToGeoJSON(results);
    expect(points.features.length + areas.features.length).toBe(results.length);
    for (const feature of points.features) {
      const listing = results.find((r) => r.listing.id === feature.properties.id)!.listing;
      expect(listing.locationPrecision).toBe("exact");
      expect(feature.geometry.coordinates).toEqual([listing.location.lng, listing.location.lat]);
    }
    for (const feature of areas.features) {
      const listing = results.find((r) => r.listing.id === feature.properties.id)!.listing;
      expect(listing.locationPrecision).not.toBe("exact");
    }
  });

  it("carries the id and score band for colouring and selection", () => {
    const { points, areas } = resultsToGeoJSON(results);
    const first = [...points.features, ...areas.features][0]!;
    expect(first.id).toBe(first.properties.id);
    expect(["high", "mid", "low"]).toContain(first.properties.band);
  });
});

describe("circlePolygon", () => {
  it("makes a closed ring about the right size", () => {
    const center = { lng: -79.38, lat: 43.65 };
    const ring = circlePolygon(center, 300, 8);
    expect(ring).toHaveLength(9);
    expect(ring[0]).toEqual(ring[8]);
    // North point is ~300 m (≈0.0027°) above the centre.
    expect(ring[2]![1] - center.lat).toBeCloseTo(300 / 111_320, 6);
  });
});

describe("places and bounds", () => {
  it("pins only resolved places", () => {
    expect(placePins(travelIntent.travelTargets)).toEqual([
      { id: "campus", label: travelIntent.travelTargets[0]!.label, lng: -79.4, lat: 43.66 },
    ]);
    expect(placePins([{ ...travelIntent.travelTargets[0]!, resolved: undefined }])).toEqual([]);
  });

  it("bounds every listing and place", () => {
    const [west, south, east, north] = boundsOf(results, [{ lng: -79.6, lat: 43.9 }])!;
    expect(west).toBeCloseTo(-79.6, 6);
    expect(north).toBe(43.9);
    expect(east).toBeGreaterThan(west);
    expect(north).toBeGreaterThan(south);
    expect(boundsOf([], [])).toBeNull();
  });

  it("ignores listings and places far outside Toronto (bad geocodes)", () => {
    const detroit = {
      ...results[1]!,
      listing: { ...results[1]!.listing, location: { lng: -83.05, lat: 42.33 } },
    };
    const withOutlier = boundsOf([...results, detroit], [{ lng: -84.55, lat: 42.73 }])!;
    expect(withOutlier).toEqual(boundsOf(results, [])!);
    expect(boundsOf([detroit], [])).toBeNull();
  });

  it("includes the whole circle around an approximate location", () => {
    const approx = results.find((r) => r.listing.locationPrecision === "area")!;
    const [west, , east] = boundsOf([approx], [])!;
    expect(approx.listing.location.lng - west).toBeGreaterThan(0.003);
    expect(east - approx.listing.location.lng).toBeGreaterThan(0.003);
  });
});

describe("routesToPlaces", () => {
  const listing = {
    id: "00000000-0000-4000-8000-000000000001",
    location: { lng: -79.4, lat: 43.66 },
  };
  const target = {
    id: "uoft",
    kind: "place",
    label: "UofT",
    mode: "transit",
    resolved: { lng: -79.395, lat: 43.663 },
  };
  const result = (travel: unknown[]) =>
    ({ listing, travel }) as unknown as Parameters<typeof routesToPlaces>[0];
  const targets = [target] as unknown as Parameters<typeof routesToPlaces>[1];

  it("uses the quickest routed time when there is one", () => {
    const rows = [
      { targetId: "uoft", mode: "transit", method: "otp", minutes: 14.4, distanceM: 900 },
      { targetId: "uoft", mode: "transit", method: "straight_line", minutes: null, distanceM: 700 },
    ];
    expect(routesToPlaces(result(rows), targets)[0]).toMatchObject({
      kind: "routed",
      mode: "transit",
      minutes: 14,
    });
  });

  it("falls back to straight-line distance, never minutes", () => {
    const rows = [
      { targetId: "uoft", mode: "transit", method: "straight_line", minutes: null, distanceM: 700 },
    ];
    const route = routesToPlaces(result(rows), targets)[0]!;
    expect(route).toMatchObject({ kind: "straight_line", distanceM: 700 });
    expect(route).not.toHaveProperty("minutes");
  });

  it("measures the distance itself when there are no travel rows", () => {
    const route = routesToPlaces(result([]), targets)[0]!;
    expect(route.kind).toBe("straight_line");
    expect(route.kind === "straight_line" && route.distanceM).toBeGreaterThan(400);
  });

  it("skips amenities and places without coordinates", () => {
    const others = [
      { ...target, id: "a", kind: "amenity" },
      { ...target, id: "b", resolved: undefined },
    ] as unknown as Parameters<typeof routesToPlaces>[1];
    expect(routesToPlaces(result([]), others)).toEqual([]);
  });
});
