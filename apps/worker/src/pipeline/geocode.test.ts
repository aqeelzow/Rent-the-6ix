import { describe, expect, it } from "vitest";
import { normalizeAddress as cityForm } from "../civic/lib/address.ts";
import { namesOtherCity, normalizeAddress } from "./geocode.ts";

const norm = (text: string) => normalizeAddress(text)?.norm ?? null;

describe("normalizeAddress", () => {
  it("puts each source's format in Address Points form", () => {
    // Realtor.ca: unit before the address, neighbourhood in brackets.
    expect(norm("3507 - 89 CHURCH STREET, Toronto (Church-Yonge Corridor), Ontario M5C2G3")).toBe(
      "89 CHURCH ST",
    );
    expect(norm("2ND FL - 459 QUEEN STREET W, Toronto (Waterfront Communities)")).toBe(
      "459 QUEEN ST W",
    );
    expect(norm("BSMT - 24 FINTONA AVENUE, Toronto (Guildwood), Ontario M1E1V3")).toBe(
      "24 FINTONA AVE",
    );
    // Kijiji's copy of Realtor.ca rows starts with "- ".
    expect(norm("- 235 GRANDRAVINE DRIVE, Toronto (Glenfield-Jane Heights), ON, M3N1J2")).toBe(
      "235 GRANDRAVINE DR",
    );
    // torontorentals / rentals.ca.
    expect(norm("45 Charles Street East, Toronto, ON M4Y 0B8")).toBe("45 CHARLES ST E");
    expect(norm("85 Queens Wharf Road, Toronto, ON M5V 0J9")).toBe("85 QUEENS WHARF RD");
    // Zillow: unit after a '#'.
    expect(norm("5949 Yonge St #801, Toronto, ON M2M 3V8")).toBe("5949 YONGE ST");
    expect(norm("42 Par Ave #Basement, Toronto, ON M1G 2G4")).toBe("42 PAR AVE");
    // Unit after the address; unit in brackets.
    expect(norm("41 Dalton Rd - BSMT")).toBe("41 DALTON RD");
    expect(norm("90 BILLINGTON (LOWER) CRESCENT, Toronto")).toBe("90 BILLINGTON CRES");
  });

  it("abbreviates only the street-type word and spells numbered streets", () => {
    expect(norm("12 Park Lawn Road, Toronto")).toBe("12 PARK LAWN RD");
    expect(norm("7A 39th Street, Toronto")).toBe("7A THIRTY NINTH ST");
    expect(norm("55 Forty Second Street, Toronto")).toBe("55 FORTY SECOND ST");
    expect(norm("329 The West Mall, Toronto")).toBe("329 THE WEST MALL");
    expect(norm("1 St. Clair Avenue West, Toronto")).toBe("1 ST CLAIR AVE W");
  });

  it("is null without a house number", () => {
    expect(normalizeAddress("Sheppard Ave E, Toronto, M2K 3E5")).toBeNull();
    expect(normalizeAddress("Scarborough, ON M1E 2V9")).toBeNull();
    expect(normalizeAddress(null)).toBeNull();
  });
});

describe("namesOtherCity", () => {
  it("finds listings placed in another city", () => {
    expect(namesOtherCity("Kitchener Finished Basement for rent - $750")).toBe(true);
    expect(namesOtherCity("2 bed apartment in downtown Cambridge")).toBe(true);
    expect(namesOtherCity("Room for rent", "45 Example Dr, Kitchener, ON N2M 1A1")).toBe(true);
    expect(namesOtherCity("Basement in Elmira, all inclusive")).toBe(true);
  });

  it("ignores Waterloo places, the region's joint name and nearby mentions", () => {
    for (const title of [
      "330 Phillip St, Waterloo, ON N2L 3W9",
      "Kitchener-Waterloo 2 bed near UW",
      "Kitchener / Waterloo room for spring term",
      "Waterloo-Kitchener basement suite",
      "Room near Kitchener border, Uptown Waterloo",
      "Unit at Guelph St and Erb",
      "10 min to Kitchener, 1 bed in Lakeshore",
    ]) {
      expect(namesOtherCity(title), title).toBe(false);
    }
  });
});

describe("listing addresses meet Waterloo's address points", () => {
  it("normalises a listing's spelling to the same key as the City's", () => {
    // [as a listing writes it, as the City's Addresses layer writes it]
    for (const [listing, city] of [
      ["330 Phillip Street, Waterloo, ON N2L 3W9", "330 PHILLIP ST"],
      ["Unit 4 - 12 King Street North, Waterloo", "12 KING ST N"],
      ["213 Pastern Trail", "213 PASTERN TRAIL"],
      ["15 Abbey Court", "15 ABBEY CRT"],
      ["8 Brookhaven Circle", "8 BROOKHAVEN CIR"],
      ["40 Lakeshore Gate", "40 LAKESHORE GATE"],
      ["9 Cedarbrook Lane", "9 CEDARBROOK LANE"],
      ["77 Columbia St W #1203", "77 COLUMBIA ST W"],
      ["255 Northfield Dr E", "255 NORTHFIELD DR E"],
    ]) {
      expect(normalizeAddress(listing)?.norm, listing).toBe(cityForm(city));
    }
  });
});
