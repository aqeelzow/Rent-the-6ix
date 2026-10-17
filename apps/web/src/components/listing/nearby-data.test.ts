import { describe, expect, it } from "vitest";
import type { NearbyResponse } from "@/lib/store/types";
import {
  displayName,
  formatDistance,
  moreRows,
  nearestRows,
  orderedCategories,
  stationName,
  tileRows,
} from "./nearby-data";

describe("formatDistance", () => {
  it("uses metres under a kilometre and kilometres above", () => {
    expect(formatDistance(38)).toBe("40 m");
    expect(formatDistance(4)).toBe("10 m");
    expect(formatDistance(354)).toBe("350 m");
    expect(formatDistance(994)).toBe("990 m");
    expect(formatDistance(1000)).toBe("1.0 km");
    expect(formatDistance(5383)).toBe("5.4 km");
  });
});

describe("displayName", () => {
  it("title-cases names published in capitals and leaves mixed case alone", () => {
    expect(displayName("TERRY FOX PUBLIC SCHOOL")).toBe("Terry Fox Public School");
    expect(displayName("L'AMOREAUX COMMUNITY RECREATION CENTRE")).toBe(
      "L'Amoreaux Community Recreation Centre",
    );
    expect(displayName("SENECA COLLEGE (NEWNHAM CAMPUS)")).toBe("Seneca College (Newnham Campus)");
    expect(displayName("Shoppers Drug Mart")).toBe("Shoppers Drug Mart");
    expect(displayName("大統華 T&T Supermarket")).toBe("大統華 T&T Supermarket");
  });
});

describe("stationName", () => {
  it("drops TTC platform suffixes and leaves other stop names alone", () => {
    expect(stationName("King Station - Southbound Platform")).toBe("King Station");
    expect(stationName("Don Mills Station - Subway Platform")).toBe("Don Mills Station");
    expect(stationName("Cherry St at Mill St South Side")).toBe("Cherry St at Mill St South Side");
  });
});

describe("orderedCategories", () => {
  it("puts everyday needs first and drops empty categories", () => {
    const place = {
      id: "p",
      name: "x",
      subcategory: null,
      distanceM: 1,
      location: { lat: 43.7, lng: -79.4 },
    };
    const nearby = {
      listingId: "11111111-1111-4111-8111-111111111111",
      locationPrecision: "exact",
      method: "straight_line",
      categories: [
        { category: "university", places: [{ ...place, category: "university" }] },
        { category: "park", places: [] },
        { category: "grocery", places: [{ ...place, category: "grocery" }] },
      ],
      stops: [],
      nearestRapid: null,
    } as NearbyResponse;
    expect(orderedCategories(nearby).map((group) => group.category)).toEqual([
      "grocery",
      "university",
    ]);
  });
});

describe("rows", () => {
  const place = (
    id: string,
    name: string,
    distanceM: number,
    subcategory: string | null = null,
  ) => ({
    id,
    name,
    subcategory,
    distanceM,
    location: { lat: 43.65, lng: -79.36 },
  });
  const nearby = {
    listingId: "11111111-1111-4111-8111-111111111111",
    locationPrecision: "street",
    method: "straight_line",
    categories: [
      {
        category: "park",
        places: [place("p1", "DIAMOND JUBILEE PROMENADE", 270)].map((p) => ({
          ...p,
          category: "park",
        })),
      },
      {
        category: "school",
        places: [
          place("s1", "TERRY FOX PUBLIC SCHOOL", 280, "elementary"),
          place("s2", "Inglenook", 360),
        ].map((p) => ({ ...p, category: "school" })),
      },
      {
        category: "grocery",
        places: [
          place("g1", "Marché Leo's", 220),
          place("g2", "No Frills", 770),
          place("g3", "FreshCo", 890),
        ].map((p) => ({ ...p, category: "grocery" })),
      },
    ],
    stops: [
      {
        id: "t1",
        name: "Distillery Loop",
        isRapid: false,
        routeTypes: ["0"],
        distanceM: 50,
        location: { lat: 0, lng: 0 },
      },
      {
        id: "t2",
        name: "Cherry St at Mill St",
        isRapid: false,
        routeTypes: ["0"],
        distanceM: 70,
        location: { lat: 0, lng: 0 },
      },
    ],
    nearestRapid: {
      id: "r1",
      name: "King Station - Southbound Platform",
      isRapid: true,
      routeTypes: ["1"],
      distanceM: 1700,
      location: { lat: 0, lng: 0 },
    },
  } as NearbyResponse;

  it("lists only the nearest place per category, then the nearest stop and station", () => {
    expect(nearestRows(nearby)).toEqual([
      { kind: "grocery", name: "Marché Leo's", distanceM: 220, detail: null },
      { kind: "park", name: "Diamond Jubilee Promenade", distanceM: 270, detail: null },
      { kind: "school", name: "Terry Fox Public School", distanceM: 280, detail: "elementary" },
      { kind: "stop", name: "Distillery Loop", distanceM: 50, detail: null },
      { kind: "rapid", name: "King Station", distanceM: 1700, detail: null },
    ]);
  });

  it("keeps the rest for Show more, and picks grocery, station and park for the tile", () => {
    expect(moreRows(nearby).map((g) => [g.kind, g.rows.map((r) => r.name)])).toEqual([
      ["grocery", ["No Frills", "FreshCo"]],
      ["school", ["Inglenook"]],
      ["stop", ["Cherry St at Mill St"]],
    ]);
    expect(tileRows(nearby).map((r) => r.kind)).toEqual(["grocery", "rapid", "park"]);
  });
});
