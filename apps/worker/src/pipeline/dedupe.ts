// Dedupe (SPEC 8.4 step 5): the same unit listed on several sites. Two listings match when they
// are on different sources, have the same bedrooms, and either sit within 50 m with rents within
// 3%, or their title + excerpt are ≥ 0.6 trigram-similar (pg_trgm's measure, so SQL agrees).
// The oldest listing in a group is canonical; the others get `duplicateOf`.
// Same-source pairs never match: torontorentals lists each floor plan of a building separately at
// the same point, and property managers reuse one description across their buildings. Two different
// street addresses never match either: downtown, two $2,000 1-beds 40 m apart are two units.
import type { SourceId } from "../sources/types.ts";

export interface DedupeListing {
  id: string;
  source: SourceId;
  location: { lng: number; lat: number };
  bedrooms: number | null;
  monthlyRentCad: number;
  title: string;
  excerpt: string;
  /** As the source shows it ("2207 - 181 WYNFORD DRIVE Toronto …", "109 Erskine Ave, Toronto"). */
  addressText: string | null;
  /** ISO timestamp; the oldest becomes canonical. */
  firstSeenAt: string;
}

export const DEDUPE = {
  maxDistanceM: 50,
  maxRentDifference: 0.03,
  minTextSimilarity: 0.6,
  /** Shorter text than this (title + excerpt) is too generic for the text rule ("1 bed at X"). */
  minTextLength: 40,
} as const;

export function isDuplicate(a: DedupeListing, b: DedupeListing): boolean {
  if (a.source === b.source) return false;
  if (a.bedrooms === null || a.bedrooms !== b.bedrooms) return false;
  const ka = streetKey(a.addressText);
  const kb = streetKey(b.addressText);
  if (ka && kb && ka !== kb) return false;
  const near = distanceM(a.location, b.location) <= DEDUPE.maxDistanceM;
  const rentClose =
    Math.abs(a.monthlyRentCad - b.monthlyRentCad) / Math.max(a.monthlyRentCad, b.monthlyRentCad) <=
    DEDUPE.maxRentDifference;
  if (near && rentClose) return true;
  const ta = text(a);
  const tb = text(b);
  if (ta.length < DEDUPE.minTextLength || tb.length < DEDUPE.minTextLength) return false;
  return similarity(ta, tb) >= DEDUPE.minTextSimilarity;
}

/** id → canonical id for every listing that duplicates an older one. */
export function findDuplicates(listings: DedupeListing[]): Map<string, string> {
  const ordered = [...listings].sort(
    (a, b) => a.firstSeenAt.localeCompare(b.firstSeenAt) || a.id.localeCompare(b.id),
  );
  const canonical: DedupeListing[] = [];
  const duplicateOf = new Map<string, string>();
  for (const listing of ordered) {
    const match = canonical.find((c) => isDuplicate(c, listing));
    if (match) duplicateOf.set(listing.id, match.id);
    else canonical.push(listing);
  }
  return duplicateOf;
}

/** Sources a canonical listing is "Also on", for the results card. */
export function alsoOn(
  canonicalId: string,
  listings: DedupeListing[],
  duplicateOf: Map<string, string>,
): SourceId[] {
  const own = listings.find((l) => l.id === canonicalId)?.source;
  const sources = listings
    .filter((l) => duplicateOf.get(l.id) === canonicalId && l.source !== own)
    .map((l) => l.source);
  return [...new Set(sources)].sort();
}

const STREET_TYPES = new Set(
  "street st avenue ave road rd drive dr boulevard blvd way crescent cres court ct place pl lane ln trail terrace circle parkway pkwy square sq gate grove park gardens east west e w".split(
    " ",
  ),
);

/**
 * "195 redpath" from any source's address spelling: the street number and the first word of the
 * street name, with unit numbers ("2207 - ", "#204"), street types and the city dropped.
 * null when there's no street number.
 */
export function streetKey(address: string | null): string | null {
  if (!address) return null;
  let a = address
    .toLowerCase()
    .split(",")[0]
    .split(/\s+toronto\b/)[0];
  if (a.includes(" - ")) a = a.slice(a.lastIndexOf(" - ") + 3);
  a = a
    .replace(/#\s*\S+/g, " ")
    .replace(/^\s*-\s*/, "")
    .trim();
  const m = a.match(/^(\d+)[a-z]?(?:-\d+[a-z]?)?\s+(.+)$/);
  // "1 bed at …" is a title, not an address.
  if (!m || /^(bed|bedroom|br|bath|studio)s?\b/.test(m[2])) return null;
  const name = m[2].split(/\s+/).find((w) => !STREET_TYPES.has(w.replace(/\.$/, "")));
  return name ? `${m[1]} ${name}` : null;
}

function text(l: DedupeListing): string {
  return `${l.title} ${l.excerpt}`.trim();
}

// --- pg_trgm-compatible similarity -------------------------------------------------------

/** pg_trgm's trigrams: lowercase words of letters/digits, each padded "  word ". */
export function trigrams(value: string): Set<string> {
  const out = new Set<string>();
  for (const word of value.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (!word) continue;
    const padded = `  ${word} `;
    for (let i = 0; i + 3 <= padded.length; i++) out.add(padded.slice(i, i + 3));
  }
  return out;
}

/** Shared trigrams ÷ all trigrams, as `similarity()` in pg_trgm. */
export function similarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared);
}

// --- Distance ----------------------------------------------------------------------------

const EARTH_RADIUS_M = 6_371_008.8;

/** Great-circle distance in metres. */
export function distanceM(
  a: { lng: number; lat: number },
  b: { lng: number; lat: number },
): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}
