import { formatDate } from "@/lib/format/date";
import { t, type MessageKey } from "@/lib/format/messages";
import { formatCount } from "@/lib/format/number";
import type { SearchIntent, SearchResultItem } from "@/lib/store/types";

// What the listing detail page shows (SPEC 11.3), from B's SearchResult / DetailResponse.
// Pure, so the honest-label rules are tested: unknown is "Not stated", never "no".

type Listing = SearchResultItem["listing"];
type Row = SearchResultItem["travel"][number];
type Part = SearchResultItem["matchScore"]["parts"][number];
export type Mode = Row["mode"];

export const MODES: Mode[] = ["transit", "drive", "walk", "bike"];

const l = (key: string, params?: Record<string, string | number>) =>
  t(`listing.${key}` as MessageKey, params);
const decimal = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 1 });

export type HomeField = {
  key: string;
  label: string;
  /** null means the listing doesn't say (shown as "Not stated", never as "no"). */
  value: string | null;
  /** Read from the description by AI (SPEC 10.4); shown with a small badge. */
  aiRead: boolean;
};

const tri = (value: "yes" | "no" | "unknown") =>
  value === "unknown" ? null : l(value === "yes" ? "values.yes" : "values.no");

/** Every unit field, in a fixed order, with unknowns kept as null (SPEC 11.3 "The home"). */
export function homeFields(listing: Listing): HomeField[] {
  const year =
    listing.yearBuilt === null
      ? null
      : listing.yearBuiltSource && listing.yearBuiltSource !== "listing"
        ? l("values.yearFrom", {
            year: listing.yearBuilt,
            source: l(`values.yearSource.${listing.yearBuiltSource}`),
          })
        : String(listing.yearBuilt);
  const lease =
    listing.leaseTerm === null
      ? null
      : listing.leaseTerm === "12_months"
        ? l("values.lease12")
        : listing.leaseTerm === "short_term"
          ? l("values.leaseShort")
          : listing.leaseTerm;

  const fields: Omit<HomeField, "aiRead">[] = [
    {
      key: "bedrooms",
      label: l("fields.bedrooms"),
      value:
        listing.bedrooms === null
          ? null
          : listing.bedrooms === 0
            ? l("values.studio")
            : formatCount(listing.bedrooms),
    },
    {
      key: "bathrooms",
      label: l("fields.bathrooms"),
      value: listing.bathrooms === null ? null : decimal.format(listing.bathrooms),
    },
    {
      key: "sqft",
      label: l("fields.size"),
      value: listing.sqft === null ? null : l("values.sqft", { n: formatCount(listing.sqft) }),
    },
    {
      key: "unitType",
      label: l("fields.unitType"),
      value:
        listing.unitType === null
          ? null
          : t(`filters.chips.unitTypes.${listing.unitType}` as MessageKey),
    },
    { key: "yearBuilt", label: l("fields.yearBuilt"), value: year },
    {
      key: "airConditioning",
      label: l("fields.airConditioning"),
      value:
        listing.airConditioning === "unknown" ? null : l(`values.ac.${listing.airConditioning}`),
    },
    {
      key: "petsAllowed",
      label: l("fields.pets"),
      value: listing.petsAllowed === "unknown" ? null : l(`values.pets.${listing.petsAllowed}`),
    },
    { key: "furnished", label: l("fields.furnished"), value: tri(listing.furnished) },
    { key: "parking", label: l("fields.parking"), value: tri(listing.parking) },
    { key: "laundryInSuite", label: l("fields.laundry"), value: tri(listing.laundryInSuite) },
    {
      key: "utilitiesIncluded",
      label: l("fields.utilities"),
      value:
        listing.utilitiesIncluded === "unknown"
          ? null
          : l(`values.utilities.${listing.utilitiesIncluded}`),
    },
    {
      key: "availableFrom",
      label: l("fields.availableFrom"),
      value: listing.availableFrom === null ? null : formatDate(listing.availableFrom),
    },
    { key: "leaseTerm", label: l("fields.leaseTerm"), value: lease },
    {
      key: "locationPrecision",
      label: l("fields.location"),
      value: l(`values.precision.${listing.locationPrecision}`),
    },
  ];
  return fields.map((field) => ({
    ...field,
    aiRead: listing.fieldEvidence[field.key] === "ai_extracted",
  }));
}

export type ModeTime =
  | { mode: Mode; kind: "routed"; minutes: number }
  | { mode: Mode; kind: "straight_line"; distanceM: number }
  | { mode: Mode; kind: "missing" };

export type TargetTravel = {
  id: string;
  label: string;
  /** The modes the renter asked for; highlighted on the page. */
  chosen: Mode[];
  modes: ModeTime[];
};

/**
 * Each travel target with its time in all four modes (SPEC 7.4): routed minutes when OTP gave
 * one, else straight-line distance (never minutes), else missing.
 */
export function travelTable(targets: SearchIntent["travelTargets"], rows: Row[]): TargetTravel[] {
  return targets.map((target) => ({
    id: target.id,
    label: target.label,
    chosen: [target.mode, ...(target.alternativeModes ?? [])],
    modes: MODES.map((mode): ModeTime => {
      const forMode = rows.filter((row) => row.targetId === target.id && row.mode === mode);
      const routed = forMode.find((row) => row.method === "otp" && row.minutes !== null);
      if (routed) return { mode, kind: "routed", minutes: Math.round(routed.minutes!) };
      const line = forMode.find((row) => row.method === "straight_line");
      if (line) return { mode, kind: "straight_line", distanceM: line.distanceM };
      return { mode, kind: "missing" };
    }),
  }));
}

export type BreakdownPart = {
  id: Part["id"];
  score: number;
  /** Share of the total, 0–1, after renormalising (SPEC 7.5). */
  effectiveWeight: number;
  /** score × effectiveWeight; the parts' points add up to the total. */
  points: number;
  evidence: string[];
};

/** Score parts that count toward the total, and the ones left out because they had no data. */
export function scoreBreakdown(matchScore: SearchResultItem["matchScore"]): {
  total: number;
  parts: BreakdownPart[];
  omitted: Part["id"][];
} {
  const counted = matchScore.parts.filter(
    (part): part is Part & { score: number } => part.score !== null && part.effectiveWeight > 0,
  );
  return {
    total: matchScore.total,
    parts: counted.map((part) => ({
      id: part.id,
      score: part.score,
      effectiveWeight: part.effectiveWeight,
      points: part.score * part.effectiveWeight,
      evidence: part.evidence,
    })),
    omitted: matchScore.parts.filter((part) => !counted.includes(part as never)).map((p) => p.id),
  };
}
