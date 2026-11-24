import { describe, expect, it } from "vitest";
import { overpassQuery, poiRow, poiRows, schoolLevel, WATERLOO_BBOX } from "./pois.ts";

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
    // Every category as nodes, ways and relations.
    expect(query.match(new RegExp(WATERLOO_BBOX.replace(/\./g, "\\."), "g"))).toHaveLength(24);
    expect(query).toContain("out center tags;");
    expect(query).toContain("out body geom;");
  });
});

describe("poiRows", () => {
  const square = (lon: number, lat: number, size: number) => [
    { lon, lat },
    { lon: lon + size, lat },
    { lon: lon + size, lat: lat + size },
    { lon, lat: lat + size },
    { lon, lat },
  ];

  it("places each large part of a campus at its own centroid, skipping slivers and far sites", () => {
    const rows = poiRows({
      type: "relation",
      id: 42,
      tags: { name: "Example Polytechnic", amenity: "university" },
      members: [
        { type: "way", role: "outer", geometry: square(-80.55, 43.465, 0.01) }, // main campus
        { type: "way", role: "outer", geometry: square(-80.54, 43.474, 0.0001) }, // a sliver
        { type: "way", role: "outer", geometry: square(-80.99, 43.36, 0.01) }, // Stratford
        { type: "way", role: "inner", geometry: square(-80.548, 43.467, 0.002) },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "osm:relation/42#1",
      category: "university",
      name: "Example Polytechnic",
    });
    const [lon, lat] = rows[0]!.location
      .match(/POINT\((\S+) (\S+)\)/)!
      .slice(1)
      .map(Number);
    expect(lon).toBeCloseTo(-80.545, 5);
    expect(lat).toBeCloseTo(43.47, 5);
  });

  it("puts the University of Waterloo at its main campus, as one row", () => {
    const rows = poiRows({
      type: "relation",
      id: 11680616,
      tags: { name: "University of Waterloo", amenity: "university" },
      members: [
        { type: "way", role: "outer", geometry: square(-80.56, 43.47, 0.01) },
        { type: "way", role: "outer", geometry: square(-80.54, 43.465, 0.01) },
      ],
    });
    expect(rows).toEqual([
      expect.objectContaining({
        id: "osm:relation/11680616",
        location: "SRID=4326;POINT(-80.5449 43.4723)",
      }),
    ]);
  });

  it("keeps a node or way as one row", () => {
    expect(poiRows(node(5, { name: "Zehrs", shop: "supermarket" }))).toHaveLength(1);
  });
});
