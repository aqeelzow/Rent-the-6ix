import { SAFETY } from "@rentthe6ix/shared/engine/config";
import { defaultMinutes, targetModes } from "@rentthe6ix/shared/engine/travel";
import { formatDate } from "@/lib/format/date";
import { t, type MessageKey } from "@/lib/format/messages";
import { formatCad, formatCount } from "@/lib/format/number";
import type { SearchIntent } from "@/lib/store/types";

// Turns a SearchIntent into editable chips and applies chip edits (SPEC 6 step 2, 11.2).
// Pure: every edit returns a new intent that still passes B's SearchIntentSchema.

type Criteria = SearchIntent["criteria"];
type CriterionField = keyof Criteria;
type TravelTarget = SearchIntent["travelTargets"][number];
export type Mode = TravelTarget["mode"];
type Source = SearchIntent["fieldSources"][string]["source"];

export const MODES = ["transit", "drive", "walk", "bike"] as const satisfies readonly Mode[];

/** Chip order follows the supported-criteria table (SPEC 5). */
const CRITERIA_ORDER = [
  "rent",
  "priceFairness",
  "bedrooms",
  "bathrooms",
  "sizeSqft",
  "unitTypes",
  "buildingAge",
  "airConditioning",
  "petsAllowed",
  "furnished",
  "parking",
  "laundryInSuite",
  "utilitiesIncluded",
  "availableBy",
  "leaseTerm",
] as const satisfies readonly CriterionField[];

export type Chip = {
  /** The fieldSources key, unique per chip (areas share `areas` for their phrase). */
  key: string;
  kind: "criterion" | "travel" | "safety" | "area" | "household" | "sort" | "extreme";
  label: string;
  /** Must-have (true) or preference (false); null when the chip can't be switched. */
  hard: boolean | null;
  source: Source | null;
  phrase: string | null;
  field?: CriterionField;
  targetId?: string;
  areaIndex?: number;
  householdField?: "annualIncomeCad" | "people";
};

const decimal = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 1 });
const limitFormat = new Intl.NumberFormat("en-CA", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const tk = (key: string, params?: Record<string, string | number>) =>
  t(`filters.chips.${key}` as MessageKey, params);
const or = (labels: string[]) => labels.join(` ${t("filters.or")} `);

function rangeLabel(
  range: { min?: number; max?: number },
  unit: "bedrooms" | "baths",
  format: (n: number) => string = decimal.format,
): string {
  const { min, max } = range;
  if (min !== undefined && max !== undefined) {
    if (min !== max) return tk(`${unit}Range`, { min: format(min), max: format(max) });
    if (unit === "bedrooms" && min === 0) return tk("studio");
    return min === 1 ? tk(`${unit}One`) : tk(`${unit}Exact`, { n: format(min) });
  }
  return min !== undefined
    ? tk(`${unit}Min`, { n: format(min) })
    : tk(`${unit}Max`, { n: format(max!) });
}

function boundLabel(range: { min?: number; max?: number }, prefix: "rent" | "size"): string {
  const format = prefix === "rent" ? formatCad : formatCount;
  const { min, max } = range;
  if (min !== undefined && max !== undefined) {
    return tk(`${prefix}Range`, { min: format(min), max: format(max) });
  }
  return min !== undefined
    ? tk(`${prefix}Min`, { min: format(min), n: format(min) })
    : tk(`${prefix}Max`, { max: format(max!), n: format(max!) });
}

function criterionLabel(criteria: Criteria, field: CriterionField): string | null {
  switch (field) {
    case "rent":
      return criteria.rent ? boundLabel(criteria.rent.value, "rent") : null;
    case "priceFairness":
      return criteria.priceFairness
        ? or(criteria.priceFairness.value.map((label) => tk(`fairness.${label}`)))
        : null;
    case "bedrooms":
      return criteria.bedrooms ? rangeLabel(criteria.bedrooms.value, "bedrooms") : null;
    case "bathrooms":
      return criteria.bathrooms ? rangeLabel(criteria.bathrooms.value, "baths") : null;
    case "sizeSqft":
      return criteria.sizeSqft ? boundLabel(criteria.sizeSqft.value, "size") : null;
    case "unitTypes":
      return criteria.unitTypes
        ? or(criteria.unitTypes.value.map((type) => tk(`unitTypes.${type}`)))
        : null;
    case "buildingAge": {
      if (!criteria.buildingAge) return null;
      const { builtAfter, builtBefore } = criteria.buildingAge.value;
      if (builtAfter !== undefined && builtBefore !== undefined) {
        return tk("builtRange", { after: builtAfter, before: builtBefore });
      }
      return builtAfter !== undefined
        ? tk("builtAfter", { year: builtAfter })
        : tk("builtBefore", { year: builtBefore! });
    }
    case "airConditioning":
      return criteria.airConditioning
        ? tk(criteria.airConditioning.value === "central" ? "acCentral" : "acAny")
        : null;
    case "petsAllowed":
      return criteria.petsAllowed
        ? tk({ cats: "petsCats", dogs: "petsDogs", any: "petsAny" }[criteria.petsAllowed.value])
        : null;
    case "furnished":
      return criteria.furnished ? tk(criteria.furnished.value ? "furnished" : "unfurnished") : null;
    case "parking":
      return criteria.parking ? tk(criteria.parking.value ? "parking" : "noParking") : null;
    case "laundryInSuite":
      return criteria.laundryInSuite
        ? tk(criteria.laundryInSuite.value ? "laundry" : "noLaundry")
        : null;
    case "utilitiesIncluded":
      return criteria.utilitiesIncluded
        ? tk(criteria.utilitiesIncluded.value ? "utilities" : "noUtilities")
        : null;
    case "availableBy":
      return criteria.availableBy
        ? tk("availableBy", { date: formatDate(criteria.availableBy.value) })
        : null;
    case "leaseTerm":
      return criteria.leaseTerm
        ? tk(criteria.leaseTerm.value === "short_term" ? "leaseShort" : "lease12")
        : null;
  }
}

/** "UofT St. George: 25 min by transit", or the engine's default time when none was stated. */
export function travelLabel(target: TravelTarget): string {
  const modes = or(targetModes(target).map((mode) => t(`filters.modes.${mode}` as MessageKey)));
  const stated = target.maxMinutes !== undefined;
  const minutes = target.maxMinutes ?? defaultMinutes(target, target.mode);
  return tk(stated ? "travel" : "travelDefault", {
    label: target.label,
    minutes: formatCount(minutes),
    modes,
  });
}

export function buildChips(intent: SearchIntent): Chip[] {
  const sourceOf = (key: string) => ({
    source: intent.fieldSources[key]?.source ?? null,
    phrase: intent.fieldSources[key]?.phrase ?? null,
  });
  const chips: Chip[] = [];

  for (const field of CRITERIA_ORDER) {
    const pref = intent.criteria[field];
    const label = criterionLabel(intent.criteria, field);
    if (!pref || !label) continue;
    const key = `criteria.${field}`;
    chips.push({ key, kind: "criterion", field, label, hard: pref.hard, ...sourceOf(key) });
  }

  for (const target of intent.travelTargets) {
    const key = `travelTargets.${target.id}`;
    chips.push({
      key,
      kind: "travel",
      targetId: target.id,
      label: travelLabel(target),
      hard: target.hard,
      ...sourceOf(key),
    });
  }

  if (intent.safety.enabled) {
    chips.push({
      key: "safety",
      kind: "safety",
      label: intent.safety.hard
        ? tk("safetyMax", {
            rate: limitFormat.format(intent.safety.maxRelativeRate ?? SAFETY.hardMaxRelativeRate),
          })
        : tk("safety"),
      hard: intent.safety.hard,
      ...sourceOf("safety"),
    });
  }

  intent.areas.forEach((area, areaIndex) => {
    const name =
      area.kind === "near"
        ? tk("near", { km: decimal.format(area.radiusM / 1000) })
        : tk("area", { area: area.kind === "configured" ? area.label : area.id });
    chips.push({
      key: `areas.${areaIndex}`,
      kind: "area",
      areaIndex,
      label: name,
      hard: null,
      ...sourceOf("areas"),
    });
  });

  const { annualIncomeCad, people } = intent.household ?? {};
  if (annualIncomeCad !== undefined) {
    chips.push({
      key: "household.annualIncomeCad",
      kind: "household",
      householdField: "annualIncomeCad",
      label: tk("income", { amount: formatCad(annualIncomeCad) }),
      hard: null,
      ...sourceOf("household.annualIncomeCad"),
    });
  }
  if (people !== undefined) {
    chips.push({
      key: "household.people",
      kind: "household",
      householdField: "people",
      label: tk("people", { n: formatCount(people) }),
      hard: null,
      ...sourceOf("household.people"),
    });
  }

  if (intent.sortBy !== "best_match") {
    chips.push({
      key: "sortBy",
      kind: "sort",
      label: tk("sort", { sort: tk(`sorts.${intent.sortBy}`) }),
      hard: null,
      ...sourceOf("sortBy"),
    });
  }

  if (intent.numericExtreme) {
    const { direction, percentage, field } = intent.numericExtreme;
    chips.push({
      key: "numericExtreme",
      kind: "extreme",
      label: tk("extreme", {
        direction: tk(`directions.${direction}`),
        percentage: decimal.format(percentage),
        field: tk(`extremeFields.${field}`),
      }),
      hard: null,
      ...sourceOf("numericExtreme"),
    });
  }

  return chips;
}

/** Marks a field as edited by the renter, keeping the phrase it came from. */
function edited(intent: SearchIntent, key: string): SearchIntent["fieldSources"] {
  const phrase = intent.fieldSources[key]?.phrase;
  return { ...intent.fieldSources, [key]: { source: "user", ...(phrase ? { phrase } : {}) } };
}

function withoutSource(intent: SearchIntent, key: string): SearchIntent["fieldSources"] {
  const fieldSources = { ...intent.fieldSources };
  delete fieldSources[key];
  return fieldSources;
}

function mapTarget(
  intent: SearchIntent,
  targetId: string,
  update: (target: TravelTarget) => TravelTarget,
): SearchIntent["travelTargets"] {
  return intent.travelTargets.map((target) => (target.id === targetId ? update(target) : target));
}

/** Flips a chip between must-have and preference. */
export function setChipHard(intent: SearchIntent, chip: Chip, hard: boolean): SearchIntent {
  const fieldSources = edited(intent, chip.key);
  if (chip.kind === "criterion" && chip.field) {
    const pref = intent.criteria[chip.field];
    if (!pref) return intent;
    return {
      ...intent,
      criteria: { ...intent.criteria, [chip.field]: { ...pref, hard } } as Criteria,
      fieldSources,
    };
  }
  if (chip.kind === "travel" && chip.targetId) {
    return {
      ...intent,
      travelTargets: mapTarget(intent, chip.targetId, (target) => ({ ...target, hard })),
      fieldSources,
    };
  }
  if (chip.kind === "safety") {
    const { maxRelativeRate } = intent.safety;
    return {
      ...intent,
      safety: {
        enabled: true,
        hard,
        ...(hard && maxRelativeRate !== undefined ? { maxRelativeRate } : {}),
      },
      fieldSources,
    };
  }
  return intent;
}

/** Removes the criterion behind a chip. */
export function removeChip(intent: SearchIntent, chip: Chip): SearchIntent {
  switch (chip.kind) {
    case "criterion": {
      if (!chip.field) return intent;
      const criteria = { ...intent.criteria };
      delete criteria[chip.field];
      return { ...intent, criteria, fieldSources: withoutSource(intent, chip.key) };
    }
    case "travel": {
      const next: SearchIntent = {
        ...intent,
        travelTargets: intent.travelTargets.filter((target) => target.id !== chip.targetId),
        fieldSources: withoutSource(intent, chip.key),
      };
      // A percentile over this target's travel time no longer has a target.
      if (next.numericExtreme?.targetId === chip.targetId) {
        delete next.numericExtreme;
        next.fieldSources = withoutSource(next, "numericExtreme");
      }
      return next;
    }
    case "safety": {
      const next: SearchIntent = {
        ...intent,
        safety: { enabled: false, hard: false },
        fieldSources: withoutSource(intent, "safety"),
      };
      // A safety weight is only allowed while safety is on.
      if (next.weights?.safety) next.weights = { ...next.weights, safety: 0 };
      return next;
    }
    case "area": {
      const areas = intent.areas.filter((_, index) => index !== chip.areaIndex);
      return {
        ...intent,
        areas,
        fieldSources: areas.length ? intent.fieldSources : withoutSource(intent, "areas"),
      };
    }
    case "household": {
      if (!chip.householdField || !intent.household) return intent;
      const household = { ...intent.household };
      delete household[chip.householdField];
      const next: SearchIntent = { ...intent, fieldSources: withoutSource(intent, chip.key) };
      if (Object.keys(household).length) next.household = household;
      else delete next.household;
      return next;
    }
    case "sort":
      return { ...intent, sortBy: "best_match", fieldSources: withoutSource(intent, "sortBy") };
    case "extreme": {
      const next: SearchIntent = {
        ...intent,
        fieldSources: withoutSource(intent, "numericExtreme"),
      };
      delete next.numericExtreme;
      return next;
    }
  }
}

/** Sets the modes a travel target accepts ("bike or walk"). Ignored when no mode is chosen. */
export function setTargetModes(
  intent: SearchIntent,
  targetId: string,
  modes: Mode[],
): SearchIntent {
  const chosen = MODES.filter((mode) => modes.includes(mode));
  if (!chosen.length) return intent;
  return {
    ...intent,
    travelTargets: mapTarget(intent, targetId, (target) => {
      const mode = chosen.includes(target.mode) ? target.mode : chosen[0]!;
      const alternatives = chosen.filter((m) => m !== mode);
      const next: TravelTarget = { ...target, mode };
      if (alternatives.length) next.alternativeModes = alternatives;
      else delete next.alternativeModes;
      return next;
    }),
    fieldSources: edited(intent, `travelTargets.${targetId}`),
  };
}

/** Sets a travel target's time limit; null goes back to the default for its kind and mode. */
export function setTargetMinutes(
  intent: SearchIntent,
  targetId: string,
  minutes: number | null,
): SearchIntent {
  return {
    ...intent,
    travelTargets: mapTarget(intent, targetId, (target) => {
      const next: TravelTarget = { ...target };
      if (minutes !== null && minutes > 0) next.maxMinutes = minutes;
      else delete next.maxMinutes;
      return next;
    }),
    fieldSources: edited(intent, `travelTargets.${targetId}`),
  };
}
