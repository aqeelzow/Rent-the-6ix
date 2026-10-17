import { describe, expect, it } from "vitest";
import { kijijiPageUrl, parseKijiji, wholeUnitTitle } from "./kijiji.ts";

// Same shape as Kijiji's __NEXT_DATA__ (checked 2026-10-16); values are made up.
function page(listings: object[], extraHtml = "") {
  const state = Object.fromEntries(listings.map((l, i) => [`RealEstateListing:${i}`, l]));
  const data = { props: { pageProps: { __APOLLO_STATE__: { ROOT_QUERY: {}, ...state } } } };
  return `<html>${extraHtml}<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></html>`;
}

const attrs = (pairs: Record<string, string>) => ({
  all: Object.entries(pairs).map(([canonicalName, v]) => ({ canonicalName, canonicalValues: [v] })),
});

const listing = {
  __typename: "RealEstateListing",
  id: "100",
  title: "Bright 1+den near Queen West",
  description: "Steps to the streetcar...",
  url: "https://www.kijiji.ca/v-apartments-condos/city-of-toronto/bright/100",
  activationDate: "2026-10-01T12:00:00.000Z",
  location: {
    address: "1 Example St, Toronto, ON M5V 1A1",
    coordinates: { latitude: 43.64, longitude: -79.4 },
  },
  price: { __typename: "StandardAmountPrice", amount: 245000 },
  attributes: attrs({
    numberbedrooms: "1.5",
    numberbathrooms: "15",
    unittype: "condo",
    areainfeet: "0",
    airconditioning: "1",
    furnished: "0",
    petsallowed: "limited",
    numberparkingspots: "Not Available",
    laundryinunit: "1",
    heat: "1",
    water: "1",
    hydro: "0",
    dateavailable: "2026-11-01T00:00:00Z",
  }),
};

describe("parseKijiji", () => {
  it("reads rent from cents, 1+den, tenths of bathrooms and tri-state amenities", () => {
    const [row] = parseKijiji(page([listing])).listings;
    expect(row).toMatchObject({
      source: "kijiji",
      sourceListingId: "100",
      monthlyRentCad: 2450,
      bedrooms: 1,
      den: true,
      bathrooms: 1.5,
      unitType: "condo",
      sqft: null,
      airConditioning: true,
      furnished: false,
      petsAllowed: true,
      parking: null,
      laundryInSuite: true,
      utilitiesIncluded: false,
      availableFrom: "2026-11-01",
      postalCode: "M5V 1A1",
      lat: 43.64,
      lng: -79.4,
    });
  });

  it("skips listings without a price", () => {
    const noPrice = { ...listing, id: "101", price: { __typename: "NonAmountPrice" } };
    expect(parseKijiji(page([noPrice])).listings).toEqual([]);
  });

  it("finds the last page from the pagination links", () => {
    const links = `<a href="/b-apartments-condos/city-of-toronto/page-2/c37l1700273"></a><a href="/b-apartments-condos/city-of-toronto/page-174/c37l1700273"></a>`;
    expect(parseKijiji(page([listing], links)).lastPage).toBe(174);
    expect(kijijiPageUrl(3)).toBe(
      "https://www.kijiji.ca/b-apartments-condos/city-of-toronto/page-3/c37l1700273",
    );
  });

  it("reads Room Rentals entries (StandardListing, no attributes) as rooms", () => {
    const room = {
      __typename: "StandardListing",
      id: "200",
      title: "Furnished room near York U",
      url: "https://www.kijiji.ca/v-room-rental-roommate/city-of-toronto/x/200",
      price: { __typename: "StandardAmountPrice", amount: 95000 },
      location: { address: "Toronto, ON", coordinates: { latitude: 43.77, longitude: -79.5 } },
    };
    const html = page(
      [room],
      `<a href="/b-room-rental-roommate/city-of-toronto/page-52/c36l1700273"></a>`,
    );
    const { listings, lastPage } = parseKijiji(html, "rooms");
    expect(listings[0]).toMatchObject({
      unitType: "room",
      rentIsPerRoom: true,
      monthlyRentCad: 950,
    });
    expect(lastPage).toBe(52);
    const basement = { ...room, id: "201", title: "Triple Mint High Park Basement for Rent $1850" };
    const [whole] = parseKijiji(page([basement]), "rooms").listings;
    expect(whole).toMatchObject({ unitType: null, rentIsPerRoom: false });
    expect(wholeUnitTitle("3 Bed 1 Bath Entire Private Unit for Rent", 2700)).toBe(true);
    expect(wholeUnitTitle("Fully Furnished Scarborough townhome available", 3000)).toBe(true);
    expect(wholeUnitTitle("GUARANTEED Peaceful Home with Centennial College", 760)).toBe(false);
    expect(wholeUnitTitle("Rooms available in a quiet house near York", 800)).toBe(false);
    expect(wholeUnitTitle("Shared basement accommodation", 700)).toBe(false);
    expect(wholeUnitTitle("1 bedroom in a beautiful penthouse", 1350)).toBe(false);
    expect(wholeUnitTitle("MasterBedroom in a Townhouse", 2500)).toBe(false);
    expect(wholeUnitTitle("One bedroom basement unit for rent", 1300)).toBe(true);
    expect(kijijiPageUrl(3, "rooms")).toBe(
      "https://www.kijiji.ca/b-room-rental-roommate/city-of-toronto/page-3/c36l1700273",
    );
  });

  it("fails loudly when the page layout changes", () => {
    expect(() => parseKijiji("<html></html>")).toThrow(/__NEXT_DATA__/);
  });
});
