import { describe, expect, it } from "vitest";
import {
  findEmbeddedResults,
  findResults,
  parseRentalListings,
  torontoRentals,
} from "./rentals-network.ts";
import { NoResultsError } from "./types.ts";

// Same shape as torontorentals.com's /graphql results (checked 2026-10-16); values are made up.
const results = {
  data: {
    rentalListings: {
      pageInfo: { hasNextPage: true },
      edges: [
        {
          node: {
            id: "abc",
            name: "Example Towers ",
            path: "toronto/1-example-avenue",
            type: "apartment",
            location: [-79.39, 43.7],
            modified: "2026-05-01T12:00:00+00:00",
            address: { street: "1 Example Avenue", postalCode: "M4S 1A1" },
            building: { yearBuilt: 1964 },
            petOptions: ["all"],
            contact: {
              name: "Leasing Agent",
              phoneNumber: "(416) 555-0100",
              email: "leasing@example.com",
            },
            floorPlans: [
              {
                beds: 1.5,
                baths: 1,
                rent: 2400,
                size: 600,
                availability: { date: null, now: true },
                furnished: "no",
                externalId: "p1",
                parkingSpots: 0,
              },
              {
                beds: 0,
                baths: 1,
                rent: 1900,
                size: 0,
                availability: { date: "2026-11-05T00:00:00Z", now: false },
                furnished: "yes",
                externalId: "p2",
                parkingSpots: 1,
              },
              { beds: 2, baths: 2, rent: null, externalId: "p3" },
            ],
          },
        },
      ],
    },
  },
};

describe("rentals network", () => {
  it("picks the results response over map-marker responses", () => {
    const markers = { data: { rentalListings: { edges: [{ node: { id: "x", path: "p" } }] } } };
    expect(findResults([markers, results])).toBe(results);
    expect(findResults([markers])).toBeNull();
  });

  it("turns each priced floor plan into a listing and never reads the contact", () => {
    const rows = parseRentalListings("torontorentals", "https://www.torontorentals.com", results);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      sourceListingId: "p1",
      sourceUrl: "https://www.torontorentals.com/toronto/1-example-avenue",
      title: "1 bed + den at Example Towers",
      monthlyRentCad: 2400,
      bedrooms: 1,
      den: true,
      sqft: 600,
      yearBuilt: 1964,
      furnished: false,
      petsAllowed: true,
      parking: null,
      lat: 43.7,
      lng: -79.39,
      address: "1 Example Avenue, Toronto, ON M4S 1A1",
    });
    expect(rows[1]).toMatchObject({
      title: "Studio at Example Towers",
      bedrooms: 0,
      sqft: null,
      parking: true,
      availableFrom: "2026-11-05",
    });
    expect(JSON.stringify(rows)).not.toMatch(/555-0100|leasing@example\.com|Leasing Agent/);
  });
});

describe("rentals.ca embedded results", () => {
  it("maps App.store.search to the /graphql shape; a den is half a bedroom", () => {
    const response = {
      data: {
        pageInfo: { hasNextPage: true },
        edges: [
          {
            node: {
              id: "r1",
              path: "toronto/44-example-avenue",
              rentalListingName: "Example Place",
              rentalListingLocation: [-79.39, 43.68],
              listingType: "residential:apartment:apartment",
              address: { street: "44 Example Avenue", postalCode: "M4T 1E5" },
              contact: { name: "Leasing Office", phone: "416-555-0100" },
              petOptions: ["all"],
              floorPlans: [
                { beds: 1, baths: 1, rent: 2275, sqft: 600, den: true, parkingSpots: 0 },
              ],
            },
          },
        ],
      },
    };
    const html = `<script>AppStartup.push(function() { App.store.search = { response: ${JSON.stringify(response)}, other: 1 }; });</script>`;
    const page = findEmbeddedResults(html)!;
    const [row] = parseRentalListings("rentals_ca", "https://rentals.ca", page);
    expect(row).toMatchObject({
      sourceUrl: "https://rentals.ca/toronto/44-example-avenue",
      title: "1 bed + den at Example Place",
      bedrooms: 1,
      den: true,
      unitType: "apartment",
      sqft: 600,
      lat: 43.68,
    });
    expect(JSON.stringify(row)).not.toMatch(/555-0100|Leasing Office/);
    expect(findEmbeddedResults("<html></html>")).toBeNull();
  });
});

describe("fetchIndex", () => {
  it("throws NoResultsError when a page has no results, so the pipeline can tell the end apart", async () => {
    const session = {
      visit: async () => ({ status: 200, url: "", html: "<html></html>", json: [] }),
      close: async () => {},
    };
    await expect(torontoRentals.fetchIndex(session, "409")).rejects.toBeInstanceOf(NoResultsError);
  });
});
