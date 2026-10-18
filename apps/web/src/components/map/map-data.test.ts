import { searchFixture, travelIntent } from "@rentthe6ix/shared/fixtures";
import { describe, expect, it } from "vitest";
import {
  boundsOf,
  allAtSamePlace,
  circlePolygon,
  listingsAtSamePlace,
  placePins,
  resultsToGeoJSON,
  routesToPlaces,
  scoreBand,
  CRIME_COLORS,
  CRIME_STEPS,
  choroplethToGeoJSON,
  crimeBand,
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
  it("draws every listing as a dot, and approximate ones also get their area circle", () => {
    const { points, areas } = resultsToGeoJSON(results);
    expect(points.features).toHaveLength(results.length);
    for (const feature of points.features) {
      const listing = results.find((r) => r.listing.id === feature.properties.id)!.listing;
      expect(feature.geometry.coordinates).toEqual([listing.location.lng, listing.location.lat]);
    }
    const approximate = results.filter((r) => r.listing.locationPrecision !== "exact");
    expect(areas.features.map((f) => f.properties.id).sort()).toEqual(
      approximate.map((r) => r.listing.id).sort(),
    );
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
    alternativeModes: ["walk"],
    resolved: { lng: -79.395, lat: 43.663 },
  };
  const result = { listing, travel: [] } as unknown as Parameters<typeof routesToPlaces>[0];

  it("gives the distance and the fastest estimated time over the renter's modes", () => {
    const targets = [target] as unknown as Parameters<typeof routesToPlaces>[1];
    const route = routesToPlaces(result, targets)[0]!;
    expect(route.distanceM).toBeGreaterThan(400);
    expect(["transit", "walk"]).toContain(route.mode);
    expect(route.minutes).toBeGreaterThan(0);
  });

  it("skips amenities and places without coordinates", () => {
    const others = [
      { ...target, id: "a", kind: "amenity" },
      { ...target, id: "b", resolved: undefined },
    ] as unknown as Parameters<typeof routesToPlaces>[1];
    expect(routesToPlaces(result, others)).toEqual([]);
  });
});

describe("listings at the same place", () => {
  const at = (id: string, lng: number, lat: number) =>
    ({ listing: { id, location: { lng, lat } } }) as unknown as Parameters<
      typeof listingsAtSamePlace
    >[0][number];
  // a and b are ~11 m apart (one building); c is ~1 km away.
  const results = [at("a", -79.4, 43.66), at("b", -79.4, 43.6601), at("c", -79.4, 43.67)];

  it("finds the other units in the same building, in result order", () => {
    expect(listingsAtSamePlace(results, "b").map((r) => r.listing.id)).toEqual(["a", "b"]);
    expect(listingsAtSamePlace(results, "c").map((r) => r.listing.id)).toEqual(["c"]);
    expect(listingsAtSamePlace(results, "missing")).toEqual([]);
  });

  it("tells when a group can't be split by zooming", () => {
    expect(allAtSamePlace(results, ["a", "b"])).toBe(true);
    expect(allAtSamePlace(results, ["a", "c"])).toBe(false);
    expect(allAtSamePlace(results, ["a"])).toBe(false);
  });
});

describe("crime layer", () => {
  it("bands relative rates at 0.5, 1, 1.5 and 2 times the city", () => {
    expect([0.3, 0.5, 0.99, 1, 1.49, 1.5, 2, 3.4].map(crimeBand)).toEqual([0, 1, 1, 2, 2, 3, 4, 4]);
    expect(CRIME_COLORS).toHaveLength(CRIME_STEPS.length + 1);
  });

  it("turns the choropleth into GeoJSON, keeping unknown rates as null", () => {
    const geometry = {
      type: "MultiPolygon" as const,
      coordinates: [
        [
          [
            [-79.4, 43.6],
            [-79.39, 43.6],
            [-79.4, 43.61],
            [-79.4, 43.6],
          ],
        ],
      ],
    };
    const geo = choroplethToGeoJSON({
      kind: "neighbourhood",
      indicator: "crime",
      unit: "× city rate",
      period: "2023–2025",
      cityValue: 1,
      sourceId: "neighbourhood-crime-rates",
      caveats: [],
      features: [
        { id: "083", name: "Dufferin Grove", value: 1.35, geometry },
        { id: "999", name: "No data", value: null, geometry },
      ],
    });
    expect(geo.features.map((f) => [f.id, f.properties.value])).toEqual([
      ["083", 1.35],
      ["999", null],
    ]);
  });
});
