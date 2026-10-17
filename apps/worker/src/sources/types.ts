// Adapter contract for listing sources (SPEC 8.4). Owner: C.
// RawListing is what an adapter hands to the pipeline: source fields read as-is, before
// normalize/scrub/geocode turn it into a shared `Listing`.
import type { Session } from "../lib/fetch.ts";

export type SourceId = "kijiji" | "torontorentals" | "rentals_ca" | "zillow" | "realtor_ca";

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
  airConditioning: TriState;
  furnished: TriState;
  petsAllowed: TriState;
  parking: TriState;
  laundryInSuite: TriState;
  utilitiesIncluded: TriState;
  /** ISO date; null when unknown or "now". */
  availableFrom: string | null;
  address: string | null;
  postalCode: string | null;
  lat: number | null;
  lng: number | null;
  postedAt: string | null;
}

export interface IndexPage {
  listings: RawListing[];
  /** Cursor for the next index page, or null when this was the last one. */
  nextCursor: string | null;
}

export interface SourceAdapter {
  id: SourceId;
  displayName: string;
  /** Load one index page (cursor null = first page) and return the listings on it. */
  fetchIndex(session: Session, cursor: string | null): Promise<IndexPage>;
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
  address: null,
  postalCode: null,
  lat: null,
  lng: null,
  postedAt: null,
} satisfies Partial<RawListing>;
