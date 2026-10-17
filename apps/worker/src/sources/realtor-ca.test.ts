import { describe, expect, it } from "vitest";
import {
  findRealtorResults,
  nextTileCursor,
  parseRealtor,
  realtorMapUrl,
  ticksToIso,
  TORONTO_BOX,
} from "./realtor-ca.ts";

// Same shape as Realtor.ca's PropertySearch_Post response (checked 2026-10-16); values are made up.
const response = {
  Paging: { CurrentPage: 1, TotalPages: 3 },
  Results: [
    {
      MlsNumber: "N1",
      RelativeDetailsURL: "/real-estate/1/example",
      PublicRemarks: "Bright unit",
      InsertedDateUTC: "639278012357830000",
      PostalCode: "M5V1A1",
      Building: { Bedrooms: "2 + 1", BathroomTotal: "2", SizeInterior: "74 m2", Type: "Apartment" },
      Property: {
        LeaseRent: "$2,800.00/Monthly",
        Address: {
          AddressText: "1 EXAMPLE ST|Toronto, Ontario M5V1A1",
          Latitude: "43.64",
          Longitude: "-79.39",
        },
      },
    },
    { MlsNumber: "N2", RelativeDetailsURL: "/real-estate/2/example", Property: {} },
  ],
};

describe("realtor.ca", () => {
  it("parses a results response; skips rows without rent", () => {
    expect(findRealtorResults([{}, response])).toBe(response);
    const rows = parseRealtor(response);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sourceListingId: "N1",
      sourceUrl: "https://www.realtor.ca/real-estate/1/example",
      monthlyRentCad: 2800,
      bedrooms: 2,
      den: true,
      bathrooms: 2,
      sqft: 797,
      address: "1 EXAMPLE ST, Toronto, Ontario M5V1A1",
      lat: 43.64,
      postedAt: "2026-10-17T02:33:55.783Z",
    });
  });

  it("converts .NET ticks to ISO", () => {
    expect(ticksToIso("621355968000000000")).toBe("1970-01-01T00:00:00.000Z");
    expect(ticksToIso("not a number")).toBeNull();
    expect(ticksToIso(undefined)).toBeNull();
  });
});

describe("realtor.ca map tiles", () => {
  const paging = (TotalRecords: number, TotalPages: number) => ({
    TotalRecords,
    TotalPages,
    MaxRecords: 600,
  });

  it("splits a view that holds more than it serves into four tiles", () => {
    const next = nextTileCursor({ queue: [TORONTO_BOX], page: 1 }, paging(8662, 55));
    expect(next?.page).toBe(1);
    expect(next?.queue).toHaveLength(4);
    expect(next?.queue[0]).toEqual({
      latMin: 43.7185,
      latMax: 43.856,
      lngMin: -79.639,
      lngMax: -79.377,
    });
  });

  it("pages through a tile that fits, then moves to the next tile, then stops", () => {
    const a = { latMin: 43.6, latMax: 43.62, lngMin: -79.4, lngMax: -79.38 };
    const b = { ...a, lngMin: -79.38, lngMax: -79.36 };
    expect(nextTileCursor({ queue: [a, b], page: 1 }, paging(30, 3))).toEqual({
      queue: [a, b],
      page: 2,
    });
    expect(nextTileCursor({ queue: [a, b], page: 3 }, paging(30, 3))).toEqual({
      queue: [b],
      page: 1,
    });
    expect(nextTileCursor({ queue: [b], page: 3 }, paging(30, 3))).toBeNull();
  });

  it("doesn't split below ~1 km, even when the tile is over the cap", () => {
    const tiny = { latMin: 43.64, latMax: 43.648, lngMin: -79.39, lngMax: -79.38 };
    expect(nextTileCursor({ queue: [tiny], page: 1 }, paging(900, 55))).toEqual({
      queue: [tiny],
      page: 2,
    });
  });

  it("builds a rentals-only map URL for the tile and page", () => {
    const url = new URL(realtorMapUrl(TORONTO_BOX, 3));
    const hash = new URLSearchParams(url.hash.slice(1));
    expect(url.pathname).toBe("/map");
    expect(Object.fromEntries(hash)).toMatchObject({
      LatitudeMax: "43.8560",
      LongitudeMin: "-79.6390",
      TransactionTypeId: "3",
      CurrentPage: "3",
      ZoomLevel: "11",
    });
  });
});
