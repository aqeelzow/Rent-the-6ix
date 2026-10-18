import { baseIntent } from "@rentthe6ix/shared/fixtures";
import { SearchIntentSchema } from "@rentthe6ix/shared/schemas";
import { describe, expect, it } from "vitest";
import type { SearchIntent } from "@/lib/store/types";
import {
  buildChips,
  removeChip,
  setChipHard,
  setTargetMinutes,
  setTargetModes,
  type Chip,
} from "./chips";

// The demo couple's request (SPEC 23 step 1), as the parser would return it.
const intent: SearchIntent = SearchIntentSchema.parse({
  ...baseIntent,
  rawPrompt: "2-bedroom near UofT St. George under $2,800 …",
  criteria: {
    rent: { value: { max: 2800 }, hard: true },
    priceFairness: { value: ["underpriced", "reasonable"], hard: false },
    bedrooms: { value: { min: 2, max: 2 }, hard: true },
    buildingAge: { value: { builtAfter: 2005 }, hard: false },
    airConditioning: { value: "any", hard: false },
    petsAllowed: { value: "cats", hard: true },
    availableBy: { value: "2026-11-01", hard: false },
  },
  travelTargets: [
    {
      id: "uoft",
      kind: "place",
      label: "UofT St. George",
      query: "UofT St. George",
      mode: "transit",
      maxMinutes: 25,
      hard: false,
    },
    {
      id: "grocery",
      kind: "amenity",
      label: "Supermarket",
      category: "grocery",
      mode: "walk",
      hard: false,
    },
  ],
  safety: { enabled: true, hard: false },
  household: { annualIncomeCad: 95000, people: 2 },
  weights: { value: 30, price: 15, travel: 30, home: 25, safety: 15 },
  fieldSources: {
    "criteria.rent": { source: "ai_prompt", phrase: "under $2,800" },
    "criteria.petsAllowed": { source: "ai_prompt", phrase: "cat-friendly" },
    "travelTargets.uoft": { source: "ai_prompt", phrase: "within 25 minutes by transit" },
    safety: { source: "ai_prompt", phrase: "safe area" },
    "household.annualIncomeCad": { source: "ai_prompt", phrase: "I make about $95k" },
  },
});

const chips = buildChips(intent);
const chip = (key: string): Chip => {
  const found = chips.find((c) => c.key === key);
  if (!found) throw new Error(`no chip ${key}`);
  return found;
};
/** Every edit must leave an intent the search route accepts. */
const valid = (next: SearchIntent) => SearchIntentSchema.parse(next);

describe("buildChips", () => {
  it("labels every criterion in plain language", () => {
    expect(chips.map((c) => c.label)).toEqual([
      "Up to $2,800",
      "Underpriced or Reasonably priced",
      "2 bedrooms",
      "Built after 2005",
      "Air conditioning",
      "Cats allowed",
      "Available by Nov 1, 2026",
      "UofT St. George: 25 min by transit",
      "Supermarket: 10 min by walk (default)",
      "Reported crime levels",
      "Income $95,000/year",
      "2 people",
    ]);
  });

  it("carries must-have state and the phrase each chip came from", () => {
    expect(chip("criteria.rent")).toMatchObject({
      hard: true,
      source: "ai_prompt",
      phrase: "under $2,800",
    });
    expect(chip("criteria.airConditioning")).toMatchObject({
      hard: false,
      source: null,
      phrase: null,
    });
    expect(chip("household.annualIncomeCad").hard).toBeNull();
  });

  it("labels ranges, studios and sorts", () => {
    const more = buildChips({
      ...intent,
      criteria: {
        bedrooms: { value: { min: 0, max: 0 }, hard: true },
        bathrooms: { value: { min: 1.5 }, hard: false },
        rent: { value: { min: 1800, max: 2200 }, hard: true },
      },
      sortBy: "lowest_rent",
    }).map((c) => c.label);
    expect(more).toContain("Studio");
    expect(more).toContain("1.5+ baths");
    expect(more).toContain("$1,800–$2,200");
    expect(more).toContain("Sort: lowest rent");
  });
});

describe("chip edits", () => {
  it("flips a criterion to a preference and marks it edited, keeping its phrase", () => {
    const next = valid(setChipHard(intent, chip("criteria.petsAllowed"), false));
    expect(next.criteria.petsAllowed).toEqual({ value: "cats", hard: false });
    expect(next.fieldSources["criteria.petsAllowed"]).toEqual({
      source: "user",
      phrase: "cat-friendly",
    });
  });

  it("flips travel targets and safety", () => {
    expect(
      valid(setChipHard(intent, chip("travelTargets.uoft"), true)).travelTargets[0]?.hard,
    ).toBe(true);
    expect(valid(setChipHard(intent, chip("safety"), true)).safety).toEqual({
      enabled: true,
      hard: true,
    });
  });

  it("removes each kind of chip and its source", () => {
    const noRent = valid(removeChip(intent, chip("criteria.rent")));
    expect(noRent.criteria.rent).toBeUndefined();
    expect(noRent.fieldSources["criteria.rent"]).toBeUndefined();

    expect(
      valid(removeChip(intent, chip("travelTargets.grocery"))).travelTargets.map((t) => t.id),
    ).toEqual(["uoft"]);

    const noIncome = valid(removeChip(intent, chip("household.annualIncomeCad")));
    expect(noIncome.household).toEqual({ people: 2 });
    const noHousehold = valid(
      removeChip(
        noIncome,
        buildChips(noIncome).find((c) => c.key === "household.people")!,
      ),
    );
    expect(noHousehold.household).toBeUndefined();
  });

  it("labels a safety must-have with its limit, defaulting to the city rate", () => {
    const hard = (safety: SearchIntent["safety"]) =>
      buildChips({ ...intent, safety }).find((c) => c.key === "safety")!.label;
    expect(hard({ enabled: true, hard: true })).toBe("Crime at most 1.0× city rate");
    expect(hard({ enabled: true, hard: true, maxRelativeRate: 0.8 })).toBe(
      "Crime at most 0.8× city rate",
    );
    expect(hard({ enabled: true, hard: false })).toBe("Reported crime levels");
  });

  it("keeps a safety limit while must-have, and drops it as a preference", () => {
    const limited = valid({
      ...intent,
      safety: { enabled: true, hard: true, maxRelativeRate: 0.8 },
    });
    const chipOf = buildChips(limited).find((c) => c.key === "safety")!;
    expect(valid(setChipHard(limited, chipOf, true)).safety).toEqual({
      enabled: true,
      hard: true,
      maxRelativeRate: 0.8,
    });
    expect(valid(setChipHard(limited, chipOf, false)).safety).toEqual({
      enabled: true,
      hard: false,
    });
  });

  it("turning safety off also drops its weight", () => {
    const next = valid(removeChip(intent, chip("safety")));
    expect(next.safety).toEqual({ enabled: false, hard: false });
    expect(next.weights?.safety).toBe(0);
  });

  it("removing a travel target drops a percentile that depended on it", () => {
    const withExtreme = valid({
      ...intent,
      numericExtreme: {
        field: "travel",
        direction: "min",
        percentage: 10,
        minimumCount: 10,
        targetId: "uoft",
      },
    });
    const next = valid(removeChip(withExtreme, chip("travelTargets.uoft")));
    expect(next.numericExtreme).toBeUndefined();
  });

  it("changes travel modes, keeping the primary mode when it stays chosen", () => {
    const bike = valid(setTargetModes(intent, "grocery", ["bike"]));
    expect(bike.travelTargets[1]).toMatchObject({ mode: "bike" });
    expect(bike.travelTargets[1]?.alternativeModes).toBeUndefined();
    expect(buildChips(bike).find((c) => c.key === "travelTargets.grocery")?.label).toBe(
      "Supermarket: 10 min by bike (default)",
    );

    const either = valid(setTargetModes(intent, "grocery", ["bike", "walk"]));
    expect(either.travelTargets[1]).toMatchObject({ mode: "walk", alternativeModes: ["bike"] });
    expect(setTargetModes(intent, "grocery", [])).toBe(intent);
  });

  it("sets or clears a travel time limit", () => {
    const fifteen = valid(setTargetMinutes(intent, "grocery", 15));
    expect(fifteen.travelTargets[1]?.maxMinutes).toBe(15);
    expect(
      valid(setTargetMinutes(fifteen, "grocery", null)).travelTargets[1]?.maxMinutes,
    ).toBeUndefined();
    expect(fifteen.fieldSources["travelTargets.grocery"]?.source).toBe("user");
  });
});
