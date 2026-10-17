import { describe, expect, it } from "vitest";
import { emptyRawListing, type RawListing } from "../sources/types.ts";
import { applyPatch, needsDetail, scrubPatch } from "./details.ts";

const raw: RawListing = {
  ...emptyRawListing,
  source: "kijiji",
  sourceListingId: "1",
  sourceUrl: "https://www.kijiji.ca/v-x/1",
  title: "1 bed",
  description: "Renovated one bedroom near…",
  monthlyRentCad: 2200,
  airConditioning: false,
  bedrooms: 1,
};

describe("details", () => {
  it("fetches new listings and listings whose rent changed", () => {
    const cache = { "1": { rent: 2200, fetchedAt: "2026-10-16T00:00:00Z", patch: {} } };
    expect(needsDetail(raw, {})).toBe(true);
    expect(needsDetail(raw, cache)).toBe(false);
    expect(needsDetail({ ...raw, monthlyRentCad: 2100 }, cache)).toBe(true);
  });

  it("page values win, nulls don't erase, the longer description is kept", () => {
    const out = applyPatch(raw, {
      description:
        "Renovated one bedroom near Church and Wellesley. Central air, in-suite laundry.",
      airConditioning: "central",
      laundryInSuite: true,
      bedrooms: null,
    });
    expect(out).toMatchObject({
      airConditioning: "central",
      laundryInSuite: true,
      bedrooms: 1,
      sourceListingId: "1",
    });
    expect(out.description).toMatch(/Church and Wellesley/);
    expect(applyPatch(raw, { description: "Short" }).description).toBe(raw.description);
  });

  it("scrubs the description before it's cached", () => {
    const patch = scrubPatch({ description: "Call Maria at 416-555-0199", parking: true });
    expect(patch).toEqual({ description: "Call [name removed] at [phone removed]", parking: true });
  });
});
