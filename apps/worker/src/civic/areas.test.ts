import { describe, expect, it } from "vitest";
import { addressId, splitUnit, toBuildingRows } from "./address-points.ts";
import { districtNumber, neighbourhoodId } from "./areas.ts";

describe("Waterloo neighbourhood ids", () => {
  it("slugs the district plan label under the WPD- prefix", () => {
    expect(neighbourhoodId("Beechwood West")).toBe("WPD-beechwood-west");
    expect(neighbourhoodId("UW Research and Technology Park")).toBe(
      "WPD-uw-research-and-technology-park",
    );
    expect(neighbourhoodId("Lakeshore North / Conservation")).toBe(
      "WPD-lakeshore-north-conservation",
    );
    expect(() => neighbourhoodId(" / ")).toThrow();
  });

  it("reads the plan number when there is one", () => {
    expect(districtNumber("W17")).toBe(17);
    expect(districtNumber(" ")).toBeNull();
    expect(districtNumber(null)).toBeNull();
  });
});

describe("Waterloo address points", () => {
  const point = (civic: string, street: string, lng: number, lat: number) => ({
    type: "Feature" as const,
    geometry: { type: "Point", coordinates: [lng, lat] },
    properties: { CIVIC_ADDR: civic, STREET_NM: street },
  });

  it("splits the unit off a civic address", () => {
    expect(splitUnit("155 CAROLINE ST S 1804", "CAROLINE ST S")).toEqual({
      building: "155 CAROLINE ST S",
      unit: "1804",
    });
    expect(splitUnit("250 ALBERT ST ", "ALBERT ST")).toEqual({
      building: "250 ALBERT ST",
      unit: null,
    });
    expect(splitUnit("275F LARCH ST 605", "LARCH ST")).toEqual({
      building: "275F LARCH ST",
      unit: "605",
    });
    // Street name not where expected: keep the whole address.
    expect(splitUnit("12 KING ST N", "ERB ST")).toEqual({ building: "12 KING ST N", unit: null });
  });

  it("merges a building's units into one point at their average", () => {
    const { rows, units, skipped } = toBuildingRows([
      point("155 CAROLINE ST S 1804", "CAROLINE ST S", -80.5, 43.4),
      point("155 CAROLINE ST S 1805", "CAROLINE ST S", -80.6, 43.6),
      point("213 PASTERN TRAIL", "PASTERN TRAIL", -80.4869, 43.4891),
      { type: "Feature" as const, geometry: null, properties: { CIVIC_ADDR: "1 A ST" } },
    ]);
    expect({ units, skipped }).toEqual({ units: 2, skipped: 1 });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      id: "WAT:155 CAROLINE ST S",
      address_norm: "155 CAROLINE ST S",
      location: "SRID=4326;POINT(-80.5500000 43.5000000)",
    });
    expect(rows[1]).toMatchObject({
      id: "WAT:213 PASTERN TRAIL",
      address_norm: "213 PASTERN TRL",
      ward_id: null,
    });
    expect(addressId(" 213  Pastern Trail ")).toBe("WAT:213 PASTERN TRAIL");
  });
});
