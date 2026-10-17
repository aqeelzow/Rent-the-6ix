// Realtor.ca rentals in Toronto. The map page loads results from
// api2.realtor.ca/Listing.svc/PropertySearch_Post; we capture that response while the page loads.
// One map view serves at most 600 results (MaxRecords), so the Toronto box is split into tiles:
// a view that reports more than it serves is split in four, until every tile fits.
// Realtor.ca answers plain Playwright with "Sorry, you have been blocked" (403); CloakBrowser gets
// through and the parser was checked against a live response on 2026-10-16 (SOURCES.md).
import { htmlToText } from "../lib/text.ts";
import {
  emptyRawListing,
  httpsUrl,
  type DetailPatch,
  type RawListing,
  type SourceAdapter,
} from "./types.ts";

const ORIGIN = "https://www.realtor.ca";

export interface Box {
  latMin: number;
  latMax: number;
  lngMin: number;
  lngMax: number;
}

/** City of Toronto bounding box (also catches some of Vaughan and Mississauga; geocode drops them). */
export const TORONTO_BOX: Box = {
  latMin: 43.581,
  latMax: 43.856,
  lngMin: -79.639,
  lngMax: -79.115,
};
/** Tiles under ~1.1 km tall (2 × this) aren't split again: that many rentals there is a few big buildings. */
const MIN_TILE_DEG = 0.005;
const DEFAULT_MAX_RECORDS = 600;

/** Map page URL for a box, rentals only (TransactionTypeId=3). */
export function realtorMapUrl(box: Box, page: number): string {
  const lat = (box.latMin + box.latMax) / 2;
  const lng = (box.lngMin + box.lngMax) / 2;
  const zoom = Math.max(
    11,
    Math.min(16, Math.round(11 + Math.log2(0.275 / (box.latMax - box.latMin)))),
  );
  const hash = new URLSearchParams({
    ZoomLevel: String(zoom),
    Center: `${lat.toFixed(4)},${lng.toFixed(4)}`,
    LatitudeMax: box.latMax.toFixed(4),
    LongitudeMax: box.lngMax.toFixed(4),
    LatitudeMin: box.latMin.toFixed(4),
    LongitudeMin: box.lngMin.toFixed(4),
    TransactionTypeId: "3",
    PropertySearchTypeId: "0",
    Currency: "CAD",
    CurrentPage: String(page),
  });
  return `${ORIGIN}/map#${hash}`;
}

/** Tiles still to visit and the page of the first one. */
export interface TileCursor {
  queue: Box[];
  page: number;
}

/** Where to go after a page: next page, split the tile, next tile, or done (null). */
export function nextTileCursor(
  state: TileCursor,
  paging: RealtorResponse["Paging"],
): TileCursor | null {
  const [box, ...rest] = state.queue;
  const totalRecords = paging?.TotalRecords ?? 0;
  const maxRecords = paging?.MaxRecords ?? DEFAULT_MAX_RECORDS;
  if (state.page === 1 && totalRecords > maxRecords && box.latMax - box.latMin > MIN_TILE_DEG * 2)
    return { queue: [...split(box), ...rest], page: 1 };
  if (state.page < (paging?.TotalPages ?? 0)) return { queue: state.queue, page: state.page + 1 };
  return rest.length ? { queue: rest, page: 1 } : null;
}

function split(b: Box): Box[] {
  const lat = round4((b.latMin + b.latMax) / 2);
  const lng = round4((b.lngMin + b.lngMax) / 2);
  return [
    { latMin: lat, latMax: b.latMax, lngMin: b.lngMin, lngMax: lng },
    { latMin: lat, latMax: b.latMax, lngMin: lng, lngMax: b.lngMax },
    { latMin: b.latMin, latMax: lat, lngMin: b.lngMin, lngMax: lng },
    { latMin: b.latMin, latMax: lat, lngMin: lng, lngMax: b.lngMax },
  ];
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

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
    /** The property's photos. (Agent photos sit under `Individual`, which is never read.) */
    Photo?: { HighResPath?: string; MedResPath?: string; LowResPath?: string }[] | null;
  } | null;
}

interface RealtorResponse {
  Paging?: {
    CurrentPage?: number;
    TotalPages?: number;
    TotalRecords?: number;
    MaxRecords?: number;
  } | null;
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
    // Only LeaseRent: a sale listing (Price only) sometimes slips into the first response.
    const rent = money(r.Property?.LeaseRent);
    if (!r.MlsNumber || !r.RelativeDetailsURL || !rent) continue;
    // "2 + 1" = two bedrooms plus a den.
    const [beds, plus] = (r.Building?.Bedrooms ?? "").split("+").map((s) => s.trim());
    const address = r.Property?.Address?.AddressText?.replace("|", ", ") ?? null;
    const cover = r.Property?.Photo?.[0];
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
      postedAt: ticksToIso(r.InsertedDateUTC),
      // HighResPath is the largest Realtor.ca publishes (640 px); MedResPath is 256 px.
      imageUrl: httpsUrl(cover?.HighResPath ?? cover?.MedResPath ?? cover?.LowResPath),
    });
  }
  return listings;
}

// .NET ticks: 100 ns steps since 0001-01-01 UTC.
const TICKS_AT_UNIX_EPOCH = 621_355_968_000_000_000n;

export function ticksToIso(ticks: string | null | undefined): string | null {
  if (!ticks || !/^\d+$/.test(ticks)) return null;
  const ms = Number((BigInt(ticks) - TICKS_AT_UNIX_EPOCH) / 10_000n);
  return new Date(ms).toISOString();
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

/**
 * The listing page is server-rendered: label/value pairs ("Cooling" → "Central air conditioning")
 * and the description. The agent's name and phone are on the page too and are never read.
 */
export function parseRealtorDetail(html: string): DetailPatch {
  const fields = new Map<string, string>();
  for (const m of html.matchAll(
    /<div class="propertyDetailsSectionContentLabel">\s*([^<]*?)\s*<\/div>\s*<div class="propertyDetailsSectionContentValue">([\s\S]*?)<\/div>/g,
  ))
    fields.set(htmlToText(m[1]).toLowerCase(), htmlToText(m[2]));
  const description = html.match(/<div id="propertyDescriptionCon">([\s\S]*?)<\/div>/)?.[1];
  const cooling = fields.get("cooling");
  const appliances = fields.get("appliances included") ?? "";
  const spaces = fields.get("total parking spaces");
  return {
    description: description ? htmlToText(description) : null,
    airConditioning: !cooling
      ? null
      : /^none$/i.test(cooling)
        ? false
        : /central/i.test(cooling)
          ? "central"
          : true,
    // Washer and dryer included with a rental means they're in the unit.
    laundryInSuite: /washer/i.test(appliances) && /dryer/i.test(appliances) ? true : null,
    parking: spaces === undefined || Number.isNaN(Number(spaces)) ? null : Number(spaces) > 0,
  };
}

export const realtorCa: SourceAdapter = {
  id: "realtor_ca",
  displayName: "Realtor.ca",
  async fetchIndex(session, cursor) {
    const state: TileCursor = cursor ? JSON.parse(cursor) : { queue: [TORONTO_BOX], page: 1 };
    const url = realtorMapUrl(state.queue[0], state.page);
    const { json } = await session.visit(url, {
      captureJson: (u) => u.includes("PropertySearch_Post"),
      settleMs: 4000,
    });
    const response = findRealtorResults(json);
    if (!response)
      throw new Error(`realtor_ca: no results response on ${url} (page layout changed?)`);
    const next = nextTileCursor(state, response.Paging);
    return { listings: parseRealtor(response), nextCursor: next ? JSON.stringify(next) : null };
  },
  async fetchDetail(session, listing) {
    const { html } = await session.visit(listing.sourceUrl);
    return parseRealtorDetail(html);
  },
};
