import { describe, expect, it } from "vitest";
import { overpassQuery, poiRow, schoolLevel, WATERLOO_BBOX } from "./pois.ts";

const node = (id: number, tags: Record<string, string>) => ({
  type: "node" as const,
  id,
  lat: 43.47,
  lon: -80.54,
  tags,
});

describe("poiRow", () => {
  it("files each OSM tag under its category", () => {
    const category = (tags: Record<string, string>) =>
      poiRow(node(1, { name: "X", ...tags }))?.category;
    expect(category({ shop: "supermarket" })).toBe("grocery");
    expect(category({ shop: "greengrocer" })).toBe("grocery");
    expect(category({ amenity: "pharmacy" })).toBe("pharmacy");
    expect(category({ amenity: "doctors" })).toBe("clinic");
    expect(category({ amenity: "university" })).toBe("university");
    expect(category({ amenity: "college" })).toBe("university");
    expect(category({ amenity: "library" })).toBe("library");
    expect(category({ amenity: "community_centre" })).toBe("community_centre");
    expect(category({ leisure: "park" })).toBe("park");
    expect(category({ shop: "convenience" })).toBeUndefined();
  });

  it("places ways and relations at their centre, and skips unnamed places", () => {
    const way = {
      type: "way" as const,
      id: 7,
      center: { lat: 43.4723, lon: -80.5449 },
      tags: { name: "Waterloo Park", leisure: "park" },
    };
    expect(poiRow(way)).toMatchObject({
      id: "osm:way/7",
      location: "SRID=4326;POINT(-80.5449 43.4723)",
      source_id: "openstreetmap",
    });
    expect(poiRow(node(2, { shop: "supermarket" }))).toBeNull();
    expect(poiRow({ type: "way", id: 3, tags: { name: "No centre", leisure: "park" } })).toBeNull();
  });
});

describe("schoolLevel", () => {
  it("reads isced:level first, then the name", () => {
    expect(schoolLevel("Laurelwood Public School", "1")).toBe("elementary");
    expect(schoolLevel("Waterloo Collegiate Institute", "2;3")).toBe("secondary");
    expect(schoolLevel("Waterloo Collegiate Institute")).toBe("secondary");
    expect(schoolLevel("St. Agnes Catholic School")).toBe("elementary");
    expect(schoolLevel("Conestoga Montessori")).toBeNull();
  });
});

describe("overpassQuery", () => {
  it("asks for every category inside the Waterloo box", () => {
    const query = overpassQuery();
    expect(query.match(new RegExp(WATERLOO_BBOX.replace(/\./g, "\\."), "g"))).toHaveLength(8);
    expect(query).toContain("out center tags;");
  });
});
