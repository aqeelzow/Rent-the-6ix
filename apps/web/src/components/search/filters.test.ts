import { baseIntent } from "@rentthe6ix/shared/fixtures";
import { SearchIntentSchema } from "@rentthe6ix/shared/schemas";
import { describe, expect, it } from "vitest";
import type { SearchIntent } from "@/lib/store/types";
import {
  activeFilterCount,
  addAmenityTarget,
  addPlaceTarget,
  chooseDestination,
  isValidIntent,
  parseNumber,
  range,
  setCriterion,
  setCriterionHard,
  setSafety,
} from "./filters";

const intent: SearchIntent = SearchIntentSchema.parse({
  ...baseIntent,
  criteria: { rent: { value: { max: 2800 }, hard: true } },
  fieldSources: { "criteria.rent": { source: "ai_prompt", phrase: "under $2,800" } },
});
const valid = (next: SearchIntent) => SearchIntentSchema.parse(next);
const unionStation = { lng: -79.3806, lat: 43.6453, source: "known_place" as const };

describe("criteria", () => {
  it("adds a new criterion as a preference, marked as set by the renter", () => {
    const next = valid(setCriterion(intent, "parking", true));
    expect(next.criteria.parking).toEqual({ value: true, hard: false });
    expect(next.fieldSources["criteria.parking"]).toEqual({ source: "user" });
  });

  it("changes a value but keeps must-have state and the original phrase", () => {
    const next = valid(setCriterion(intent, "rent", { max: 3000 }));
    expect(next.criteria.rent).toEqual({ value: { max: 3000 }, hard: true });
    expect(next.fieldSources["criteria.rent"]).toEqual({ source: "user", phrase: "under $2,800" });
  });

  it("leaves an unchanged value alone", () => {
    expect(setCriterion(intent, "rent", { max: 2800 })).toBe(intent);
  });

  it("removes a criterion when its value is cleared", () => {
    const next = valid(setCriterion(intent, "rent", undefined));
    expect(next.criteria.rent).toBeUndefined();
    expect(next.fieldSources["criteria.rent"]).toBeUndefined();
    expect(setCriterion(intent, "parking", undefined)).toBe(intent);
  });

  it("switches must-have state", () => {
    expect(valid(setCriterionHard(intent, "rent", false)).criteria.rent?.hard).toBe(false);
    expect(setCriterionHard(intent, "rent", true)).toBe(intent);
    expect(setCriterionHard(intent, "parking", true)).toBe(intent);
  });
});

describe("inputs", () => {
  it("reads number inputs and builds ranges", () => {
    expect(parseNumber("2800")).toBe(2800);
    expect(parseNumber(" ")).toBeUndefined();
    expect(parseNumber("-1")).toBeUndefined();
    expect(range(undefined, 2800)).toEqual({ max: 2800 });
    expect(range(undefined, undefined)).toBeUndefined();
  });

  it("flags intents the search route would reject", () => {
    expect(isValidIntent(setCriterion(intent, "rent", { min: 3000, max: 2000 }))).toBe(false);
    expect(isValidIntent(setCriterion(intent, "rent", { min: 2000, max: 3000 }))).toBe(true);
  });
});

describe("travel targets", () => {
  it("adds a resolved place reached by transit, as a preference", () => {
    const next = valid(
      addPlaceTarget(intent, { query: "Union", label: "Union Station", resolved: unionStation }),
    );
    expect(next.travelTargets).toHaveLength(1);
    expect(next.travelTargets[0]).toMatchObject({
      kind: "place",
      label: "Union Station",
      mode: "transit",
      hard: false,
    });
  });

  it("adds amenities with unique ids; schools accept any level", () => {
    const one = addAmenityTarget(intent, "school", "School");
    const two = valid(addAmenityTarget(one, "school", "School"));
    expect(new Set(two.travelTargets.map((t) => t.id)).size).toBe(2);
    expect(two.travelTargets[0]).toMatchObject({
      kind: "amenity",
      category: "school",
      schoolLevel: "any",
      mode: "walk",
    });
  });

  it("pins an ambiguous place to the chosen option", () => {
    const parsed = valid({
      ...intent,
      travelTargets: [
        {
          id: "uoft",
          kind: "place",
          label: "University of Toronto",
          query: "University of Toronto",
          mode: "transit",
          hard: false,
        },
      ],
    });
    const next = valid(
      chooseDestination(parsed, "uoft", { label: "UofT St. George", resolved: unionStation }),
    );
    expect(next.travelTargets[0]).toMatchObject({
      label: "UofT St. George",
      resolved: unionStation,
    });
  });
});

describe("safety and counts", () => {
  it("turns safety on and off, never leaving a must-have without opt-in", () => {
    const on = valid(setSafety(intent, { enabled: true, hard: true }));
    expect(on.safety).toEqual({ enabled: true, hard: true });
    expect(valid(setSafety(on, { enabled: false, hard: true })).safety).toEqual({
      enabled: false,
      hard: false,
    });
  });

  it("sets a safety limit only for a must-have", () => {
    expect(
      valid(setSafety(intent, { enabled: true, hard: true, maxRelativeRate: 0.7 })).safety,
    ).toEqual({
      enabled: true,
      hard: true,
      maxRelativeRate: 0.7,
    });
    expect(
      valid(setSafety(intent, { enabled: true, hard: false, maxRelativeRate: 0.7 })).safety,
    ).toEqual({
      enabled: true,
      hard: false,
    });
  });

  it("counts active filters", () => {
    expect(activeFilterCount(intent)).toBe(1);
    expect(
      activeFilterCount(
        setSafety(addAmenityTarget(intent, "park", "Park"), { enabled: true, hard: false }),
      ),
    ).toBe(3);
  });
});
