// Facebook Marketplace rentals in Waterloo (#2). Facebook embeds each page's data as Relay JSON
// in <script type="application/json"> tags; listings are GroupCommerceProductItem objects.
//
// Logged out (checked 2026-11-21), the property-rentals feed serves the 24 newest listings around
// a point and won't scroll further, but it takes the point from the URL. So the index is a grid
// of 1 km circles covering the City (WATERLOO_TILES); each tile is one index "page". The feed
// gives title, price, beds/baths and city but no coordinates; the listing's own page adds the
// description, coordinates, postal code, street and unit details.
//
// Never read or stored: the seller (`marketplace_listing_seller`), messaging fields, photos
// (Facebook's CDN links expire and the terms of hot-linking are unchecked).
//
// Facebook slows clients down after rapid requests, so pages are 10 s apart by default
// (FB_REQUEST_DELAY_MS). FB_PROFILE_DIR runs the session in a saved browser profile, e.g. a
// logged-in account, if logged-out access is ever cut off.
import { htmlToText } from "../lib/text.ts";
import { SourceBlockedError } from "../lib/fetch.ts";
import { emptyRawListing, type DetailPatch, type RawListing, type SourceAdapter } from "./types.ts";

const ORIGIN = "https://www.facebook.com";

/**
 * 1 km search circles covering the City of Waterloo: a 1.4 km square grid (UTM 17N) whose
 * circles touch the City's neighbourhoods, generated from the database on 2026-11-21.
 */
export const WATERLOO_TILES: readonly (readonly [number, number])[] = [
  [43.5204, -80.5391],
  [43.5203, -80.5218],
  [43.5202, -80.5045],
  [43.5202, -80.4871],
  [43.5201, -80.4698],
  [43.5079, -80.5738],
  [43.5078, -80.5565],
  [43.5078, -80.5392],
  [43.5077, -80.5219],
  [43.5076, -80.5046],
  [43.5075, -80.4873],
  [43.5075, -80.4699],
  [43.4954, -80.6086],
  [43.4954, -80.5912],
  [43.4953, -80.5739],
  [43.4952, -80.5566],
  [43.4952, -80.5393],
  [43.4951, -80.522],
  [43.495, -80.5047],
  [43.4949, -80.4874],
  [43.4949, -80.47],
  [43.4829, -80.626],
  [43.4828, -80.6086],
  [43.4828, -80.5913],
  [43.4827, -80.574],
  [43.4826, -80.5567],
  [43.4826, -80.5394],
  [43.4825, -80.5221],
  [43.4824, -80.5048],
  [43.4823, -80.4875],
  [43.4703, -80.626],
  [43.4702, -80.6087],
  [43.4701, -80.5914],
  [43.4701, -80.5741],
  [43.47, -80.5568],
  [43.4699, -80.5395],
  [43.4699, -80.5222],
  [43.4698, -80.5049],
  [43.4697, -80.4876],
  [43.4576, -80.6088],
  [43.4575, -80.5915],
  [43.4575, -80.5742],
  [43.4574, -80.5569],
  [43.4573, -80.5396],
  [43.4573, -80.5223],
  [43.4572, -80.505],
  [43.4449, -80.5916],
  [43.4449, -80.5743],
  [43.4448, -80.557],
  [43.4447, -80.5397],
  [43.4447, -80.5224],
  [43.4323, -80.5744],
  [43.4322, -80.5571],
];
const TILE_RADIUS_KM = 1;

export function facebookTileUrl(tile: number): string {
  const [lat, lng] = WATERLOO_TILES[tile];
  return `${ORIGIN}/marketplace/category/propertyrentals?latitude=${lat}&longitude=${lng}&radius=${TILE_RADIUS_KM}`;
}

export function facebookItemUrl(id: string): string {
  return `${ORIGIN}/marketplace/item/${id}/`;
}

/** The fields we read from a GroupCommerceProductItem; everything else is ignored. */
interface FbItem {
  __typename?: string;
  id?: string;
  marketplace_listing_title?: string | null;
  custom_title?: string | null;
  custom_sub_titles_with_rendering_flags?: { subtitle?: string | null }[] | null;
  listing_price?: { amount?: string | null } | null;
  formatted_price?: { text?: string | null } | null;
  location?: {
    latitude?: number | null;
    longitude?: number | null;
    reverse_geocode?: { city?: string | null; state?: string | null } | null;
    reverse_geocode_detailed?: {
      city?: string | null;
      state?: string | null;
      postal_code?: string | null;
    } | null;
  } | null;
  creation_time?: number | null;
  is_sold?: boolean | null;
  is_pending?: boolean | null;
  is_hidden?: boolean | null;
  is_live?: boolean | null;
  redacted_description?: { text?: string | null } | null;
  home_address?: { street?: string | null } | null;
  pdp_display_sections?:
    { section_type?: string; pdp_fields?: { display_label?: string | null }[] | null }[] | null;
}

/** Every Relay JSON payload embedded in the page. */
function embeddedJson(html: string): unknown[] {
  const out: unknown[] = [];
  for (const m of html.matchAll(/<script type="application\/json"[^>]*>([\s\S]*?)<\/script>/g)) {
    if (!m[1].includes("GroupCommerceProductItem")) continue;
    try {
      out.push(JSON.parse(m[1]));
    } catch {
      // A payload we can't parse carries nothing we need.
    }
  }
  return out;
}

/** Listing objects anywhere in the payloads, merged by id (feed and map entries complement each other). */
function findItems(payloads: unknown[], keep: (item: FbItem) => boolean): Map<string, FbItem> {
  const items = new Map<string, FbItem>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    if (!node || typeof node !== "object") return;
    const item = node as FbItem;
    if (item.__typename === "GroupCommerceProductItem" && item.id && keep(item)) {
      items.set(item.id, { ...items.get(item.id), ...stripNulls(item) });
    }
    for (const value of Object.values(node)) walk(value);
  };
  for (const payload of payloads) walk(payload);
  return items;
}

function stripNulls(item: FbItem): FbItem {
  return Object.fromEntries(Object.entries(item).filter(([, v]) => v !== null)) as FbItem;
}

/** "CA$2,180" / "2180.00" → 2180. */
export function priceCad(item: FbItem): number | null {
  const raw = item.listing_price?.amount ?? item.formatted_price?.text ?? null;
  if (!raw) return null;
  const n = Number(raw.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/** Beds, baths and size from "2 beds · 1 bath · 1,000 sq ft" or the title "2 Beds 1 Bath - House". */
export function unitFacts(text: string): {
  bedrooms: number | null;
  bathrooms: number | null;
  sqft: number | null;
} {
  const beds = text.match(/(\d+)\s*beds?\b/i);
  const baths = text.match(/(\d+(?:\.\d)?)\s*baths?\b/i);
  const sqft = text.match(/([\d,]+)\s*(?:sq\.?\s*ft|square feet)/i);
  return {
    bedrooms: beds ? Number(beds[1]) : /\bstudio\b/i.test(text) ? 0 : null,
    bathrooms: baths ? Number(baths[1]) : null,
    sqft: sqft ? Number(sqft[1].replace(/,/g, "")) || null : null,
  };
}

/** "2 Beds 1 Bath - House" → "House". */
function typeFromTitle(title: string): string | null {
  const m = title.match(/\bbaths?\b\s*[-–]\s*([A-Za-z ]+)$/i);
  return m ? m[1].trim() : null;
}

const HOUSING =
  /\b(rooms?|bed(room)?s?|apartment|apt|condo|house|home|basement|suite|studio|bachelor|townhouse|townhome|duplex|unit|sublet|lease|loft|flat)\b/i;
const NOT_HOUSING =
  /\b(salon|office|hall|storage|parking|garage spot|dance|venue|event|commercial|retail|warehouse|shop|booth|desk|chair rental|tent|backdrop|equipment|car|truck|trailer)\b/i;

/** The property-rentals feed also carries halls, salon chairs and party gear; keep homes. */
export function isHousing(title: string, customTitle: string | null | undefined): boolean {
  if (customTitle && /\bbeds?\b|\bstudio\b/i.test(customTitle)) return true;
  return HOUSING.test(title) && !NOT_HOUSING.test(title);
}

/** "29 Hickory St W" from the subtitles; a bare "Waterloo, ON" is the city, not a street. */
function streetFrom(subtitles: string[]): string | null {
  for (const s of subtitles) {
    const first = s.split(",")[0].trim();
    if (/^\d+[A-Za-z]?\s+\S/.test(first)) return first;
  }
  return null;
}

/** "29 Hickory St W, Waterloo, ON N2L 3H8"; just the city when there's no street. */
export function addressText(
  street: string | null,
  city: string | null,
  postal: string | null = null,
): string | null {
  if (!street && !city) return null;
  const place = city ? `${city}, ON` : "ON";
  return [street, `${place}${postal ? ` ${postal}` : ""}`].filter(Boolean).join(", ");
}

function toRawListing(item: FbItem): RawListing | null {
  const title = item.marketplace_listing_title?.trim();
  const rent = priceCad(item);
  if (!item.id || !title || !rent) return null;
  if (item.is_sold || item.is_pending || item.is_hidden || item.is_live === false) return null;
  if (!isHousing(title, item.custom_title)) return null;
  const facts = unitFacts(`${item.custom_title ?? ""} ${title}`);
  const subtitles = (item.custom_sub_titles_with_rendering_flags ?? [])
    .map((s) => s.subtitle?.trim())
    .filter((s): s is string => !!s);
  const cityFromSubtitle = subtitles
    .map((s) => s.match(/^([A-Za-z .'-]+),\s*ON\b/)?.[1])
    .find(Boolean);
  const city = item.location?.reverse_geocode?.city ?? cityFromSubtitle ?? null;
  const unitType = typeFromTitle(title);
  const room = /^room\b/i.test(unitType ?? "") || /\broom\b/i.test(title);
  const lat = item.location?.latitude ?? null;
  const lng = item.location?.longitude ?? null;
  return {
    ...emptyRawListing,
    source: "facebook_marketplace",
    sourceListingId: item.id,
    sourceUrl: facebookItemUrl(item.id),
    title,
    monthlyRentCad: rent,
    rentIsPerRoom: room,
    unitType: room ? "room" : unitType,
    ...facts,
    address: addressText(streetFrom(subtitles), city),
    lat,
    lng,
    postedAt: item.creation_time ? new Date(item.creation_time * 1000).toISOString() : null,
  };
}

/** The listings on one property-rentals feed page (feed and map entries). */
export function parseFacebookIndex(html: string): RawListing[] {
  const items = findItems(embeddedJson(html), (i) => !!i.marketplace_listing_title);
  return [...items.values()].map(toRawListing).filter((l): l is RawListing => l !== null);
}

/** Unit details ("Central AC", "In-unit laundry", "Cat friendly") → our fields. */
export function detailFields(labels: string[]): DetailPatch {
  const has = (re: RegExp) => labels.some((l) => re.test(l));
  const patch: DetailPatch = {};
  if (has(/central (ac|air)/i)) patch.airConditioning = "central";
  else if (has(/\b(ac|air conditioning)\b/i)) patch.airConditioning = true;
  if (has(/in-unit laundry|washer.*dryer in unit/i)) patch.laundryInSuite = true;
  else if (has(/laundry in building|shared laundry|laundry available|no laundry/i))
    patch.laundryInSuite = false;
  if (has(/^unfurnished/i)) patch.furnished = false;
  else if (has(/furnished/i)) patch.furnished = true;
  if (has(/no pets|pets not allowed/i)) patch.petsAllowed = false;
  else if (has(/cat friendly|dog friendly|pet friendly|pets allowed/i)) patch.petsAllowed = true;
  if (has(/garage parking|off-street parking|parking available|driveway|underground parking/i))
    patch.parking = true;
  else if (has(/street parking|no parking/i)) patch.parking = false;
  const facts = unitFacts(labels.join(" · "));
  if (facts.bedrooms !== null) patch.bedrooms = facts.bedrooms;
  if (facts.bathrooms !== null) patch.bathrooms = facts.bathrooms;
  if (facts.sqft !== null) patch.sqft = facts.sqft;
  const type = labels.find((l) =>
    /^(apartment|house|townhouse|condo|room|private room|shared room|basement|studio)$/i.test(l),
  );
  if (type) patch.unitType = /room/i.test(type) ? "room" : type;
  if (type && /room/i.test(type)) patch.rentIsPerRoom = true;
  return patch;
}

/** The listing's own page: description, coordinates, address and unit details. */
export function parseFacebookDetail(html: string, id: string): DetailPatch {
  const item = findItems(embeddedJson(html), (i) => i.id === id && !!i.redacted_description).get(
    id,
  );
  if (!item) return {};
  const loc = item.location;
  const city = loc?.reverse_geocode_detailed?.city ?? null;
  const postal = loc?.reverse_geocode_detailed?.postal_code ?? null;
  const street = item.home_address?.street?.trim() || null;
  const labels = (item.pdp_display_sections ?? [])
    .filter((s) => s.section_type === "UNIT_INCLUDES")
    .flatMap((s) => s.pdp_fields ?? [])
    .map((f) => f.display_label?.trim())
    .filter((l): l is string => !!l);
  const description = item.redacted_description?.text?.trim();
  const patch: DetailPatch = {
    ...detailFields(labels),
    description: description ? htmlToText(description) : null,
    address: addressText(street, city, postal),
    postalCode: postal,
    lat: loc?.latitude ?? null,
    lng: loc?.longitude ?? null,
  };
  const rent = priceCad(item);
  if (rent) patch.monthlyRentCad = rent;
  return patch;
}

function blockedIfLogin(url: string, finalUrl: string): void {
  // Facebook sends a refused or rate-limited visitor to its login or checkpoint page.
  if (/\/(login|checkpoint)\b/.test(new URL(finalUrl).pathname)) {
    throw new SourceBlockedError(url, `redirected to ${new URL(finalUrl).pathname}`);
  }
}

export const facebookMarketplace: SourceAdapter = {
  id: "facebook_marketplace",
  displayName: "Facebook Marketplace",
  // Each index page is one map circle; the first few are farmland at the City's north edge.
  fullPages: WATERLOO_TILES.length,
  sessionOptions: () => ({
    delayMs: Number(process.env.FB_REQUEST_DELAY_MS ?? 10_000),
    profileDir: process.env.FB_PROFILE_DIR || undefined,
  }),
  async fetchIndex(session, cursor) {
    const tile = cursor ? Number(cursor) : 0;
    const url = facebookTileUrl(tile);
    const page = await session.visit(url, { settleMs: 3000 });
    blockedIfLogin(url, page.url);
    const listings = parseFacebookIndex(page.html);
    const next = tile + 1 < WATERLOO_TILES.length ? String(tile + 1) : null;
    return { listings, nextCursor: next };
  },
  async fetchDetail(session, listing) {
    const page = await session.visit(listing.sourceUrl, { settleMs: 2000 });
    blockedIfLogin(listing.sourceUrl, page.url);
    return parseFacebookDetail(page.html, listing.sourceListingId);
  },
};
