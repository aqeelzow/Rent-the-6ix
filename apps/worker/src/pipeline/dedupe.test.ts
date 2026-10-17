import { describe, expect, it } from "vitest";
import {
  alsoOn,
  streetKey,
  distanceM,
  findDuplicates,
  isDuplicate,
  similarity,
  trigrams,
  type DedupeListing,
} from "./dedupe.ts";

const QUEEN_WEST = { lng: -79.4, lat: 43.645 };
// ~0.00045° latitude ≈ 50 m.
const north = (m: number) => ({ ...QUEEN_WEST, lat: QUEEN_WEST.lat + m / 111_195 });

function listing(overrides: Partial<DedupeListing> = {}): DedupeListing {
  return {
    id: "a",
    source: "kijiji",
    location: QUEEN_WEST,
    bedrooms: 1,
    monthlyRentCad: 2400,
    title: "Bright 1 bedroom",
    excerpt: "",
    addressText: null,
    firstSeenAt: "2026-10-01T00:00:00Z",
    ...overrides,
  };
}

const description =
  "Bright and spacious one bedroom on Queen West with a south-facing balcony, ensuite laundry and hardwood floors throughout.";

describe("trigram similarity matches pg_trgm", () => {
  it("pads words like pg_trgm", () => {
    expect([...trigrams("cat")].sort()).toEqual(["  c", " ca", "at ", "cat"]);
    expect(similarity("word", "word")).toBe(1);
    expect(similarity("", "word")).toBe(0);
    // pg_trgm: similarity('word', 'two words') = 0.36363637
    expect(similarity("word", "two words")).toBeCloseTo(0.3636, 4);
  });
});

describe("isDuplicate", () => {
  it("same unit on two sites: within 50 m, same bedrooms, rent within 3%", () => {
    const a = listing();
    expect(
      isDuplicate(
        a,
        listing({ id: "b", source: "zillow", location: north(40), monthlyRentCad: 2460 }),
      ),
    ).toBe(true);
    expect(isDuplicate(a, listing({ id: "b", source: "zillow", location: north(70) }))).toBe(false);
    expect(isDuplicate(a, listing({ id: "b", source: "zillow", monthlyRentCad: 2500 }))).toBe(
      false,
    );
    expect(isDuplicate(a, listing({ id: "b", source: "zillow", bedrooms: 2 }))).toBe(false);
  });

  it("or the same text, even when the location differs", () => {
    const a = listing({ excerpt: description });
    const b = listing({
      id: "b",
      source: "realtor_ca",
      location: north(400),
      monthlyRentCad: 2600,
      excerpt: `${description} Available now!`,
    });
    expect(isDuplicate(a, b)).toBe(true);
  });

  it("never within one source, and never on short generic titles alone", () => {
    expect(isDuplicate(listing(), listing({ id: "b" }))).toBe(false);
    // Same short title, different buildings: only the text rule could match, and it's too short.
    const plan = (id: string, source: DedupeListing["source"], metresNorth: number) =>
      listing({ id, source, title: "1 bed at Example Towers", location: north(metresNorth) });
    expect(isDuplicate(plan("a", "torontorentals", 0), plan("b", "rentals_ca", 800))).toBe(false);
  });

  it("unknown bedrooms never match", () => {
    expect(
      isDuplicate(
        listing({ bedrooms: null }),
        listing({ id: "b", source: "zillow", bedrooms: null }),
      ),
    ).toBe(false);
  });
});

describe("findDuplicates and alsoOn", () => {
  it("the oldest listing is canonical; the rest point to it", () => {
    const listings = [
      listing({ id: "z", source: "zillow", firstSeenAt: "2026-10-05T00:00:00Z" }),
      listing({ id: "k", source: "kijiji", firstSeenAt: "2026-10-01T00:00:00Z" }),
      listing({ id: "r", source: "realtor_ca", firstSeenAt: "2026-10-03T00:00:00Z" }),
      listing({ id: "other", source: "zillow", bedrooms: 2 }),
    ];
    const dupes = findDuplicates(listings);
    expect(Object.fromEntries(dupes)).toEqual({ r: "k", z: "k" });
    expect(alsoOn("k", listings, dupes)).toEqual(["realtor_ca", "zillow"]);
    expect(alsoOn("other", listings, dupes)).toEqual([]);
  });
});

describe("distanceM", () => {
  it("is about 111 km per degree of latitude", () => {
    expect(distanceM(QUEEN_WEST, north(50))).toBeCloseTo(50, 0);
  });
});

describe("street addresses", () => {
  it("reduce every source's spelling to number + street name", () => {
    expect(streetKey("2207 - 181 WYNFORD DRIVE Toronto (Banbury-Don Mills)")).toBe("181 wynford");
    expect(streetKey("- 25 FREDERICK TODD WAY, Toronto (Thorncliffe Park)")).toBe("25 frederick");
    expect(streetKey("25 Frederick Todd Way, Toronto, ON M4G 0C9")).toBe("25 frederick");
    expect(streetKey("11 33rd St #204, Toronto, ON M8W 3H1")).toBe("11 33rd");
    expect(streetKey("1 Bed at The Hampton")).toBeNull();
    expect(streetKey(null)).toBeNull();
  });

  it("two different addresses are never the same unit, even 40 m apart at the same rent", () => {
    const a = listing({ addressText: "195 Redpath Avenue, Toronto" });
    const b = listing({
      id: "b",
      source: "zillow",
      location: north(34),
      addressText: "99 Broadway Ave, Toronto, ON",
    });
    expect(isDuplicate(a, b)).toBe(false);
    expect(
      isDuplicate(a, { ...b, addressText: "- 195 REDPATH AVENUE, Toronto (Mount Pleasant West)" }),
    ).toBe(true);
    expect(isDuplicate(a, { ...b, addressText: null })).toBe(true);
  });
});
