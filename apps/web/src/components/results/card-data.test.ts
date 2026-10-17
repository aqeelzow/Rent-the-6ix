import { searchFixture, travelIntent, valuations } from "@rentthe6ix/shared/fixtures";
import { WALKABLE_M, travelAdvice } from "@rentthe6ix/shared/engine/travel";
import { describe, expect, it } from "vitest";
import { t, type MessageKey } from "@/lib/format/messages";
import type { SearchResultItem } from "@/lib/store/types";
import {
  acFact,
  daysSince,
  plainHardFilterNote,
  priceSummary,
  scoreSegments,
  topCaveat,
  travelSummaries,
  yearSpan,
} from "./card-data";

// The label the card writes for a distance: under 1.5 km the renter can walk it, beyond that they
// need transport. These are the exact strings result-card and the detail chart render.
describe("distance advice", () => {
  // The card's own helper reads `results.travel.*`, so the expectation goes through that namespace.
  const label = (metres: number) =>
    t(`results.travel.${travelAdvice(metres)}` as MessageKey, {
      km: (metres / 1000).toFixed(1),
      target: "UTSG",
    });
  it("walks anything under 1.5 km and recommends transport at or above it", () => {
    expect(WALKABLE_M).toBe(1500);
    expect(travelAdvice(1499)).toBe("walkable");
    expect(travelAdvice(1500)).toBe("transport");
    expect(label(1100)).toBe("1.1 km to UTSG — walking distance");
    expect(label(2700)).toBe("2.7 km to UTSG — take transit or a car");
  });
});

const results = searchFixture.status === "completed" ? searchFixture.results : [];
const result = results[1]!;
const campus = travelIntent.travelTargets;
const row = (
  over: Partial<SearchResultItem["travel"][number]>,
): SearchResultItem["travel"][number] => ({
  listingId: result.listing.id,
  targetId: "campus",
  mode: "bike",
  distanceM: 600,
  poiId: null,
  computedAt: "2026-10-16T12:00:00Z",
  method: "straight_line",
  minutes: null,
  ...over,
});

describe("travelSummaries", () => {
  it("prefers the fastest routed time across the target's modes", () => {
    const withRows = {
      ...result,
      travel: [
        row({ mode: "bike", method: "otp", minutes: 9 }),
        row({ mode: "walk", method: "otp", minutes: 7.4 }),
        row({ mode: "walk", method: "straight_line", minutes: null }),
      ],
    };
    expect(travelSummaries(withRows, campus)).toEqual([
      { kind: "routed", target: campus[0]!.label, mode: "walk", minutes: 7 },
    ]);
  });

  it("falls back to straight-line distance, never minutes", () => {
    const summary = travelSummaries({ ...result, travel: [row({ distanceM: 1100 })] }, campus)[0];
    expect(summary).toEqual({
      kind: "straight_line",
      target: campus[0]!.label,
      mode: "bike",
      distanceM: 1100,
    });
    expect(summary).not.toHaveProperty("minutes");
  });

  it("says when there's no travel data, and ignores rows for other modes", () => {
    const summary = travelSummaries(
      { ...result, travel: [row({ mode: "drive", method: "otp", minutes: 4 })] },
      campus,
    );
    expect(summary).toEqual([{ kind: "missing", target: campus[0]!.label, mode: "bike" }]);
  });

  it("shows at most the first two targets", () => {
    const three = [0, 1, 2].map((i) => ({ ...campus[0]!, id: `t${i}`, label: `Target ${i}` }));
    expect(travelSummaries(result, three).map((s) => s.target)).toEqual(["Target 0", "Target 1"]);
  });
});

describe("priceSummary", () => {
  it("gives the label with a whole percent and direction", () => {
    expect(priceSummary(valuations[0]!)).toMatchObject({
      label: "underpriced",
      percent: 15,
      direction: "below",
    });
    expect(priceSummary(valuations[1]!)).toMatchObject({
      label: "reasonable",
      percent: 0,
      direction: "in_line",
    });
    expect(priceSummary(valuations[2]!)).toMatchObject({
      label: "overpriced",
      percent: 15,
      direction: "above",
    });
  });

  it("never labels thin data", () => {
    expect(priceSummary(valuations[3]!)).toEqual({ label: "unknown", comparableCount: 0 });
  });
});

describe("scoreSegments", () => {
  it("adds up to the total and leaves out parts without a score", () => {
    for (const r of results) {
      const segments = scoreSegments(r.matchScore);
      const sum = segments.reduce((n, s) => n + s.points, 0);
      expect(Math.round(sum)).toBe(r.matchScore.total);
      const nullParts = r.matchScore.parts.filter((p) => p.score === null).map((p) => p.id);
      expect(segments.some((s) => nullParts.includes(s.id))).toBe(false);
    }
  });
});

describe("small helpers", () => {
  it("picks the most severe caveat", () => {
    const info = {
      severity: "info" as const,
      code: "stale",
      title: "Not seen recently",
      explanation: "x",
    };
    const high = {
      severity: "high" as const,
      code: "deposit_before_viewing",
      title: "Deposit before viewing",
      explanation: "x",
    };
    expect(topCaveat([info, high])).toBe(high);
    expect(topCaveat([])).toBeNull();
  });

  it("turns field codes into plain must-have notes", () => {
    expect(plainHardFilterNote("airConditioning: not confirmed")).toBe(
      "Air conditioning not confirmed",
    );
    expect(plainHardFilterNote("unitTypes: not confirmed")).toBe("Type of place not confirmed");
    expect(plainHardFilterNote("petsAllowed: not confirmed")).toBe("Pets not confirmed");
    expect(plainHardFilterNote("Travel to UofT St. George: not confirmed")).toBe(
      "Travel to UofT St. George not confirmed",
    );
    expect(plainHardFilterNote("Utilities not stated")).toBe("Utilities not stated");
  });

  it("shows unstated AC only when the renter asked for it", () => {
    expect(acFact("unknown", true)).toBe("not_stated");
    expect(acFact("unknown", false)).toBeNull();
    expect(acFact("no", true)).toBeNull();
    expect(acFact("central", false)).toBe("central");
    expect(acFact("yes", true)).toBe("yes");
  });

  it("formats year spans and days since", () => {
    expect(yearSpan([2025, 2023, 2024])).toBe("2023–2025");
    expect(yearSpan([2024])).toBe("2024");
    const now = Date.parse("2026-10-17T12:00:00Z");
    expect(daysSince("2026-10-15T08:00:00Z", now)).toBe(2);
    expect(daysSince("2026-10-18T08:00:00Z", now)).toBe(0);
  });
});
