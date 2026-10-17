import { describe, expect, it } from "vitest";
import { AreaFilterSchema, TravelTargetSchema, type AreaFilter, type TravelTarget } from "../schemas/index";
import { distanceToPreferredArea, preferredReference } from "./preferred-area";

const place = (overrides: Partial<TravelTarget> = {}): TravelTarget =>
  TravelTargetSchema.parse({
    id: "campus",
    kind: "place",
    label: "Campus",
    query: "campus",
    mode: "walk",
    hard: false,
    ...overrides,
  });

const near = (lat: number, lng: number): AreaFilter =>
  AreaFilterSchema.parse({ kind: "near", point: { lat, lng }, radiusM: 2_000 });

const parkdale = { lat: 43.6395, lng: -79.431 };
const uoft = { lat: 43.6629, lng: -79.3957 };

describe("preferredReference", () => {
  it("uses the renter's own wording, not the resolver's label", () => {
    const reference = preferredReference({
      areas: [],
      travelTargets: [
        place({
          label: "UofT St. George",
          resolved: { ...uoft, source: "known_place", label: "UofT St. George campus representative point" },
        }),
      ],
    });
    expect(reference).toEqual({ label: "UofT St. George", point: uoft, kind: "place" });
  });

  it("uses the target's label when the resolver supplied none", () => {
    const reference = preferredReference({
      areas: [],
      travelTargets: [place({ resolved: { ...uoft, source: "address_points" } })],
    });
    expect(reference?.label).toBe("Campus");
  });

  it("falls back to a radius area, which has no name of its own", () => {
    const reference = preferredReference({ areas: [near(uoft.lat, uoft.lng)], travelTargets: [] });
    expect(reference).toEqual({ label: null, point: uoft, kind: "area" });
  });

  it("refuses to invent a reference for a neighbourhood filter, where only a boundary exists", () => {
    const area = AreaFilterSchema.parse({ kind: "neighbourhood", id: "083" });
    expect(preferredReference({ areas: [area], travelTargets: [] })).toBeNull();
    expect(preferredReference({ areas: [], travelTargets: [place({ query: "campus" })] })).toBeNull();
  });

  it("prefers the placed target over a radius area when both exist", () => {
    const reference = preferredReference({
      areas: [near(parkdale.lat, parkdale.lng)],
      travelTargets: [place({ resolved: { ...uoft, source: "known_place" } })],
    });
    expect(reference?.kind).toBe("place");
    expect(reference?.point).toEqual(uoft);
  });
});

describe("distanceToPreferredArea", () => {
  it("measures straight-line metres and rounds to the metre", () => {
    const reference = { label: "U of T", point: uoft, kind: "place" as const };
    const metres = distanceToPreferredArea({ location: parkdale }, reference);
    // Measured value. The router's walking route for the same pair is 6.7 km, so this straight
    // line is ~1.75× short — which is exactly why emissions are never computed from it.
    expect(metres).toBe(3_852);
    expect(Number.isInteger(metres)).toBe(true);
  });

  it("is zero at the reference and null without one", () => {
    const reference = { label: "U of T", point: uoft, kind: "place" as const };
    expect(distanceToPreferredArea({ location: uoft }, reference)).toBe(0);
    expect(distanceToPreferredArea({ location: parkdale }, null)).toBeNull();
  });
});
