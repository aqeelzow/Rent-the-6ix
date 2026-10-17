import { detailFixture, listings, searchFixture, travelIntent } from "@rentthe6ix/shared/fixtures";
import { describe, expect, it } from "vitest";
import type { SearchResultItem } from "@/lib/store/types";
import { homeFields, scoreBreakdown, travelTable } from "./detail-data";

const results = searchFixture.status === "completed" ? searchFixture.results : [];

describe("homeFields", () => {
  it("keeps unknowns as null instead of saying no", () => {
    // Fixture listing 0 leaves most fields unknown.
    const fields = homeFields(listings[0]!);
    const byKey = Object.fromEntries(fields.map((f) => [f.key, f.value]));
    expect(byKey.bedrooms).toBeNull();
    expect(byKey.airConditioning).toBeNull();
    expect(byKey.parking).toBeNull();
    expect(byKey.locationPrecision).not.toBeNull();
  });

  it("formats known values in plain words", () => {
    const listing = {
      ...listings[1]!,
      bedrooms: 0,
      sqft: 820,
      yearBuilt: 2012,
      yearBuiltSource: "rentsafeto" as const,
      airConditioning: "central" as const,
      petsAllowed: "cats_only" as const,
      utilitiesIncluded: "partial" as const,
      leaseTerm: "12_months",
      fieldEvidence: { airConditioning: "ai_extracted" as const },
    };
    const byKey = Object.fromEntries(homeFields(listing).map((f) => [f.key, f]));
    expect(byKey.bedrooms!.value).toBe("Studio");
    expect(byKey.sqft!.value).toBe("820 sq ft");
    expect(byKey.yearBuilt!.value).toBe("2012 (from RentSafeTO)");
    expect(byKey.airConditioning!.value).toBe("Central air");
    expect(byKey.airConditioning!.aiRead).toBe(true);
    expect(byKey.petsAllowed!.value).toBe("Cats only");
    expect(byKey.utilitiesIncluded!.value).toBe("Some included");
    expect(byKey.leaseTerm!.value).toBe("12 months");
  });
});

describe("travelTable", () => {
  const row = (
    over: Partial<SearchResultItem["travel"][number]>,
  ): SearchResultItem["travel"][number] => ({
    listingId: listings[1]!.id,
    targetId: "campus",
    mode: "bike",
    distanceM: 900,
    poiId: null,
    computedAt: "2026-10-16T12:00:00Z",
    method: "straight_line",
    minutes: null,
    ...over,
  });

  it("lists all four modes per target, with the renter's modes marked", () => {
    const [campus] = travelTable(travelIntent.travelTargets, [
      row({ mode: "transit", method: "otp", minutes: 14.4 }),
      row({ mode: "bike" }),
    ]);
    expect(campus!.chosen).toEqual(["bike", "walk"]);
    expect(campus!.modes).toEqual([
      { mode: "transit", kind: "estimated", minutes: 13 },
      { mode: "drive", kind: "estimated", minutes: 6 },
      { mode: "walk", kind: "estimated", minutes: 15 },
      { mode: "bike", kind: "estimated", minutes: 6 },
    ]);
  });

  it("estimates all modes from a straight-line distance", () => {
    const [campus] = travelTable(travelIntent.travelTargets, [row({ mode: "walk" })]);
    const walk = campus!.modes.find((m) => m.mode === "walk")!;
    expect(walk.kind).toBe("estimated");
    expect(walk).toHaveProperty("minutes", 15);
  });
});

describe("scoreBreakdown", () => {
  it("counts only parts with a score, and their points add up to the total", () => {
    for (const result of [...results, detailFixture]) {
      const { total, parts, omitted } = scoreBreakdown(result.matchScore);
      expect(Math.round(parts.reduce((n, p) => n + p.points, 0))).toBe(total);
      expect(parts.length + omitted.length).toBe(5);
      for (const id of omitted) {
        expect(
          result.matchScore.parts.find((p) => p.id === id)!.score === null ||
            result.matchScore.parts.find((p) => p.id === id)!.effectiveWeight === 0,
        ).toBe(true);
      }
    }
  });
});
