import { describe, expect, it } from "vitest";
import { emptyRawListing } from "../sources/types.ts";
import { normalize } from "./normalize.ts";
import { toRow } from "./upsert.ts";

const listing = normalize(
  {
    ...emptyRawListing,
    source: "kijiji",
    sourceListingId: "42",
    sourceUrl: "https://www.kijiji.ca/v-x/42",
    title: "Bright 1 bed",
    description: "Central air. Ensuite laundry. About 600 sq ft.",
    monthlyRentCad: 2450,
    bedrooms: 1,
    lat: 43.65,
    lng: -79.4,
  },
  new Date("2026-10-16T00:00:00Z"),
)!;

describe("toRow", () => {
  it("maps to listings columns with an EWKT point at street precision", () => {
    const row = toRow(listing, "2026-10-17T04:40:09.143Z")!;
    expect(row).toMatchObject({
      source: "kijiji",
      source_listing_id: "42",
      monthly_rent_cad: 2450,
      bedrooms: 1,
      air_conditioning: "central",
      laundry_in_suite: "yes",
      utilities_included: "unknown",
      sqft: 600,
      location: "SRID=4326;POINT(-79.4 43.65)",
      location_precision: "street",
      first_seen_at: "2026-10-17T04:40:09.143Z",
      last_seen_at: "2026-10-17T04:40:09.143Z",
    });
    expect(row.field_evidence).toMatchObject({
      bedrooms: "structured",
      airConditioning: "parsed_from_text",
    });
  });

  it("stores the thumbnail link, or null", () => {
    const thumb = "https://media.kijiji.ca/a.jpg";
    expect(toRow({ ...listing, imageUrl: thumb }, "2026-10-17T00:00:00Z")!.image_url).toBe(thumb);
    expect(toRow(listing, "2026-10-17T00:00:00Z")!.image_url).toBeNull();
  });

  it("skips listings without coordinates (location is required)", () => {
    expect(toRow({ ...listing, sourceLocation: null }, "2026-10-17T00:00:00Z")).toBeNull();
  });
});
