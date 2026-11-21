import { describe, expect, it } from "vitest";
import { toRow, addressId } from "./address-points.ts";
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
  it("turns a layer feature into a row", () => {
    expect(addressId(" 213  Pastern Trail ")).toBe("WAT:213 PASTERN TRAIL");
    expect(
      toRow({
        type: "Feature",
        geometry: { type: "Point", coordinates: [-80.4869, 43.4891] },
        properties: { CIVIC_ADDR: "213 PASTERN TRAIL" },
      }),
    ).toMatchObject({
      id: "WAT:213 PASTERN TRAIL",
      address_full: "213 PASTERN TRAIL",
      address_norm: "213 PASTERN TRL",
      location: "SRID=4326;POINT(-80.4869 43.4891)",
      ward_id: null,
    });
  });

  it("skips a feature without an address or a point", () => {
    const base = { type: "Feature" as const, properties: { CIVIC_ADDR: "1 A ST" } };
    expect(toRow({ ...base, geometry: null })).toBeNull();
    expect(
      toRow({
        ...base,
        geometry: { type: "Point", coordinates: [-80.5, 43.5] },
        properties: {},
      }),
    ).toBeNull();
  });
});
