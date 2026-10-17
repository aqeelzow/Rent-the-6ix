import { describe, expect, it } from "vitest";
import { emptyRawListing, type RawListing } from "../sources/types.ts";
import { normalize, postalCode, unitTypeFrom } from "./normalize.ts";

const NOW = new Date("2026-10-16T12:00:00Z");

function raw(overrides: Partial<RawListing> = {}): RawListing {
  return {
    ...emptyRawListing,
    source: "kijiji",
    sourceListingId: "1",
    sourceUrl: "https://www.kijiji.ca/v-apartments-condos/city-of-toronto/x/1",
    title: "For rent",
    monthlyRentCad: 2450,
    ...overrides,
  };
}

const norm = (overrides: Partial<RawListing> = {}) => {
  const out = normalize(raw(overrides), NOW);
  if (!out) throw new Error("expected a listing");
  return out;
};

describe("normalize: rent", () => {
  it("drops listings with no plausible monthly rent", () => {
    expect(normalize(raw({ monthlyRentCad: 0 }), NOW)).toBeNull();
    expect(normalize(raw({ monthlyRentCad: 95 }), NOW)).toBeNull();
    expect(normalize(raw({ monthlyRentCad: 899_000 }), NOW)).toBeNull();
  });

  it("rounds to whole dollars; a room's rent is per room", () => {
    expect(norm({ monthlyRentCad: 2450.5 }).monthlyRentCad).toBe(2451);
    expect(norm({ title: "Private room for rent near UofT" }).rentIsPerRoom).toBe(true);
  });
});

describe("normalize: structured fields win and are marked structured", () => {
  it("keeps source values and records evidence", () => {
    const out = norm({
      title: "Studio near Queen West, 2 bath",
      bedrooms: 1,
      bathrooms: 1,
      sqft: 600,
      unitType: "condo",
      yearBuilt: 2015,
      airConditioning: false,
      furnished: true,
    });
    expect(out).toMatchObject({
      bedrooms: 1,
      bathrooms: 1,
      sqft: 600,
      unitType: "condo",
      yearBuilt: 2015,
      yearBuiltSource: "listing",
      airConditioning: "no",
      furnished: "yes",
    });
    expect(out.fieldEvidence).toMatchObject({
      bedrooms: "structured",
      unitType: "structured",
      airConditioning: "structured",
      furnished: "structured",
    });
  });

  it("treats out-of-range source values as unknown", () => {
    const out = norm({ sqft: 0, bathrooms: 0, yearBuilt: 3020 });
    expect(out).toMatchObject({
      sqft: null,
      bathrooms: null,
      yearBuilt: null,
      yearBuiltSource: null,
    });
  });

  it("unknown stays unknown, never no", () => {
    const out = norm();
    expect(out).toMatchObject({
      airConditioning: "unknown",
      utilitiesIncluded: "unknown",
      parking: "unknown",
      petsAllowed: "unknown",
      furnished: "unknown",
      laundryInSuite: "unknown",
    });
    expect(out.fieldEvidence).toEqual({});
  });
});

describe("normalize: text rules fill the gaps", () => {
  it("bedrooms: studio/bachelor = 0, digits, words, 1+den", () => {
    expect(norm({ title: "Bachelor apartment, Elm St" }).bedrooms).toBe(0);
    expect(norm({ title: "Spacious 2-Bed/1-Bath apartment" })).toMatchObject({
      bedrooms: 2,
      bathrooms: 1,
    });
    expect(norm({ title: "Jr. 1-Bdm. for Rent" }).bedrooms).toBe(1);
    expect(norm({ title: "Three bedroom house" }).bedrooms).toBe(3);
    const den = norm({ title: "Prime downtown condo – 1 + den" });
    expect(den).toMatchObject({ den: true });
    expect(norm({ title: "2+1 bedroom condo" })).toMatchObject({ bedrooms: 2, den: true });
    expect(den.fieldEvidence.unitType).toBe("parsed_from_text");
  });

  it("unit type from source wording or the title", () => {
    expect(unitTypeFrom("basement-apartment")).toBe("basement");
    expect(unitTypeFrom("Row / Townhouse")).toBe("townhouse");
    expect(unitTypeFrom("duplex-triplex")).toBe("apartment");
    expect(unitTypeFrom("House")).toBe("house");
    expect(unitTypeFrom("1 bedroom condo-inspired apartment")).toBe("apartment");
    expect(unitTypeFrom("house room for rent at north york")).toBe("room");
    expect(unitTypeFrom("something else")).toBeNull();
  });

  it("size in sq ft, m² converted, implausible values dropped", () => {
    expect(norm({ description: "About 650 sq ft of living space" }).sqft).toBe(650);
    expect(norm({ description: "1,200 square feet" }).sqft).toBe(1200);
    expect(norm({ description: "60 m² unit" }).sqft).toBe(646);
    expect(norm({ description: "5 sq ft closet" }).sqft).toBeNull();
    expect(norm({ description: "650 sq ft" }).fieldEvidence.sqft).toBe("parsed_from_text");
  });

  it("year built: explicit year, or new construction → the year it was posted", () => {
    expect(norm({ description: "Building built in 2018" }).yearBuilt).toBe(2018);
    expect(norm({ description: "A 1964-built tower" }).yearBuilt).toBe(1964);
    expect(
      norm({ description: "Brand new building, never lived in", postedAt: "2025-03-01T00:00:00Z" })
        .yearBuilt,
    ).toBe(2025);
    expect(norm({ description: "New construction" }).yearBuilt).toBe(2026);
    expect(norm({ description: "Call before 2018" }).yearBuilt).toBeNull();
  });

  it("air conditioning: central, some kind, none", () => {
    expect(norm({ description: "Central air and heat" }).airConditioning).toBe("central");
    expect(norm({ description: "Window A/C unit provided" }).airConditioning).toBe("yes");
    expect(norm({ description: "No A/C in unit" }).airConditioning).toBe("no");
    expect(norm({ airConditioning: true, description: "central air" }).airConditioning).toBe(
      "central",
    );
    expect(norm({ airConditioning: true }).airConditioning).toBe("yes");
  });

  it("amenities: yes, no, and conflicting phrases stay unknown", () => {
    const yes = norm({
      description:
        "All inclusive. Underground parking included. Pet friendly. Fully furnished. Ensuite laundry.",
    });
    expect(yes).toMatchObject({
      utilitiesIncluded: "yes",
      parking: "yes",
      petsAllowed: "yes",
      furnished: "yes",
      laundryInSuite: "yes",
    });
    const no = norm({
      description:
        "Rent plus utilities. No parking available. No pets allowed. Unfurnished. Shared laundry.",
    });
    expect(no).toMatchObject({
      utilitiesIncluded: "no",
      parking: "no",
      petsAllowed: "no",
      furnished: "no",
      laundryInSuite: "no",
    });
    expect(norm({ title: "Furnished or Unfurnished 1-bedroom" }).furnished).toBe("unknown");
    expect(norm({ description: "Cats only please" }).petsAllowed).toBe("cats_only");
  });

  it("availability and lease term", () => {
    const out = norm({
      description: "Available December 1st. Enjoy 1 month free on a 13 month lease!",
      postedAt: "2026-10-10T00:00:00Z",
    });
    expect(out).toMatchObject({ availableFrom: "2026-12-01", leaseTerm: "13 months" });
    expect(
      norm({ description: "Available Jan 15", postedAt: "2026-10-10T00:00:00Z" }).availableFrom,
    ).toBe("2027-01-15");
    expect(norm({ description: "Month-to-month ok" }).leaseTerm).toBe("month-to-month");
    expect(norm({ availableFrom: "2026-11-31" }).availableFrom).toBeNull();
  });
});

describe("normalize: text, address and location", () => {
  it("scrubs the title and cuts the excerpt", () => {
    const out = norm({ title: "1 bed, call 416-555-0199", description: "x ".repeat(400) });
    expect(out.title).not.toMatch(/555/);
    expect(out.excerpt.length).toBeLessThanOrEqual(280);
  });

  it("formats postal codes and keeps usable coordinates", () => {
    expect(postalCode("m4m2z8")).toBe("M4M 2Z8");
    expect(postalCode("L4L0C6")).toBe("L4L 0C6");
    expect(postalCode("90210")).toBeNull();
    expect(norm({ lat: 43.66, lng: -79.33 }).sourceLocation).toEqual({ lng: -79.33, lat: 43.66 });
    expect(norm({ lat: 0, lng: 0 }).sourceLocation).toBeNull();
  });

  it("normalizes dates to ISO and drops garbage", () => {
    expect(norm({ postedAt: "2026-10-16T02:03:53.000Z" }).postedAt).toBe(
      "2026-10-16T02:03:53.000Z",
    );
    expect(norm({ postedAt: "639278012357830000" }).postedAt).toBeNull();
  });
});
