// Realtor.ca rentals in Toronto. The map page loads results from
// api2.realtor.ca/Listing.svc/PropertySearch_Post; we capture that response while the page loads.
// Realtor.ca answers plain Playwright with "Sorry, you have been blocked" (403); CloakBrowser gets
// through and the parser was checked against a live response on 2026-10-16 (SOURCES.md).
import { emptyRawListing, type RawListing, type SourceAdapter } from "./types.ts";

const ORIGIN = "https://www.realtor.ca";
// Toronto bounding box, rentals only (TransactionTypeId=3).
const MAP_HASH =
  "ZoomLevel=11&Center=43.718%2C-79.378&LatitudeMax=43.856&LongitudeMax=-79.115&LatitudeMin=43.581&LongitudeMin=-79.639&TransactionTypeId=3&PropertySearchTypeId=0&Currency=CAD";

interface RealtorResult {
  Id?: string;
  MlsNumber?: string;
  RelativeDetailsURL?: string;
  PublicRemarks?: string | null;
  InsertedDateUTC?: string | null;
  PostalCode?: string | null;
  Building?: {
    Bedrooms?: string;
    BathroomTotal?: string;
    SizeInterior?: string;
    Type?: string;
  } | null;
  Property?: {
    LeaseRent?: string;
    Price?: string;
    Type?: string;
    Address?: { AddressText?: string; Latitude?: string; Longitude?: string } | null;
  } | null;
}

interface RealtorResponse {
  Paging?: { CurrentPage?: number; TotalPages?: number } | null;
  Results?: RealtorResult[];
}

export function findRealtorResults(bodies: unknown[]): RealtorResponse | null {
  return (
    (bodies.find((b) => Array.isArray((b as RealtorResponse)?.Results)) as RealtorResponse) ?? null
  );
}

export function parseRealtor(response: RealtorResponse): RawListing[] {
  const listings: RawListing[] = [];
  for (const r of response.Results ?? []) {
    const rent = money(r.Property?.LeaseRent ?? r.Property?.Price);
    if (!r.MlsNumber || !r.RelativeDetailsURL || !rent) continue;
    // "2 + 1" = two bedrooms plus a den.
    const [beds, plus] = (r.Building?.Bedrooms ?? "").split("+").map((s) => s.trim());
    const address = r.Property?.Address?.AddressText?.replace("|", ", ") ?? null;
    listings.push({
      ...emptyRawListing,
      source: "realtor_ca",
      sourceListingId: r.MlsNumber,
      sourceUrl: `${ORIGIN}${r.RelativeDetailsURL}`,
      title: address ?? `MLS ${r.MlsNumber}`,
      description: r.PublicRemarks ?? null,
      monthlyRentCad: rent,
      bedrooms: beds ? Number(beds) : null,
      den: Boolean(plus && Number(plus) > 0),
      bathrooms: r.Building?.BathroomTotal ? Number(r.Building.BathroomTotal) : null,
      unitType: r.Building?.Type ?? r.Property?.Type ?? null,
      sqft: sqft(r.Building?.SizeInterior),
      address,
      postalCode: r.PostalCode ?? null,
      lat: r.Property?.Address?.Latitude ? Number(r.Property.Address.Latitude) : null,
      lng: r.Property?.Address?.Longitude ? Number(r.Property.Address.Longitude) : null,
      postedAt: r.InsertedDateUTC ?? null,
    });
  }
  return listings;
}

function money(text: string | undefined): number | null {
  const digits = text?.split("/")[0].replace(/[^\d.]/g, "");
  return digits ? Number(digits) : null;
}

function sqft(text: string | undefined): number | null {
  const n = Number(text?.match(/[\d.]+/)?.[0]);
  if (!n) return null;
  return /m2|m²/i.test(text ?? "") ? Math.round(n * 10.7639) : n;
}

export const realtorCa: SourceAdapter = {
  id: "realtor_ca",
  displayName: "Realtor.ca",
  async fetchIndex(session, cursor) {
    const page = cursor ? Number(cursor) : 1;
    const { json } = await session.visit(`${ORIGIN}/map#${MAP_HASH}&CurrentPage=${page}`, {
      captureJson: (u) => u.includes("PropertySearch_Post"),
      settleMs: 4000,
    });
    const response = findRealtorResults(json);
    if (!response)
      throw new Error(`realtor_ca: no results response on page ${page} (page layout changed?)`);
    const total = response.Paging?.TotalPages ?? 0;
    return { listings: parseRealtor(response), nextCursor: page < total ? String(page + 1) : null };
  },
};
