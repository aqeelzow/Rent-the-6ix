import { describe, expect, it } from "vitest";
import { findRealtorResults, parseRealtor, ticksToIso } from "./realtor-ca.ts";

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
