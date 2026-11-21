import { describe, expect, it } from "vitest";
import {
  addressText,
  detailFields,
  facebookMarketplace,
  facebookTileUrl,
  isHousing,
  parseFacebookDetail,
  parseFacebookIndex,
  unitFacts,
  WATERLOO_TILES,
} from "./facebook-marketplace.ts";
import { SourceBlockedError } from "../lib/fetch.ts";

// Same shape as Facebook's embedded Relay JSON (checked 2026-11-21); every value is made up.
const seller = { __typename: "User", name: "Jane Example", id: "pfbid0example" };
const page = (payload: unknown) =>
  `<html><script type="application/json" data-sjs>${JSON.stringify(payload)}</script></html>`;

const feedItem = (over: Record<string, unknown>) => ({
  __typename: "GroupCommerceProductItem",
  id: "100",
  listing_price: { formatted_amount: "CA$2,180", amount: "2180.00" },
  location: { reverse_geocode: { city: "Waterloo", state: "ON" } },
  is_hidden: false,
  is_live: true,
  is_pending: false,
  is_sold: false,
  marketplace_listing_title: "3 Beds 1 Bath Apartment",
  custom_title: "3 beds · 1 bath",
  custom_sub_titles_with_rendering_flags: [{ subtitle: "Waterloo, ON" }],
  creation_time: 1793784156,
  marketplace_listing_seller: seller,
  primary_listing_photo: { image: { uri: "https://scontent.example/x.jpg" } },
  ...over,
});

const index = page({
  require: [
    [
      "x",
      {
        __bbox: {
          result: {
            data: {
              viewer: {
                marketplace_feed_stories: {
                  edges: [
                    { node: { listing: feedItem({}) } },
                    {
                      node: {
                        listing: feedItem({
                          id: "101",
                          marketplace_listing_title: "5 Beds 2 Baths - House",
                          custom_title: "5 beds · 2 baths · 1,500 sq ft",
                          custom_sub_titles_with_rendering_flags: [
                            { subtitle: "29 Example St W" },
                            { subtitle: "Waterloo, ON" },
                          ],
                        }),
                      },
                    },
                    {
                      node: {
                        listing: feedItem({
                          id: "102",
                          marketplace_listing_title: "Hall for rent",
                          custom_title: null,
                        }),
                      },
                    },
                    { node: { listing: feedItem({ id: "103", is_pending: true }) } },
                    {
                      node: {
                        listing: feedItem({
                          id: "104",
                          marketplace_listing_title: "Room for rent near UW",
                          custom_title: null,
                          listing_price: { amount: "850.00" },
                        }),
                      },
                    },
                  ],
                },
                // The map feed repeats listing 101 with its coordinates.
                marketplace_rentals_map_view_stories: {
                  edges: [
                    {
                      node: {
                        for_sale_item: {
                          __typename: "GroupCommerceProductItem",
                          id: "101",
                          location: { latitude: 43.4776, longitude: -80.5278 },
                          marketplace_listing_title: "5 Beds 2 Baths - House",
                          formatted_price: { text: "CA$4,250" },
                          marketplace_listing_seller: seller,
                        },
                      },
                    },
                  ],
                },
              },
            },
          },
        },
      },
    ],
  ],
});

const detail = page({
  data: {
    viewer: {
      marketplace_product_details_page: {
        target: {
          __typename: "GroupCommerceProductItem",
          id: "101",
          marketplace_listing_title: "5 Beds 2 Baths - House",
          redacted_description: { text: "WINTER 2027 SUBLET\nUpper floor room, close to UW." },
          listing_price: { amount: "4250.00" },
          location: {
            latitude: 43.47763,
            longitude: -80.52778,
            reverse_geocode_detailed: { city: "Waterloo", state: "ON", postal_code: "N2L 1A1" },
          },
          home_address: { street: "29 Example St W" },
          pdp_display_sections: [
            {
              section_type: "UNIT_INCLUDES",
              pdp_fields: [
                { display_label: "House" },
                { display_label: "5 beds · 2 baths" },
                { display_label: "Central AC" },
                { display_label: "In-unit laundry" },
                { display_label: "Cat friendly" },
              ],
            },
            {
              section_type: "UNIT_SUBTITLE",
              pdp_fields: [{ display_label: "29 Example St W, Waterloo, ON" }],
            },
          ],
          marketplace_listing_seller: seller,
        },
      },
    },
  },
});

describe("facebook marketplace index", () => {
  it("reads feed listings, merges the map entry, and skips non-housing and pending ones", () => {
    const rows = parseFacebookIndex(index);
    expect(rows.map((r) => r.sourceListingId).sort()).toEqual(["100", "101", "104"]);
    const house = rows.find((r) => r.sourceListingId === "101")!;
    expect(house).toMatchObject({
      source: "facebook_marketplace",
      sourceUrl: "https://www.facebook.com/marketplace/item/101/",
      title: "5 Beds 2 Baths - House",
      monthlyRentCad: 2180,
      bedrooms: 5,
      bathrooms: 2,
      sqft: 1500,
      unitType: "House",
      address: "29 Example St W, Waterloo, ON",
      lat: 43.4776,
      lng: -80.5278,
      postedAt: new Date(1793784156 * 1000).toISOString(),
      imageUrl: null,
    });
    expect(rows.find((r) => r.sourceListingId === "100")).toMatchObject({
      address: "Waterloo, ON",
      lat: null,
      unitType: null,
    });
    expect(rows.find((r) => r.sourceListingId === "104")).toMatchObject({
      rentIsPerRoom: true,
      unitType: "room",
      monthlyRentCad: 850,
    });
  });

  it("never carries the seller or Facebook's photo links", () => {
    const text = JSON.stringify(parseFacebookIndex(index));
    expect(text).not.toMatch(/Jane Example|pfbid|scontent/);
  });

  it("builds one search URL per 1 km tile", () => {
    expect(WATERLOO_TILES.length).toBeGreaterThan(40);
    const url = new URL(facebookTileUrl(0));
    expect(url.pathname).toBe("/marketplace/category/propertyrentals");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      latitude: "43.5204",
      longitude: "-80.5391",
      radius: "1",
    });
  });

  it("walks the tiles as pages and stops after the last", async () => {
    const session = {
      visit: async (url: string) => ({ status: 200, url, html: index, json: [] }),
      close: async () => {},
    };
    const first = await facebookMarketplace.fetchIndex(session, null);
    expect(first.nextCursor).toBe("1");
    const last = await facebookMarketplace.fetchIndex(session, String(WATERLOO_TILES.length - 1));
    expect(last.nextCursor).toBeNull();
  });

  it("treats a redirect to the login page as a block", async () => {
    const session = {
      visit: async () => ({
        status: 200,
        url: "https://www.facebook.com/login/?next=x",
        html: "",
        json: [],
      }),
      close: async () => {},
    };
    await expect(facebookMarketplace.fetchIndex(session, null)).rejects.toBeInstanceOf(
      SourceBlockedError,
    );
  });
});

describe("facebook marketplace detail", () => {
  it("adds the description, coordinates, address and unit details", () => {
    const patch = parseFacebookDetail(detail, "101");
    expect(patch).toMatchObject({
      description: "WINTER 2027 SUBLET\nUpper floor room, close to UW.",
      lat: 43.47763,
      lng: -80.52778,
      postalCode: "N2L 1A1",
      address: "29 Example St W, Waterloo, ON N2L 1A1",
      monthlyRentCad: 4250,
      airConditioning: "central",
      laundryInSuite: true,
      petsAllowed: true,
      bedrooms: 5,
      bathrooms: 2,
      unitType: "House",
    });
    expect(JSON.stringify(patch)).not.toMatch(/Jane Example|pfbid/);
    expect(parseFacebookDetail(detail, "999")).toEqual({});
  });

  it("maps unit detail labels", () => {
    expect(detailFields(["Private room", "Furnished", "No pets", "Street parking"])).toMatchObject({
      unitType: "room",
      rentIsPerRoom: true,
      furnished: true,
      petsAllowed: false,
      parking: false,
    });
    expect(detailFields(["Apartment", "Unfurnished", "Laundry in building"])).toMatchObject({
      furnished: false,
      laundryInSuite: false,
    });
  });
});

describe("facebook marketplace helpers", () => {
  it("reads beds, baths and size", () => {
    expect(unitFacts("2 beds · 1 bath · 1,000 sq ft")).toEqual({
      bedrooms: 2,
      bathrooms: 1,
      sqft: 1000,
    });
    expect(unitFacts("Studio Apartment")).toMatchObject({ bedrooms: 0 });
  });

  it("tells homes from other rentals", () => {
    expect(isHousing("Home for rent", null)).toBe(true);
    expect(isHousing("Salon Room for Rent", null)).toBe(false);
    expect(isHousing("Parking spot for rent at Westcourt Pl", null)).toBe(false);
    expect(isHousing("Dance floor for rent", null)).toBe(false);
    expect(isHousing("Anything", "2 beds · 1 bath")).toBe(true);
  });

  it("writes an address geocode can match, or just the city", () => {
    expect(addressText("29 Example St W", "Waterloo", "N2L 1A1")).toBe(
      "29 Example St W, Waterloo, ON N2L 1A1",
    );
    expect(addressText(null, "Kitchener")).toBe("Kitchener, ON");
    expect(addressText(null, null)).toBeNull();
  });
});
