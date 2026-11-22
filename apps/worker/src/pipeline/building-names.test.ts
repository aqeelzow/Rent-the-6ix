import { describe, expect, it } from "vitest";
import { addressesIn, buildingNamed, type CatalogueBuilding } from "./building-names.ts";

const ICON = { lng: -80.53867, lat: 43.4762 };
const LUXE_1 = { lng: -80.52606, lat: 43.47967 };
const LUXE_2 = { lng: -80.52615, lat: 43.48025 };
const ELORA = { lng: -80.53672, lat: 43.47318 };
const catalogue: CatalogueBuilding[] = [
  {
    id: "icon",
    aliases: ["icon 330", "icon waterloo"],
    strictAliases: ["ICON"],
    points: [ICON],
    addresses: [{ number: "330", street: "phillip", direction: null }],
  },
  {
    id: "ivytowns",
    aliases: ["ivytowns", "ivy towns"],
    strictAliases: [],
    points: [{ lng: -80.53325, lat: 43.4754 }],
    addresses: [{ number: "253", street: "albert", direction: null }],
  },
  {
    id: "luxe-1",
    aliases: ["luxe 1", "luxe i", "luxe tower 1"],
    strictAliases: [],
    points: [LUXE_1],
    addresses: [{ number: "333", street: "king", direction: "n" }],
  },
  {
    id: "luxe-2",
    aliases: ["luxe 2", "luxe ii", "luxe tower 2"],
    strictAliases: [],
    points: [LUXE_2],
    addresses: [{ number: "339", street: "king", direction: "n" }],
  },
  {
    id: "elora-house",
    aliases: ["elora house", "rez-one elora"],
    strictAliases: [],
    points: [ELORA],
    addresses: [{ number: "250", street: "phillip", direction: null }],
  },
];
// The postal-code point a name-only post usually carries: a few hundred metres off.
const nearby = { lng: -80.537, lat: 43.475 };
const match = (text: string, at = nearby) => buildingNamed(text, at, catalogue)?.buildingId ?? null;

describe("buildingNamed", () => {
  it("finds names in real student posts", () => {
    expect(match("Furnished Room Sublet at ICON 330 near UW | Jan - Apr 2027")).toBe("icon");
    expect(match("Icon 330 room winter sublet")).toBe("icon");
    expect(match("Rez-One Elora Ensuite Sublet Jan 2027 | 4 or 8 mo | UW/WLU")).toBe("elora-house");
    expect(match("Rez One Elora room")).toBe("elora-house");
    expect(match("SUMMER SUBLET (LUXE TOWER 2)", { lng: -80.525, lat: 43.478 })).toBe("luxe-2");
  });

  it("matches short common words only in the catalogue's exact case", () => {
    expect(match("Room in ICON, all utilities")).toBe("icon");
    expect(match("An icon of student living")).toBeNull();
  });

  it("skips homes described as near a building", () => {
    expect(match("Basement room near ICON 330")).toBeNull();
    expect(match("House 5 min walk to ICON")).toBeNull();
    expect(match("Townhouse across from ICON 330")).toBeNull();
  });

  it("needs whole words and one building", () => {
    expect(match("Luxe 1 or Luxe 2, both available")).toBeNull();
    expect(match("Deluxe 1 bedroom")).toBeNull();
    expect(match("ICONIC views")).toBeNull();
  });

  it("lets a written address confirm or rule out a building", () => {
    expect(
      match("Icon room winter sublet\nden room at Icon South Tower. Address: 330 Phillip Street"),
    ).toBe("icon");
    expect(match("3-bed stacked condo at Ivy Towns 3, 338 ALBERT Street Unit 205")).toBeNull();
    expect(match("Ivy Towns townhouse, 253 Albert St")).toBe("ivytowns");
    expect(match("House 2 min from 330 Phillip St")).toBeNull();
    const nearLuxe = { lng: -80.525, lat: 43.479 };
    expect(match("Room at 333 King Street North", nearLuxe)).toBe("luxe-1");
    expect(match("Room at 333 King St S", nearLuxe)).toBeNull();
  });

  it("reads street addresses out of text", () => {
    expect(
      addressesIn("Address: 330 Phillip Street, Waterloo").map((a) => [a.number, a.street]),
    ).toEqual([["330", "phillip"]]);
    expect(addressesIn("The Staves, 17 Barrel Yards Blvd #E").map((a) => a.street)).toEqual([
      "barrel yards",
    ]);
    expect(addressesIn("Unit# 205 Waterloo, Ontario")).toEqual([]);
  });

  it("ignores a building far from the listing's own point", () => {
    expect(match("Room in ICON 330", { lng: -80.49, lat: 43.45 })).toBeNull();
  });
});
