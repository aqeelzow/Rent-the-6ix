// Normalize (SPEC 8.4 step 2): RawListing → the Listing fields that don't need the database.
// Structured source fields win; keyword rules on title + description fill the gaps, and
// fieldEvidence records which one each value came from. Unknown stays unknown, never "no".
// Location, area ids, building match, timestamps and status are added by geocode/upsert (P1.5–P1.6).
// TODO(P0.5): switch these types to B's `Listing` schema in packages/shared/schemas when it lands.
import { asksForMoneyBeforeViewing } from "@rentthe6ix/shared/engine/scam";
import type { RawListing, SourceId, TriState } from "../sources/types.ts";
import { excerpt, scrub } from "./scrub.ts";

export type UnitType = "apartment" | "condo" | "basement" | "house" | "townhouse" | "room";
export type Tri = "yes" | "no" | "unknown";
/** Partial: some utilities included, or the tenant pays a share or one of them (hydro extra). */
export type Utilities = Tri | "partial";
export type AirConditioning = "central" | "yes" | "no" | "unknown";
export type Pets = Tri | "cats_only" | "dogs_only";
export type Evidence = "structured" | "parsed_from_text" | "ai_extracted";

export interface NormalizedListing {
  source: SourceId;
  sourceListingId: string;
  sourceUrl: string;
  title: string;
  excerpt: string;
  monthlyRentCad: number;
  rentIsPerRoom: boolean;
  /** Studio = 0. */
  bedrooms: number | null;
  den: boolean;
  bathrooms: number | null;
  unitType: UnitType | null;
  sqft: number | null;
  yearBuilt: number | null;
  /** 'rentsafeto' is filled after the building match (P1.5); 'ai_extracted' by extract.ts. */
  yearBuiltSource: "listing" | "ai_extracted" | null;
  airConditioning: AirConditioning;
  utilitiesIncluded: Utilities;
  parking: Tri;
  petsAllowed: Pets;
  furnished: Tri;
  laundryInSuite: Tri;
  availableFrom: string | null;
  leaseTerm: string | null;
  addressText: string | null;
  /** Geocoding inputs (P1.5): not Listing fields themselves. */
  postalCode: string | null;
  sourceLocation: { lng: number; lat: number } | null;
  postedAt: string | null;
  /** Scam indicator from the full description (the excerpt is too short to catch it). */
  depositBeforeViewing: boolean;
  fieldEvidence: Partial<Record<EvidenceField, Evidence>>;
}

type EvidenceField =
  | "bedrooms"
  | "bathrooms"
  | "unitType"
  | "sqft"
  | "yearBuilt"
  | "airConditioning"
  | "utilitiesIncluded"
  | "parking"
  | "petsAllowed"
  | "furnished"
  | "laundryInSuite"
  | "availableFrom"
  | "leaseTerm";

// Outside these, the number is a typo, a weekly/nightly price or a sale price.
const RENT_RANGE = [300, 25_000] as const;
/** A whole unit under this is a typo, a deposit or a mislabelled room, not a Toronto rental. */
const MIN_WHOLE_UNIT_RENT = 600;
const SQFT_RANGE = [100, 10_000] as const;
const M2_TO_SQFT = 10.7639;

/** Returns null when the listing has no usable monthly rent. `now` dates "new construction". */
/**
 * Returns null when the listing has no usable monthly rent or isn't housing (parking, storage).
 * `now` dates "new construction".
 */
export function normalize(raw: RawListing, now = new Date()): NormalizedListing | null {
  const rent = Math.round(raw.monthlyRentCad);
  if (!inRange(rent, RENT_RANGE)) return null;
  if (isNotHousing(raw.title)) return null;

  const text = `${raw.title}\n${raw.description ?? ""}`.toLowerCase();
  const evidence: NormalizedListing["fieldEvidence"] = {};
  /** Structured value if present, else the text rule; records where it came from. */
  function pick<T>(field: EvidenceField, structured: T | null, fromText: () => T | null): T | null {
    if (structured !== null) {
      evidence[field] = "structured";
      return structured;
    }
    const parsed = fromText();
    if (parsed !== null) evidence[field] = "parsed_from_text";
    return parsed;
  }

  const posted = isoDateTime(raw.postedAt);
  const listingYear = posted ? Number(posted.slice(0, 4)) : now.getUTCFullYear();

  const beds = pick("bedrooms", validBeds(raw.bedrooms), () => bedroomsFromText(text));
  // A title that says "room for rent" wins: Kijiji files rooms under the house's own type.
  // Likewise "BSMT - 24 Fintona Ave": Realtor.ca files a basement unit as the whole house.
  const structuredType = unitTypeFrom(raw.unitType);
  const unitType = isRoomListing(raw.title)
    ? ((evidence.unitType = "parsed_from_text"), "room" as const)
    : structuredType !== "condo" && isBasementUnit(raw.title, raw.address)
      ? ((evidence.unitType = "parsed_from_text"), "basement" as const)
      : pick("unitType", structuredType, () => unitTypeFrom(raw.title.toLowerCase()));
  if (unitType !== "room" && !raw.rentIsPerRoom && rent < MIN_WHOLE_UNIT_RENT) return null;
  const yearBuilt = pick("yearBuilt", validYear(raw.yearBuilt, now), () =>
    yearBuiltFromText(text, listingYear, now),
  );

  return {
    source: raw.source,
    sourceListingId: raw.sourceListingId,
    sourceUrl: raw.sourceUrl,
    title: scrub(raw.title),
    excerpt: excerpt(raw.description),
    monthlyRentCad: rent,
    rentIsPerRoom: raw.rentIsPerRoom || unitType === "room",
    bedrooms: beds,
    den: raw.den || DEN.test(text),
    bathrooms: pick("bathrooms", validBaths(raw.bathrooms), () => bathroomsFromText(text)),
    unitType,
    sqft: pick("sqft", inRange(raw.sqft, SQFT_RANGE) ? raw.sqft : null, () => sqftFromText(text)),
    yearBuilt,
    yearBuiltSource: yearBuilt === null ? null : "listing",
    airConditioning:
      pick("airConditioning", airConditioningFrom(raw.airConditioning, text), () =>
        airConditioningFromText(text),
      ) ?? "unknown",
    utilitiesIncluded: tri(
      pick(
        "utilitiesIncluded",
        raw.utilitiesIncluded === "partial" ? "partial" : yesNo(raw.utilitiesIncluded),
        () => utilitiesFromText(text),
      ),
    ),
    parking: tri(pick("parking", yesNo(raw.parking), () => rule(text, PARKING))),
    petsAllowed: tri(pick("petsAllowed", yesNo(raw.petsAllowed), () => petsFromText(text))),
    furnished: tri(pick("furnished", yesNo(raw.furnished), () => rule(text, FURNISHED))),
    laundryInSuite: tri(
      pick("laundryInSuite", yesNo(raw.laundryInSuite), () => rule(text, LAUNDRY)),
    ),
    availableFrom: pick("availableFrom", isoDate(raw.availableFrom), () =>
      availableFromText(text, posted ?? now.toISOString()),
    ),
    leaseTerm: pick("leaseTerm", raw.leaseTerm, () => leaseTermFromText(text)),
    addressText: raw.address?.replace(/\s+/g, " ").trim() || null,
    postalCode: postalCode(raw.postalCode),
    sourceLocation:
      raw.lat !== null && raw.lng !== null && raw.lat !== 0 && raw.lng !== 0
        ? { lng: raw.lng, lat: raw.lat }
        : null,
    postedAt: posted,
    depositBeforeViewing: asksForMoneyBeforeViewing(`${raw.title}\n${raw.description ?? ""}`),
    fieldEvidence: evidence,
  };
}

// --- Rooms -------------------------------------------------------------------------------

const DEN = /\b\d\s*(\+|plus)\s*(den|1)\b|\b(plus|and a|with a?)\s+den\b|\bone plus den\b/;
const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
const BED_WORD = "(?:bed(?:room)?s?|bdrms?|bdms?|br|beds?)";

function bedroomsFromText(text: string): number | null {
  if (/\b(studio|bachelor)\b/.test(text)) return 0;
  const digits = text.match(new RegExp(`\\b(\\d)\\s*(?:\\+\\s*(?:den|1)\\s*)?[- ]?${BED_WORD}\\b`));
  if (digits) return Number(digits[1]);
  const words = text.match(new RegExp(`\\b(one|two|three|four|five)[- ]${BED_WORD}\\b`));
  return words ? NUMBER_WORDS[words[1]] : null;
}

function bathroomsFromText(text: string): number | null {
  const m = text.match(/\b(\d(?:\.5)?)\s*[- ]?(?:bath(?:room)?s?|ba|washrooms?)\b/);
  return m ? validBaths(Number(m[1])) : null;
}

function validBeds(n: number | null): number | null {
  return n !== null && Number.isInteger(n) && n >= 0 && n <= 10 ? n : null;
}

function validBaths(n: number | null): number | null {
  return n !== null && n >= 0.5 && n <= 10 ? n : null;
}

// --- Unit type ---------------------------------------------------------------------------

/** Parking spaces and storage lockers listed under rentals. */
export function isNotHousing(title: string): boolean {
  // "PARKING - 8 WELLESLEY STREET", "- EV PARKING (L2 CHARGER) - 11 YORKVILLE AVENUE".
  if (/^\W*(?:ev\s+)?parking\b/i.test(title)) return true;
  // "1BR – Parking, A/C & Heat Included!" is an apartment that comes with parking.
  if (
    /\b(?:\d+\s*-?\s*(?:br|bd|bdrm|bed)s?|bed\w*|bdrm|studio|bachelor|condo|apartment|house|home|room\w*|suite|unit|townhouse|loft)\b/i.test(
      title,
    )
  )
    return false;
  return /\bparking\b|\bstorage (?:locker|unit|space)\b|\blocker\b/i.test(title);
}

/** "Private room for rent", "Room available near Yonge/Finch", "1 Room in Main Floor". */
export function isRoomListing(title: string): boolean {
  return /\brooms? (?:for (?:rent|lease)|available|to rent)\b|\b(?:private|shared|sharing|personal|basement) (?:bed)?rooms?\b|^\W*(?:1|one) room\b|\broom rental\b|\broommates?\b/i.test(
    title,
  );
}

/** Source wording or a title → UnitType. Order matters: "basement apartment" is a basement. */
/**
 * The unit is a basement: "BSMT - 24 Fintona Ave", "LOWER - 40 Rippleton Rd", "90 Billington
 * (LOWER) Cres", "basement apartment for rent". Not "Main + Basement" (the whole house) or a house
 * "with finished basement". Title and address only: descriptions mention basements of houses.
 */
export function isBasementUnit(title: string, address: string | null = null): boolean {
  const text = `${title}\n${address ?? ""}`;
  if (
    /\b(?:main|upper|ground|first|second)(?: floor| level)?\s*(?:\+|&|and)\s*(?:basement|bsmt|bsmnt|lower)\b|\b(?:whole|entire|detached) house\b|\bwith (?:a )?(?:finished |separate )?basement\b|\b(?:no|not a?) basement\b|\babove[- ]ground\b/i.test(
      text,
    )
  ) {
    return false;
  }
  // The unit prefix before an address: "BSMT - 24 Fintona", "LOWER #2 - 12 Arkley", "(LOWER)".
  const prefixed =
    /\b(?:basement|bsmt|bsmnt|lower(?: level| unit| floor)?)\s*(?:#?\s*\w{1,3}\s*)?(?:-|\))|\((?:lower|bsmt|basement)\)|- (?:bsmt|basement)\b/i;
  if (prefixed.test(text)) return true;
  if (/\b(?:basement|bsmt|bsmnt)\s+(?:apartment|apt|unit|suite|studio|flat)\b/i.test(title))
    return true;
  // Free text: a house title mentioning its basement ("house, large yard, basement") is the house.
  if (/\bhouse\b/i.test(title)) return false;
  return /\b(?:basement|bsmt|bsmnt)\b/i.test(text);
}

export function unitTypeFrom(value: string | null): UnitType | null {
  if (!value) return null;
  const v = value.toLowerCase();
  if (/basement|lower level/.test(v)) return "basement";
  if (/\broom\b(?! apartment)|shared (house|accommodation)|\brooms?mate/.test(v)) return "room";
  if (/town ?(house|home)|\brow\b/.test(v)) return "townhouse";
  // "condo-inspired apartment" is a purpose-built rental, not a condo.
  if (/\bcondo\b(?![- ](inspired|style))/.test(v)) return "condo";
  if (/apartment|\bapt\b|\bflat\b|\bloft\b|duplex|triplex|fourplex|suite/.test(v))
    return "apartment";
  if (/\bhouse\b|detached|bungalow/.test(v)) return "house";
  return null;
}

// --- Size and year built -----------------------------------------------------------------

function sqftFromText(text: string): number | null {
  const ft = text.match(
    /\b(\d{1,2},\d{3}|\d{3,5})\s*(?:\+\s*)?(?:sq\.?\s*f(?:ee)?t|sqft|square f(?:ee|oo)t|sf)\b/,
  );
  if (ft)
    return inRange(Number(ft[1].replace(",", "")), SQFT_RANGE)
      ? Number(ft[1].replace(",", ""))
      : null;
  const m2 = text.match(/\b(\d{2,4}(?:\.\d+)?)\s*(?:m2|m²|sq\.?\s*m\b|square met(?:er|re)s?)/);
  if (!m2) return null;
  const sqft = Math.round(Number(m2[1]) * M2_TO_SQFT);
  return inRange(sqft, SQFT_RANGE) ? sqft : null;
}

function yearBuiltFromText(text: string, listingYear: number, now: Date): number | null {
  const built = text.match(
    /\b(?:built|constructed|completed) (?:in )?((?:18|19|20)\d{2})\b|\b((?:19|20)\d{2})[- ]built\b/,
  );
  if (built) return validYear(Number(built[1] ?? built[2]), now);
  if (
    /\bnew(?:ly)?[- ]?(?:construction|built|build)\b|\bbrand[- ]new (?:building|condo|construction|tower)\b/.test(
      text,
    )
  )
    return listingYear;
  return null;
}

function validYear(year: number | null, now: Date): number | null {
  return year !== null && year >= 1800 && year <= now.getUTCFullYear() + 3 ? year : null;
}

// --- Air conditioning --------------------------------------------------------------------

const CENTRAL_AIR = /\bcentral (?:air|a\/?c\b|cooling)/;
const NO_AIR = /\bno (?:a\/c|ac|air[- ]?condition\w*)\b/;
const SOME_AIR =
  /\ba\/c\b|\bair[- ]?condition\w*|\bwindow (?:ac|a\/c|unit)\b|\bductless\b|\bheat pump\b/;

function airConditioningFrom(value: TriState | "central", text: string): AirConditioning | null {
  if (value === "central") return "central";
  if (value === true) return CENTRAL_AIR.test(text) ? "central" : "yes";
  return value === false ? "no" : null;
}

function airConditioningFromText(text: string): AirConditioning | null {
  if (NO_AIR.test(text)) return "no";
  if (CENTRAL_AIR.test(text)) return "central";
  return SOME_AIR.test(text) ? "yes" : null;
}

// --- Tri-state amenities -----------------------------------------------------------------

interface Rule {
  yes: RegExp;
  no: RegExp;
}

const UTILITIES: Rule = {
  yes: /\ball[- ]inclusive\b|\butilities (?:are )?included\b|\ball utilities (?:are )?(?:included|covered)\b|\bincludes?:? (?:\+\s*)?(?:all )?utilities\b|\binclusive of (?:all )?utilities\b/,
  no: /\+\s*(?:all )?utilities\b|\bplus (?:all )?utilities\b|\butilities (?:are )?(?:extra|not included|additional)\b|\btenants? pays? (?:for )?(?:all )?utilities\b/,
};
/** A share of the bills ("40% of utilities", "split utilities") or one utility extra ("hydro extra"). */
const UTILITIES_PARTIAL =
  /\b\d{1,3} ?% (?:of (?:the )?)?(?:total )?(?:utilit|hydro|bills)|\b(?:1\/2|1\/3|2\/3|half|one[- ]third|a third|a portion|portion|share|split) of (?:the )?(?:utilit|hydro|bills)|\butilities (?:are |will be )?(?:split|shared)\b|\bsplit (?:the )?utilities\b|\bshares? (?:the )?(?:cost of (?:the )?)?utilities\b|\btenants? pays? (?:for )?hydro\b|\bhydro (?:is )?(?:extra|not included)\b|(?:\+|\bplus) ?hydro\b/;
const PARKING: Rule = {
  yes: /(?<!no )\bparking (?:spot |space )?(?:is )?(?:included|available)\b|\b\d (?:parking|car)\b|\b(?:underground|garage|driveway|indoor) parking\b|\bincludes? (?:\w+ )?parking\b/,
  no: /\bno parking\b|\bparking (?:is )?not (?:included|available)\b/,
};
const FURNISHED: Rule = {
  yes: /\b(?:fully |semi[- ])?furnished\b/,
  no: /\bunfurnished\b|\bnot furnished\b/,
};
const LAUNDRY: Rule = {
  yes: /\b(?:en[- ]?suite|in[- ]suite|in[- ]unit|private|own) (?:laundry|washer)|\bwasher (?:and|&|\/) dryer in (?:the )?(?:unit|suite)\b/,
  no: /\b(?:shared|coin|common|coin[- ]operated|on[- ]site) laundry\b|\blaundry (?:room )?(?:in|on) (?:the )?(?:building|basement|each floor)\b/,
};

function utilitiesFromText(text: string): Utilities | null {
  return UTILITIES_PARTIAL.test(text) ? "partial" : rule(text, UTILITIES);
}

/** Both a yes and a no phrase ("furnished or unfurnished") means it's unclear: unknown. */
function rule(text: string, r: Rule): "yes" | "no" | null {
  const no = r.no.test(text);
  const yes = r.yes.test(text);
  if (yes === no) return null;
  return yes ? "yes" : "no";
}

function petsFromText(text: string): Pets | null {
  if (/\bcats? only\b|\bonly cats?\b/.test(text)) return "cats_only";
  if (/\bdogs? only\b|\bonly dogs?\b/.test(text)) return "dogs_only";
  return rule(text, {
    yes: /(?<!not )\bpet[- ]friendly\b|(?<!no )\bpets? (?:are )?(?:allowed|welcome|ok|okay)\b/,
    no: /\bno pets\b|\bpets? (?:are )?not allowed\b|\bnot pet[- ]friendly\b/,
  });
}

function yesNo(value: TriState): "yes" | "no" | null {
  return value === null ? null : value ? "yes" : "no";
}

function tri<T extends string>(value: T | null): T | "unknown" {
  return value ?? "unknown";
}

// --- Dates and lease ---------------------------------------------------------------------

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "available December 1st" → the next Dec 1 on or after the month the listing was posted. */
function availableFromText(text: string, postedIso: string): string | null {
  const m = text.match(
    /\bavailable (?:from |on |starting |as of )?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? (\d{1,2})(?:st|nd|rd|th)?\b/,
  );
  if (!m) return null;
  const month = MONTHS.indexOf(m[1]);
  const day = Number(m[2]);
  if (day < 1 || day > 31) return null;
  const posted = new Date(postedIso);
  let year = posted.getUTCFullYear();
  if (month < posted.getUTCMonth()) year++;
  return isoDate(`${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
}

function leaseTermFromText(text: string): string | null {
  if (/\bmonth[- ]to[- ]month\b/.test(text)) return "month-to-month";
  const months = text.match(/\b(\d{1,2})[- ]months? lease\b/);
  if (months) return `${Number(months[1])} months`;
  if (/\b(?:one|1)[- ]year lease\b/.test(text)) return "12 months";
  if (/\bshort[- ]term\b/.test(text)) return "short-term";
  return null;
}

/** YYYY-MM-DD for a real calendar date, else null. */
function isoDate(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value.slice(0, 10)
    ? null
    : value.slice(0, 10);
}

function isoDateTime(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** "m4m2z8" → "M4M 2Z8"; anything that isn't a Canadian postal code → null. */
export function postalCode(value: string | null): string | null {
  const m = value?.trim().match(/^([A-Z]\d[A-Z])\s?(\d[A-Z]\d)$/i);
  return m ? `${m[1]} ${m[2]}`.toUpperCase() : null;
}

function inRange(n: number | null, [min, max]: readonly [number, number]): n is number {
  return n !== null && Number.isFinite(n) && n >= min && n <= max;
}
