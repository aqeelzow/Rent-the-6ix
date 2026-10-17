import { SearchIntentSchema } from "@rentthe6ix/shared/schemas";
import type { SearchIntent } from "@/lib/store/types";

// Pure edits used by the filters panel (SPEC 11.2). Like the chip edits, each returns a new intent
// and marks what the renter changed in fieldSources.

export type Criteria = SearchIntent["criteria"];
export type CriterionField = keyof Criteria;
type TravelTarget = SearchIntent["travelTargets"][number];
export type AmenityCategory = NonNullable<TravelTarget["category"]>;
export type ResolvedPlace = NonNullable<TravelTarget["resolved"]>;

export const AMENITY_CATEGORIES = [
  "grocery",
  "rapid_transit",
  "school",
  "park",
  "library",
  "pharmacy",
  "clinic",
  "community_centre",
  "university",
] as const satisfies readonly AmenityCategory[];

function editedSources(intent: SearchIntent, key: string): SearchIntent["fieldSources"] {
  const phrase = intent.fieldSources[key]?.phrase;
  return { ...intent.fieldSources, [key]: { source: "user", ...(phrase ? { phrase } : {}) } };
}

/**
 * Sets one criterion's value (undefined removes it). A new criterion starts as a preference;
 * an existing one keeps its must-have state. Unchanged values leave the intent as it is.
 */
export function setCriterion<K extends CriterionField>(
  intent: SearchIntent,
  field: K,
  value: NonNullable<Criteria[K]>["value"] | undefined,
): SearchIntent {
  const key = `criteria.${field}`;
  const current = intent.criteria[field];
  if (value === undefined) {
    if (!current) return intent;
    const criteria = { ...intent.criteria };
    delete criteria[field];
    const fieldSources = { ...intent.fieldSources };
    delete fieldSources[key];
    return { ...intent, criteria, fieldSources };
  }
  if (current && JSON.stringify(current.value) === JSON.stringify(value)) return intent;
  return {
    ...intent,
    criteria: { ...intent.criteria, [field]: { value, hard: current?.hard ?? false } } as Criteria,
    fieldSources: editedSources(intent, key),
  };
}

export function setCriterionHard(
  intent: SearchIntent,
  field: CriterionField,
  hard: boolean,
): SearchIntent {
  const current = intent.criteria[field];
  if (!current || current.hard === hard) return intent;
  return {
    ...intent,
    criteria: { ...intent.criteria, [field]: { ...current, hard } } as Criteria,
    fieldSources: editedSources(intent, `criteria.${field}`),
  };
}

/** A { min, max } range from two optional inputs; undefined when both are empty. */
export function range(min: number | undefined, max: number | undefined) {
  if (min === undefined && max === undefined) return undefined;
  return { ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) };
}

/** Reads a number input: empty or invalid → undefined. */
export function parseNumber(text: string): number | undefined {
  if (!text.trim()) return undefined;
  const value = Number(text);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

let targetCount = 0;
function newTargetId(prefix: string, intent: SearchIntent): string {
  let id: string;
  do id = `${prefix}-${Date.now().toString(36)}-${(targetCount++).toString(36)}`;
  while (intent.travelTargets.some((target) => target.id === id));
  return id;
}

/** Adds a resolved place ("Work: 100 King St W") the renter wants to reach. */
export function addPlaceTarget(
  intent: SearchIntent,
  place: { query: string; label: string; resolved: ResolvedPlace },
): SearchIntent {
  const id = newTargetId("place", intent);
  return {
    ...intent,
    travelTargets: [
      ...intent.travelTargets,
      {
        id,
        kind: "place",
        label: place.label,
        query: place.query,
        resolved: place.resolved,
        mode: "transit",
        hard: false,
      },
    ],
    fieldSources: { ...intent.fieldSources, [`travelTargets.${id}`]: { source: "user" } },
  };
}

/** Adds "the nearest supermarket" (or another amenity), reached on foot by default (SPEC 10.1). */
export function addAmenityTarget(
  intent: SearchIntent,
  category: AmenityCategory,
  label: string,
): SearchIntent {
  const id = newTargetId(category, intent);
  return {
    ...intent,
    travelTargets: [
      ...intent.travelTargets,
      {
        id,
        kind: "amenity",
        label,
        category,
        ...(category === "school" ? { schoolLevel: "any" as const } : {}),
        mode: "walk",
        hard: false,
      },
    ],
    fieldSources: { ...intent.fieldSources, [`travelTargets.${id}`]: { source: "user" } },
  };
}

/** Pins a parsed place to one of the resolver's choices ("which UofT campus?"). */
export function chooseDestination(
  intent: SearchIntent,
  targetId: string,
  choice: { label: string; resolved: ResolvedPlace },
): SearchIntent {
  return {
    ...intent,
    travelTargets: intent.travelTargets.map((target) =>
      target.id === targetId
        ? { ...target, label: choice.label, resolved: choice.resolved }
        : target,
    ),
    fieldSources: editedSources(intent, `travelTargets.${targetId}`),
  };
}

/**
 * Safety is opt-in (SPEC 7.6). A must-have keeps neighbourhoods at most `maxRelativeRate` times the
 * city rate (the slider); without a limit it only changes the ranking. Turning safety off also
 * drops any safety weight.
 */
export function setSafety(
  intent: SearchIntent,
  safety: { enabled: boolean; hard: boolean; maxRelativeRate?: number },
): SearchIntent {
  const hard = safety.enabled && safety.hard;
  const next: SearchIntent = {
    ...intent,
    safety: {
      enabled: safety.enabled,
      hard,
      ...(hard && safety.maxRelativeRate !== undefined
        ? { maxRelativeRate: safety.maxRelativeRate }
        : {}),
    },
    fieldSources: editedSources(intent, "safety"),
  };
  if (!safety.enabled && next.weights?.safety) next.weights = { ...next.weights, safety: 0 };
  return next;
}

/** True when B's search route would accept this intent; the panel won't apply anything else. */
export function isValidIntent(intent: SearchIntent): boolean {
  return SearchIntentSchema.safeParse(intent).success;
}

/** How many criteria, places and opt-ins are set, for the Filters button. */
export function activeFilterCount(intent: SearchIntent): number {
  return (
    Object.keys(intent.criteria).length +
    intent.travelTargets.length +
    intent.areas.length +
    (intent.safety.enabled ? 1 : 0)
  );
}
