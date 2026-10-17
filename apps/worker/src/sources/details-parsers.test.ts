import { describe, expect, it } from "vitest";
import { parseKijiji } from "./kijiji.ts";
import { parseRealtorDetail } from "./realtor-ca.ts";
import { parseZillowDetail } from "./zillow.ts";

// Same shapes as the live detail pages (checked 2026-10-16); values are made up.
const nextData = (data: object) =>
  `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></html>`;

describe("kijiji detail page", () => {
  it("reads the full HTML description and the lease term; never the poster", () => {
    const listing = {
      __typename: "RealEstateListing",
      id: "9",
      title: "Renovated 1 bed",
      url: "https://www.kijiji.ca/v-apartments-condos/city-of-toronto/x/9",
      description: "<b>Renovated one bedroom.</b>\n<br>Near Church &amp; Wellesley.",
      price: { __typename: "StandardAmountPrice", amount: 210000 },
      posterInfo: { name: "Jane Landlord", phoneNumber: "4165550100" },
      attributes: {
        all: [
          { canonicalName: "agreementtype", canonicalValues: ["one-year"] },
          { canonicalName: "airconditioning", canonicalValues: ["1"] },
        ],
      },
    };
    const html = nextData({
      props: { pageProps: { __APOLLO_STATE__: { "RealEstateListing:9": listing } } },
    });
    const [row] = parseKijiji(html).listings;
    expect(row).toMatchObject({
      description: "Renovated one bedroom.\nNear Church & Wellesley.",
      leaseTerm: "12 months",
      airConditioning: true,
    });
    expect(JSON.stringify(row)).not.toMatch(/Jane|555/);
  });
});

describe("zillow detail page", () => {
  it("unit page: facts from gdpClientCache", () => {
    const cache = {
      "ForRentShopperPlatformFullRenderQuery{}": {
        property: {
          description: "Bright basement suite",
          resoFacts: {
            laundryFeatures: ["In Unit"],
            hasPetsAllowed: false,
            parkingCapacity: 1,
            cooling: ["Central Air"],
            furnished: false,
            livingArea: "1,050 sqft",
            leaseTerm: "1 Year",
            availabilityDate: Date.UTC(2026, 10, 1),
          },
        },
      },
    };
    const html = nextData({
      props: { pageProps: { componentProps: { gdpClientCache: JSON.stringify(cache) } } },
    });
    expect(parseZillowDetail(html)).toEqual({
      description: "Bright basement suite",
      laundryInSuite: true,
      petsAllowed: false,
      parking: true,
      airConditioning: "central",
      furnished: null,
      sqft: 1050,
      yearBuilt: null,
      leaseTerm: "12 months",
      availableFrom: "2026-11-01",
    });
  });

  it("building page: amenities, pets and year built", () => {
    const building = {
      description: "Condo-quality rental suites.",
      structuredAmenities: {
        unitFeatures: { amenityGroups: [{ title: "Cooling", amenities: ["Air Conditioning"] }] },
        buildingAmenities: { amenityGroups: [{ title: "Other", amenities: ["Laundry: In Unit"] }] },
      },
      amenitySummary: { buildingDetails: ["6 units", "built in 2025"] },
      detailedPetPolicy: { petPolicies: [{ allowed: false }, { allowed: true }] },
    };
    const html = nextData({
      props: { pageProps: { componentProps: { initialReduxState: { gdp: { building } } } } },
    });
    expect(parseZillowDetail(html)).toEqual({
      description: "Condo-quality rental suites.",
      airConditioning: true,
      laundryInSuite: true,
      petsAllowed: true,
      yearBuilt: 2025,
    });
  });

  it("anything else: no patch", () => {
    expect(parseZillowDetail("<html></html>")).toEqual({});
  });
});

describe("realtor.ca detail page", () => {
  const field = (label: string, value: string) =>
    `<div class="propertyDetailsSectionContentLabel">${label}</div>
     <div class="propertyDetailsSectionContentValue">
        ${value}
     </div>`;

  it("reads cooling, washer + dryer and parking spaces", () => {
    const html = `<div id="propertyDescriptionCon">
        Bright semi near Little Italy &amp; the subway.
      </div>
      ${field("Cooling", "Central air conditioning")}
      ${field("Appliances Included", "Dryer, Stove, Washer, Refrigerator")}
      ${field("Total Parking Spaces", "1")}`;
    expect(parseRealtorDetail(html)).toEqual({
      description: "Bright semi near Little Italy & the subway.",
      airConditioning: "central",
      laundryInSuite: true,
      parking: true,
    });
  });

  it("'None' is no AC; missing fields stay unknown", () => {
    expect(parseRealtorDetail(field("Cooling", "None"))).toEqual({
      description: null,
      airConditioning: false,
      laundryInSuite: null,
      parking: null,
    });
  });
});
