import { commuteCarbon, type CommuteCarbon } from "@rentthe6ix/shared/engine/carbon";
import { searchFixture, travelIntent } from "@rentthe6ix/shared/fixtures";
import { TravelTargetSchema, type TravelTarget, type TravelTimeRow } from "@rentthe6ix/shared/schemas";
import { describe, expect, it } from "vitest";
import type { SearchResultItem } from "@/lib/store/types";
import {
  carbonSummary,
  effectiveResultOrder,
  formatCo2e,
  formatDistance,
  orderByCarbon,
  orderByPreferredDistance,
  preferredAreaText,
} from "./travel-facts-data";

const results = searchFixture.status === "completed" ? searchFixture.results : [];

const target = (mode: TravelTarget["mode"], extra: Partial<TravelTarget> = {}): TravelTarget =>
  TravelTargetSchema.parse({
    id: "work",
    kind: "place",
    label: "Work",
    query: "work",
    mode,
    hard: false,
    ...extra,
  });

// The card's own targets come from the intent; these stand in for the modes being measured.
const walkTarget = target("walk", { id: "campus", maxMinutes: 10 });
const driveTarget = target("drive");
const transitTarget = target("transit", { maxMinutes: 40 });
const fixtureTargets = travelIntent.travelTargets;

const row = (
  listing: SearchResultItem["listing"],
  targetId: string,
  over: Partial<TravelTimeRow>,
): TravelTimeRow => ({
  listingId: listing.id,
  targetId,
  mode: "walk",
  distanceM: 1_000,
  poiId: null,
  computedAt: "2026-10-17T12:00:00Z",
  method: "otp",
  minutes: 8,
  ...over,
});

const resultWith = (index: number, travel: TravelTimeRow[]): SearchResultItem => ({
  ...results[index]!,
  travel,
});

describe("carbonSummary", () => {
  it("says a car-free commute needs no car, and stays quiet before anything is routed", () => {
    const listing = results[0]!.listing;
    const carFree = commuteCarbon([walkTarget], [row(listing, "campus", { mode: "walk", minutes: 9 })]);
    expect(carbonSummary(carFree)).toEqual({ kind: "carFree" });

    expect(carbonSummary(commuteCarbon([walkTarget], []))).toEqual({ kind: "unrouted" });
    expect(
      carbonSummary(
        commuteCarbon([walkTarget], [row(listing, "campus", { method: "straight_line", minutes: null })]),
      ),
    ).toEqual({ kind: "unrouted" });
  });

  it("shows the driven figure and whose trip it is", () => {
    const listing = results[0]!.listing;
    const carbon = commuteCarbon(
      [driveTarget],
      [row(listing, "work", { mode: "drive", distanceM: 5_000, minutes: 20 })],
    );
    expect(carbonSummary(carbon)).toEqual({ kind: "figure", grams: 905, mode: "drive" });
  });

  it("never presents an unquantified transit trip as clean, and offers the driving comparison", () => {
    const listing = results[0]!.listing;
    const carbon = commuteCarbon(
      [transitTarget],
      [
        row(listing, "work", { mode: "transit", distanceM: 6_000, minutes: 30 }),
        row(listing, "work", { mode: "drive", distanceM: 5_000, minutes: 18 }),
      ],
    );
    expect(carbonSummary(carbon)).toEqual({ kind: "transitUnknown", driveGrams: 905 });
  });

  it("reads the fixture intent's own commute as car-free when it is inside the stated limit", () => {
    const listing = results[0]!.listing;
    const carbon: CommuteCarbon = commuteCarbon(fixtureTargets, [
      row(listing, fixtureTargets[0]!.id, { mode: "bike", distanceM: 2_000, minutes: 8 }),
    ]);
    expect(carbon.carFree).toBe("yes");
    expect(carbonSummary(carbon)).toEqual({ kind: "carFree" });
  });
});

describe("formatting", () => {
  it("reads small emissions in grams and large ones in kilograms", () => {
    expect(formatCo2e(0)).toBe("0 g");
    expect(formatCo2e(724)).toBe("724 g");
    expect(formatCo2e(1_810)).toBe("1.8 kg");
    expect(formatCo2e(24_000)).toBe("24 kg");
  });

  it("reads short distances in metres, rounded to tens", () => {
    expect(formatDistance(0)).toBe("0 m");
    expect(formatDistance(404)).toBe("400 m");
    expect(formatDistance(940)).toBe("940 m");
    expect(formatDistance(6_763)).toBe("6.8 km");
    expect(formatDistance(23_400)).toBe("23 km");
  });
});

describe("orderByCarbon", () => {
  it("puts car-free commutes first, then the smallest figure, then the unknown", () => {
    // Four distinct listings, one per behaviour, all measured against the same driving target
    // except the walking one, which is the only car-free commute of the four.
    const walk = resultWith(0, [row(results[0]!.listing, "campus", { mode: "walk" })]);
    const near = resultWith(1, [row(results[1]!.listing, "work", { mode: "drive", distanceM: 2_000 })]);
    const far = resultWith(2, [row(results[2]!.listing, "work", { mode: "drive", distanceM: 40_000 })]);
    const unknown = resultWith(3, [row(results[3]!.listing, "work", { mode: "transit", distanceM: 6_000 })]);
    // Each listing is measured against the target whose mode its row answers, as the card does
    // with the intent's own targets.
    const plans = new Map([
      [walk.listing.id, [walkTarget]],
      [near.listing.id, [driveTarget]],
      [far.listing.id, [driveTarget]],
      [unknown.listing.id, [transitTarget]],
    ]);
    const ordered = orderByCarbon([unknown, far, near, walk], (result) =>
      commuteCarbon(plans.get(result.listing.id) ?? [], result.travel),
    );
    expect(ordered.map((result) => result.listing.id)).toEqual([
      walk.listing.id,
      near.listing.id,
      far.listing.id,
      unknown.listing.id,
    ]);
    expect(new Set(ordered.map((result) => result.listing.id)).size).toBe(4);
  });

  it("leaves the original array alone", () => {
    const list = [
      resultWith(0, [row(results[0]!.listing, "work", { mode: "drive", distanceM: 30_000 })]),
      resultWith(1, [row(results[1]!.listing, "campus", { mode: "walk" })]),
    ];
    const before = [...list];
    const plans = new Map([
      [list[0]!.listing.id, [driveTarget]],
      [list[1]!.listing.id, [walkTarget]],
    ]);
    orderByCarbon(list, (result) => commuteCarbon(plans.get(result.listing.id) ?? [], result.travel));
    expect(list).toEqual(before);
  });
});

describe("orderByPreferredDistance", () => {
  const at = (index: number, lat: number, lng: number): SearchResultItem => ({
    ...results[index]!,
    travel: [],
    listing: { ...results[index]!.listing, location: { lat, lng } },
  });
  // The reference sits at 43.66/-79.40, so every listing's distance is measured from one point.
  const reference = { label: "U of T", point: { lat: 43.66, lng: -79.4 }, kind: "place" as const };

  it("puts the nearest first", () => {
    const far = at(0, 43.7, -79.4);
    const near = at(2, 43.661, -79.4);
    const mid = at(3, 43.675, -79.4);
    const list = [far, near, mid] as SearchResultItem[];
    const before = [...list];
    const ordered = orderByPreferredDistance(list, reference);
    expect(ordered.map((result) => result.listing.id)).toEqual([
      near.listing.id,
      mid.listing.id,
      far.listing.id,
    ]);
    // The results the store holds keep B's ranking; only the rendered order changes.
    expect(list).toEqual(before);
  });

  it("leaves the list as it was when there is no place to measure from", () => {
    const list = [at(0, 43.7, -79.4), at(1, 43.661, -79.4)];
    expect(orderByPreferredDistance(list, null)).toEqual(list);
  });
});

describe("effectiveResultOrder", () => {
  it("falls back to the server's ranking when a local order has nothing to measure", () => {
    const unrouted = [resultWith(0, []), resultWith(1, [])];
    // Walk and bike trips count as routed, so a car-free commute is still comparable.
    const routed = [resultWith(0, [row(results[0]!.listing, "work", { mode: "walk" })])];
    expect(effectiveResultOrder("carbon", unrouted, travelIntent)).toBe("server");
    expect(effectiveResultOrder("carbon", routed, travelIntent)).toBe("carbon");
    // The fixture intent names a place, so distance ordering is available for it.
    expect(effectiveResultOrder("distance", routed, travelIntent)).toBe("distance");
    expect(effectiveResultOrder("distance", routed, null)).toBe("server");
  });
});

describe("preferredAreaText", () => {
  it("names the place the renter used, and falls back to an unnamed area", () => {
    const reference = { label: "U of T", point: { lat: 43.66, lng: -79.4 }, kind: "place" as const };
    expect(preferredAreaText(1_240, reference)).toEqual({ distance: "1.2 km", place: "U of T" });
    expect(preferredAreaText(600, { ...reference, label: null })).toEqual({
      distance: "600 m",
      place: null,
    });
    expect(preferredAreaText(null, reference)).toBeNull();
    expect(preferredAreaText(1_240, null)).toBeNull();
  });
});
