import { describe, expect, it } from "vitest";
import {
  asksForMoneyBeforeViewing,
  caveats,
  type CaveatContext,
  type CaveatListing,
} from "./caveats";

const NOW = new Date("2026-10-16T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

const listing: CaveatListing = {
  title: "Bright 1 bedroom",
  monthlyRentCad: 2250,
  excerpt: "Steps to the subway.",
  locationPrecision: "exact",
  lastSeenAt: daysAgo(1),
  utilitiesIncluded: "yes",
  petsAllowed: "no",
  laundryInSuite: "yes",
  parking: "no",
  airConditioning: "central",
};

const ctx: CaveatContext = {
  valuation: { status: "ok", differencePct: 2 },
  building: null,
  sameTextElsewhere: 0,
  now: NOW,
};

const codes = (l: Partial<CaveatListing> = {}, c: Partial<CaveatContext> = {}) =>
  caveats({ ...listing, ...l }, { ...ctx, ...c }).map((x) => x.code);

describe("caveats", () => {
  it("none for a complete, fresh, fairly priced listing", () => {
    expect(codes()).toEqual([]);
  });

  it("rent_far_below only past 30%, framed as a check, not an accusation", () => {
    expect(codes({}, { valuation: { status: "ok", differencePct: 30 } })).toEqual([]);
    const [c] = caveats(listing, { ...ctx, valuation: { status: "ok", differencePct: 34.6 } });
    expect(c).toMatchObject({ code: "rent_far_below", severity: "warning" });
    expect(c.explanation).toBe(
      "Listed 35% below similar listings nearby. Verify the listing is real before sending money.",
    );
    expect(c.explanation).not.toMatch(/scam|fake|fraud/i);
  });

  it("insufficient_comparables when the valuation couldn't be made", () => {
    expect(codes({}, { valuation: { status: "insufficient_data" } })).toEqual([
      "insufficient_comparables",
    ]);
    expect(codes({}, { valuation: null })).toEqual([]);
  });

  it("approx_location for street- and area-level locations", () => {
    expect(codes({ locationPrecision: "street" })).toEqual(["approx_location"]);
    expect(codes({ locationPrecision: "area" })).toEqual(["approx_location"]);
  });

  it("stale from day 8", () => {
    expect(codes({ lastSeenAt: daysAgo(7) })).toEqual([]);
    const [c] = caveats({ ...listing, lastSeenAt: daysAgo(12) }, ctx);
    expect(c).toMatchObject({
      code: "stale",
      explanation: "We last saw this listing 12 days ago.",
    });
  });

  it("fields_unknown from two unknown key fields, naming them", () => {
    expect(codes({ parking: "unknown" })).toEqual([]);
    const [c] = caveats(
      { ...listing, utilitiesIncluded: "unknown", airConditioning: "unknown" },
      ctx,
    );
    expect(c.explanation).toBe(
      "The listing doesn't say: utilities, air conditioning. Ask before you apply.",
    );
  });

  it("rentsafeto_low below 66%, with the date", () => {
    expect(codes({}, { building: { latestScore: 66, scoreDate: "2025-03-01" } })).toEqual([]);
    const [c] = caveats(listing, {
      ...ctx,
      building: { latestScore: 58, scoreDate: "2025-03-01" },
    });
    expect(c.explanation).toBe(
      "The building scored 58% in its latest City of Toronto RentSafeTO evaluation (2025-03-01). Buildings under 66% are evaluated every year.",
    );
    expect(codes({}, { building: { latestScore: null, scoreDate: null } })).toEqual([]);
  });

  it("duplicate_text_elsewhere from the SQL count", () => {
    const [c] = caveats(listing, { ...ctx, sameTextElsewhere: 2 });
    expect(c).toMatchObject({ code: "duplicate_text_elsewhere", severity: "warning" });
    expect(c.explanation).toContain("2 other listings");
  });

  it("price_dropped when the rent is $25+ below the first one seen", () => {
    expect(codes({}, { firstSeen: { rentCad: 2270, at: "2026-10-01T00:00:00Z" } })).toEqual([]);
    expect(codes({}, { firstSeen: null })).toEqual([]);
    const [c] = caveats(listing, {
      ...ctx,
      firstSeen: { rentCad: 2400, at: "2026-10-01T05:00:00Z" },
    });
    expect(c).toMatchObject({ code: "price_dropped", severity: "info" });
    expect(c.explanation).toBe(
      "The asking rent dropped from $2,400 to $2,250 since 2026-10-01. A listing that's been reduced may be open to negotiation.",
    );
  });

  it("deposit_before_viewing from the flag stored at ingest, even when the excerpt is clean", () => {
    expect(codes({ depositBeforeViewing: true })).toEqual(["deposit_before_viewing"]);
    expect(codes({ depositBeforeViewing: false })).toEqual([]);
  });

  it("orders most severe first", () => {
    expect(
      codes(
        { excerpt: "E-transfer the deposit before viewing.", locationPrecision: "area" },
        { valuation: { status: "ok", differencePct: 40 } },
      ),
    ).toEqual(["deposit_before_viewing", "rent_far_below", "approx_location"]);
  });
});

describe("newer_building", () => {
  const ok = { status: "ok" as const, differencePct: -12 };
  const codes = (yearBuilt: number | null, sameEraShare: number | null) =>
    caveats({ ...listing, yearBuilt }, { ...ctx, valuation: ok, sameEraShare }).map((c) => c.code);

  it("explains a new tower compared mostly with older or undated buildings", () => {
    const [c] = caveats(
      { ...listing, yearBuilt: 2022 },
      { ...ctx, valuation: ok, sameEraShare: 0.1 },
    ).filter((c) => c.code === "newer_building");
    expect(c.explanation).toContain("Built in 2022.");
    expect(codes(2022, 0.5)).not.toContain("newer_building");
    expect(codes(1975, 0)).not.toContain("newer_building");
    expect(codes(null, 0)).not.toContain("newer_building");
    expect(codes(2022, null)).not.toContain("newer_building");
  });
});

describe("asksForMoneyBeforeViewing", () => {
  it("flags money before a viewing, in either order", () => {
    for (const text of [
      "Please send a deposit before viewing.",
      "E-transfer $500 to book a viewing.",
      "First and last required prior to the showing",
      "To schedule a visit, an Interac payment of $200 is needed",
      "I'm out of the country; wire the deposit and I'll mail the keys",
      "Deposit required to hold the unit before you see it",
    ])
      expect(asksForMoneyBeforeViewing(text), text).toBe(true);
  });

  it("leaves normal listings alone", () => {
    for (const text of [
      "A brief pre-screening is required before any in-person viewing is arranged.",
      "First and last month's rent required. Viewings by appointment.",
      "Deposit due at lease signing.",
      "Book a viewing today!",
      "Payment by e-transfer accepted after the lease is signed.",
    ])
      expect(asksForMoneyBeforeViewing(text), text).toBe(false);
  });
});
