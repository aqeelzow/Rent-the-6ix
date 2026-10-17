// Caveats on cards and the detail page (SPEC 7.7). Owner: C. Pure: no I/O, no clock.
// Caveat text lives only here. Scam-related caveats are indicators, never accusations.
// TODO(P0.5): switch the input/output types to B's `Listing` / `Caveat` schemas when they land.
import { CAVEATS as C } from "./config";
import type { Tri, Valuation } from "./valuation";

export type CaveatSeverity = "info" | "warning" | "high";

export type CaveatCode =
  | "deposit_before_viewing"
  | "rent_far_below"
  | "duplicate_text_elsewhere"
  | "approx_location"
  | "stale"
  | "fields_unknown"
  | "rentsafeto_low"
  | "insufficient_comparables";

export interface Caveat {
  severity: CaveatSeverity;
  code: CaveatCode;
  title: string;
  explanation: string;
}

/** The listing fields caveats read. */
export interface CaveatListing {
  title: string;
  excerpt: string;
  locationPrecision: "exact" | "street" | "area";
  /** ISO timestamp. */
  lastSeenAt: string;
  utilitiesIncluded: Tri;
  petsAllowed: Tri | "cats_only" | "dogs_only";
  laundryInSuite: Tri;
  parking: Tri;
  airConditioning: "central" | "yes" | "no" | "unknown";
}

export interface CaveatContext {
  valuation: Pick<Valuation, "status" | "differencePct"> | null;
  /** The matched RentSafeTO building's latest evaluation, if any. Score is 0–100. */
  building: { latestScore: number | null; scoreDate: string | null } | null;
  /** Other listings with the same description at a different address or price (from SQL). */
  sameTextElsewhere: number;
  now: Date;
}

const SEVERITY_ORDER: Record<CaveatSeverity, number> = { high: 0, warning: 1, info: 2 };
const DAY_MS = 86_400_000;

/** All caveats that apply, most severe first. */
export function caveats(listing: CaveatListing, ctx: CaveatContext): Caveat[] {
  const out: Caveat[] = [];

  if (asksForMoneyBeforeViewing(`${listing.title} ${listing.excerpt}`))
    out.push({
      severity: "high",
      code: "deposit_before_viewing",
      title: "Asks for money before a viewing",
      explanation:
        "The listing mentions a deposit or e-transfer before you've seen the place. This is a common sign of rental scams. Don't send money until you've viewed the unit and signed a lease.",
    });

  const pct = ctx.valuation?.status === "ok" ? ctx.valuation.differencePct : undefined;
  if (pct !== undefined && pct > C.farBelowPct)
    out.push({
      severity: "warning",
      code: "rent_far_below",
      title: "Unusually low for this area",
      explanation: `Listed ${Math.round(pct)}% below similar listings nearby. Verify the listing is real before sending money.`,
    });

  if (ctx.sameTextElsewhere > 0)
    out.push({
      severity: "warning",
      code: "duplicate_text_elsewhere",
      title: "Same description elsewhere",
      explanation: `The same description appears on ${plural(ctx.sameTextElsewhere, "other listing")} at a different address or price. Check that this is the unit you think it is.`,
    });

  if (listing.locationPrecision !== "exact")
    out.push({
      severity: "info",
      code: "approx_location",
      title: "Approximate location",
      explanation:
        listing.locationPrecision === "street"
          ? "The listing gives a street or intersection, not an address, so the pin and travel times are approximate."
          : "The listing only names the area, so the pin is the area's centre and travel times are approximate.",
    });

  const daysSinceSeen = Math.floor(
    (ctx.now.getTime() - new Date(listing.lastSeenAt).getTime()) / DAY_MS,
  );
  if (daysSinceSeen >= C.staleDays)
    out.push({
      severity: "info",
      code: "stale",
      title: "May no longer be available",
      explanation: `We last saw this listing ${plural(daysSinceSeen, "day")} ago.`,
    });

  const unknown = unknownFields(listing);
  if (unknown.length >= C.minUnknownFields)
    out.push({
      severity: "info",
      code: "fields_unknown",
      title: "Some details not stated",
      explanation: `The listing doesn't say: ${unknown.join(", ")}. Ask before you apply.`,
    });

  const score = ctx.building?.latestScore;
  if (score !== null && score !== undefined && score < C.rentSafeToLowScore)
    out.push({
      severity: "info",
      code: "rentsafeto_low",
      title: "Low RentSafeTO score",
      explanation: `The building scored ${Math.round(score)}% in its latest City of Toronto RentSafeTO evaluation${ctx.building?.scoreDate ? ` (${ctx.building.scoreDate})` : ""}. Buildings under ${C.rentSafeToLowScore}% are evaluated every year.`,
    });

  if (ctx.valuation?.status === "insufficient_data")
    out.push({
      severity: "info",
      code: "insufficient_comparables",
      title: "Not enough data to judge the price",
      explanation: "There aren't enough similar listings nearby to compare this rent with.",
    });

  return out.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

// A money word and a "before the viewing" phrase in the same sentence, in either order.
const MONEY = String.raw`\b(?:deposit|e-?transfer|etransfer|interac|first (?:and|&) last|payment|wire|western union|gift cards?|bitcoin|crypto)\b`;
const BEFORE_VIEWING = String.raw`\b(?:before|prior to|to (?:book|schedule|arrange|secure|hold|reserve))\b[^.!?]{0,40}?\b(?:view(?:ing)?|showing|visit|tour|see (?:it|the (?:unit|place|apartment))|keys?)\b`;
const MONEY_BEFORE_VIEWING = new RegExp(
  `${MONEY}[^.!?]{0,80}?${BEFORE_VIEWING}|${BEFORE_VIEWING}[^.!?]{0,80}?${MONEY}`,
  "i",
);

// "Send the deposit and I'll mail you the keys": the landlord never shows the unit.
const KEYS_BY_MAIL = /\b(?:mail|courier|ship|post)(?:ed)? (?:you )?the keys?\b/i;

export function asksForMoneyBeforeViewing(text: string): boolean {
  return (
    MONEY_BEFORE_VIEWING.test(text) ||
    (KEYS_BY_MAIL.test(text) && new RegExp(MONEY, "i").test(text))
  );
}

const FIELD_NAMES: [keyof CaveatListing, string][] = [
  ["utilitiesIncluded", "utilities"],
  ["petsAllowed", "pets"],
  ["laundryInSuite", "laundry"],
  ["parking", "parking"],
  ["airConditioning", "air conditioning"],
];

function unknownFields(listing: CaveatListing): string[] {
  return FIELD_NAMES.filter(([field]) => listing[field] === "unknown").map(([, name]) => name);
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
