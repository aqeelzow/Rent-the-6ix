// Adapter contract for listing sources (SPEC 8.4). Owner: C.
// RawListing is what an adapter hands to the pipeline: source fields read as-is, before
// normalize/scrub/geocode turn it into a shared `Listing`.
import type { Session } from "../lib/fetch.ts";

/** Sources with a scraping adapter. */
export type AdapterId = "kijiji" | "torontorentals" | "rentals_ca" | "zillow" | "realtor_ca";
/** Every source a stored listing can have; `manual` rows come from db/seed/manual.csv. */
export type SourceId = AdapterId | "manual";

/** true / false when the source says so, null when it doesn't (unknown is not "no"). */
export type TriState = boolean | null;

export interface RawListing {
  source: SourceId;
  sourceListingId: string;
  sourceUrl: string;
  title: string;
  /** Unscrubbed text from the source; the pipeline scrubs it and cuts the excerpt. */
  description: string | null;
  monthlyRentCad: number;
  rentIsPerRoom: boolean;
  /** Studio = 0. */
  bedrooms: number | null;
  den: boolean;
  bathrooms: number | null;
  /** Source wording, mapped to `UnitType` by normalize. */
  unitType: string | null;
  sqft: number | null;
  yearBuilt: number | null;
  /** "central" when the source says central air; true = some kind of AC. */
  airConditioning: TriState | "central";
  furnished: TriState;
  petsAllowed: TriState;
  parking: TriState;
  laundryInSuite: TriState;
  /** "partial" when some utilities are included and some aren't. */
  utilitiesIncluded: TriState | "partial";
  /** ISO date; null when unknown or "now". */
  availableFrom: string | null;
  /** Normalized wording: "12 months", "month-to-month", "short-term". */
  leaseTerm: string | null;
  address: string | null;
  postalCode: string | null;
  lat: number | null;
  lng: number | null;
  postedAt: string | null;
  /**
   * The source's own thumbnail URL, hot-linked by the web app; the image itself is never fetched
   * or stored (SPEC 8.5). Only for sources whose terms allow linking (SOURCES.md).
   */
  imageUrl: string | null;
}

/** An https URL as given, else null: a thumbnail link must never be a data: or javascript: URL. */
export function httpsUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

/**
 * An index page loaded but carried no results. On the first page that means the layout changed;
 * after it, almost always that the site's "next page" overshot the last one.
 */
export class NoResultsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoResultsError";
  }
}

export interface IndexPage {
  listings: RawListing[];
  /** Cursor for the next index page, or null when this was the last one. */
  nextCursor: string | null;
}

/** Fields a listing's own page adds or corrects; null/absent = the page doesn't say. */
export type DetailPatch = Partial<Omit<RawListing, "source" | "sourceListingId" | "sourceUrl">>;

/** A full listing parsed from its own page, minus the identity fields. */
export function toPatch(listing: RawListing): DetailPatch {
  const patch: DetailPatch & Partial<RawListing> = { ...listing };
  delete patch.source;
  delete patch.sourceListingId;
  delete patch.sourceUrl;
  return patch;
}

export interface SourceAdapter {
  id: SourceId;
  displayName: string;
  /** Load one index page (cursor null = first page) and return the listings on it. */
  fetchIndex(session: Session, cursor: string | null): Promise<IndexPage>;
  /** Load the listing's own page for the full description and amenities (SPEC 8.4 step 1). */
  fetchDetail?(session: Session, listing: RawListing): Promise<DetailPatch>;
}

export const emptyRawListing = {
  description: null,
  rentIsPerRoom: false,
  bedrooms: null,
  den: false,
  bathrooms: null,
  unitType: null,
  sqft: null,
  yearBuilt: null,
  airConditioning: null,
  furnished: null,
  petsAllowed: null,
  parking: null,
  laundryInSuite: null,
  utilitiesIncluded: null,
  availableFrom: null,
  leaseTerm: null,
  address: null,
  postalCode: null,
  lat: null,
  lng: null,
  postedAt: null,
  imageUrl: null,
} satisfies Partial<RawListing>;
