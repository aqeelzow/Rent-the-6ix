import { baseIntent, sampleListings, valuations } from "@rentthe6ix/shared/fixtures";
import { scoreListing } from "@rentthe6ix/shared/engine/score";
import { engineConfig } from "@rentthe6ix/shared/engine/config";
import { SearchIntentSchema } from "@rentthe6ix/shared/schemas";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ScoreBreakdown } from "./score-breakdown";

const listing = { ...sampleListings[1]!, monthlyRentCad: 2150, furnished: "yes" as const };
const context = { valuation: { ...valuations[0]!, differencePct: 15 }, travel: [], safety: null };

describe("ScoreBreakdown", () => {
  it("explains the engine's normalized contributions and preserves listing evidence", () => {
    const intent = SearchIntentSchema.parse({
      ...baseIntent,
      criteria: { rent: { value: { max: 2000 }, hard: false } },
    });
    const matchScore = scoreListing(listing, intent, context);
    const html = renderToStaticMarkup(<ScoreBreakdown matchScore={matchScore} />);

    expect(matchScore.total).toBe(75);
    expect(html).toContain("87.5/100 × 66.7% = 58.3 points. Weight: 30 out of 45.");
    expect(html).toContain("50/100 × 33.3% = 16.7 points. Weight: 15 out of 45.");
    expect(html).toContain("15% below estimate");
    expect(html).toContain("Rent CAD/month 2150; preferred range unbounded–2000");
    expect(html).toContain("groceries, parks and schools");
    expect(html).not.toMatch(/\{\w+\}|NaN|Infinity/);
  });

  it("distinguishes a zero score from missing data and a zero weight", () => {
    const intent = SearchIntentSchema.parse({
      ...baseIntent,
      criteria: {
        rent: { value: { max: 1000 }, hard: false },
        furnished: { value: true, hard: false },
      },
      weights: { ...engineConfig.weights, value: 0 },
    });
    const matchScore = scoreListing(listing, intent, context);
    const html = renderToStaticMarkup(<ScoreBreakdown matchScore={matchScore} />);

    expect(html).toContain("0/100 × 37.5% = 0 points. Weight: 15 out of 40.");
    expect(html).toContain("Not counted: this part’s weight is zero.");
    expect(html).toContain("Not scored: no applicable preference or not enough data.");
    expect(html).toContain("furnished: listing");
    expect(html).not.toMatch(/\{\w+\}|NaN|Infinity/);
  });

  it("explains an empty score without inventing contributions or dividing by zero", () => {
    const matchScore = scoreListing(listing, baseIntent, {
      ...context,
      valuation: { ...context.valuation, status: "insufficient_data" },
    });
    const html = renderToStaticMarkup(<ScoreBreakdown matchScore={matchScore} />);

    expect(matchScore.total).toBe(0);
    expect(html).not.toContain("/100 ×");
    expect(html).not.toMatch(/NaN|Infinity/);
  });
});
