// Geocode (SPEC 8.4 step 3, P1.5): match each stored listing's address to a City of Waterloo
// Address Point, then join areas.
// 1. Exact: the listing's normalized address equals `address_norm` ("89 CHURCH ST").
// 2. Fuzzy: same house number, pg_trgm similarity ≥ FUZZY_MIN ("89 CHURCH STR" → "89 CHURCH ST").
// Either match must lie within MAX_SHIFT_M of the source's own point, so "22 Grand Ave" in
// another city never moves a listing across the map. A match sets location_precision 'exact',
// address_point_id and the point's neighbourhood. No match: the source's point stays at
// 'street' precision.
// Then, once D's tables are loaded: neighbourhood by point-in-polygon for the rest;
// listings outside every Waterloo neighbourhood are dropped (outside the City of Waterloo, which
// includes Kitchener, except a Waterloo address within EDGE_M of the line, whose point is just
// imprecise).
import type { Sql } from "postgres";

/** A match further than this from the source's point is a different place with the same address. */
export const MAX_SHIFT_M = 2_000;
export const FUZZY_MIN = 0.6;
/** A listing whose address says Waterloo is kept this close outside the City boundary. */
export const EDGE_M = 300;
/** Waterloo neighbourhood ids (`WPD-<code>`, RENT_K_DUBS_SPEC.md Geography model). */
export const WATERLOO_ID_PREFIX = "WPD-";

// Address Points abbreviations (the last street-type word and a trailing direction).
const STREET_TYPES: Record<string, string> = {
  STREET: "ST",
  STR: "ST",
  AVENUE: "AVE",
  AV: "AVE",
  ROAD: "RD",
  DRIVE: "DR",
  CRESCENT: "CRES",
  CRESENT: "CRES",
  CR: "CRES",
  BOULEVARD: "BLVD",
  BLV: "BLVD",
  COURT: "CRT",
  CT: "CRT",
  PLACE: "PL",
  // Waterloo writes CIR and GATE in full; Toronto used CRCL and GT.
  CIRCLE: "CIR",
  LANE: "LN",
  TRAIL: "TRL",
  GARDENS: "GDNS",
  GARDEN: "GDNS",
  TERRACE: "TER",
  TERR: "TER",
  GROVE: "GRV",
  PARKWAY: "PKWY",
  PKY: "PKWY",
  SQUARE: "SQ",
  HEIGHTS: "HTS",
  PARK: "PK",
};
const DIRECTIONS: Record<string, string> = { EAST: "E", WEST: "W", NORTH: "N", SOUTH: "S" };
const ONES = [
  "",
  "FIRST",
  "SECOND",
  "THIRD",
  "FOURTH",
  "FIFTH",
  "SIXTH",
  "SEVENTH",
  "EIGHTH",
  "NINTH",
  "TENTH",
  "ELEVENTH",
  "TWELFTH",
  "THIRTEENTH",
  "FOURTEENTH",
  "FIFTEENTH",
  "SIXTEENTH",
  "SEVENTEENTH",
  "EIGHTEENTH",
  "NINETEENTH",
];
const TENS = ["", "", "TWENTY", "THIRTY", "FORTY", "FIFTY", "SIXTY", "SEVENTY", "EIGHTY", "NINETY"];
const TENTHS = ["", "", "TWENTIETH", "THIRTIETH", "FORTIETH", "FIFTIETH"];

/** 39 → "THIRTY NINTH" (Address Points spells numbered streets out). */
function ordinalWords(n: number): string | null {
  if (n < 1 || n > 59) return null;
  if (n < 20) return ONES[n];
  return n % 10 === 0 ? TENTHS[n / 10] : `${TENS[Math.floor(n / 10)]} ${ONES[n % 10]}`;
}

// Other municipalities near or often confused with Waterloo. Kitchener is out of coverage too.
const OTHER_CITIES =
  "kitchener|cambridge|guelph|woolwich|elmira|st\\.? jacobs|breslau|wilmot|baden|new hamburg|stratford|brantford|toronto|mississauga|brampton|hamilton|london|milton|burlington|oakville";
const STREET_WORDS =
  "st|street|rd|road|ave|avenue|dr|drive|blvd|boulevard|cres|crescent|crt|court|way|pkwy|lane|ln|sq|square|gate|trail|terrace|place|pl|circle|cir|heights|park|line|mall";
const OTHER_CITY = new RegExp(
  `(?<!\\b(?:near|to|from|of|by|and|border|close to|minutes?|min|mins)\\s)(?<![&/]\\s?)(?<!waterloo\\s*[-–/]?\\s*)\\b(?:${OTHER_CITIES})\\b(?!\\s+(?:${STREET_WORDS})\\b)(?!\\s*[&/]|\\s+and\\s)(?!\\s*[-–]?\\s*waterloo\\b)`,
  "i",
);

/**
 * The title or address places the listing in another city ("Kitchener Finished Basement",
 * "45 Hespeler Rd, Cambridge"); not "near Kitchener", "Kitchener-Waterloo" or "Guelph St".
 * Only used for listings without an Address Point: a match proves the address is in Waterloo.
 */
export function namesOtherCity(title: string, address: string | null = null): boolean {
  return OTHER_CITY.test(title) || (address !== null && OTHER_CITY.test(address));
}

export interface NormalizedAddress {
  /** "89", "28A". */
  number: string;
  /** Address Points form: "89 CHURCH ST". */
  norm: string;
}

/**
 * A source address in Address Points' form, or null without a house number and street.
 * "3507 - 89 CHURCH STREET, Toronto (…)" / "5949 Yonge St #801, Toronto" / "41 Dalton Rd - BSMT".
 */
export function normalizeAddress(text: string | null): NormalizedAddress | null {
  if (!text) return null;
  let first = text.replace(/^\s*-\s*/, "").split(",")[0];
  // A unit before or after " - ": keep the side that reads "<number> <street>".
  const sides = first.split(/\s+-\s+/);
  first = sides.find((s) => /^\s*\d+[A-Za-z]?\s+[A-Za-z]/.test(s)) ?? sides[0];
  const cleaned = first
    .replace(/\((?:[^)]*)\)/g, " ") // "(LOWER)", "(BSMT)"
    .replace(/#\s*\S+/g, " ") // "#801", "#Basement"
    .replace(/\b(?:unit|apt|suite|ste|ph)\.?\s*\S+$/i, " ")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const m = cleaned.match(/^(\d+[A-Z]?) ([A-Z0-9].*)$/);
  if (!m) return null;
  const words = m[2].split(" ").map((w) => {
    const ord = w.match(/^(\d{1,2})(?:ST|ND|RD|TH)$/);
    return ord ? (ordinalWords(Number(ord[1])) ?? w) : w;
  });
  const tokens = words.join(" ").split(" ");
  let end = tokens.length - 1;
  if (end > 0 && (DIRECTIONS[tokens[end]] || /^[NSEW]$/.test(tokens[end]))) {
    tokens[end] = DIRECTIONS[tokens[end]] ?? tokens[end];
    end--;
  }
  // Only the street-type word is abbreviated: "PARK LAWN RD" keeps its PARK.
  if (end > 0 && STREET_TYPES[tokens[end]]) tokens[end] = STREET_TYPES[tokens[end]];
  return { number: m[1], norm: `${m[1]} ${tokens.join(" ")}` };
}

export interface GeocodeResult {
  candidates: number;
  exact: number;
  fuzzy: number;
  /** Listings given a neighbourhood by point-in-polygon. */
  areaJoined: number;
  /** Listings outside every Waterloo neighbourhood, deleted (0 until they are loaded). */
  outsideCoverage: number;
  /** Unmatched listings whose title or address names another city, deleted. */
  otherCity: number;
}

/** Listings per matching query, and per UPDATE (short statements: other writers never wait long). */
const MATCH_BATCH = 5_000;
const WRITE_BATCH = 500;

/**
 * Geocode every stored listing without an Address Point; safe to run after every ingest.
 * Matching is read-only; matches are written in small batches, so a long run never holds locks
 * that block migrations or the app.
 */
export async function geocodeStored(
  sql: Sql,
  options: { dryRun?: boolean } = {},
): Promise<GeocodeResult & { matches?: Map<string, string> }> {
  const rows = await sql<{ id: string; address_text: string | null }[]>`
    SELECT id, address_text FROM listings
    WHERE address_point_id IS NULL AND status <> 'removed'`;
  const items = rows
    .map((r) => ({ id: r.id, address: normalizeAddress(r.address_text) }))
    .filter((r): r is { id: string; address: NormalizedAddress } => r.address !== null);
  const result: GeocodeResult = {
    candidates: items.length,
    exact: 0,
    fuzzy: 0,
    areaJoined: 0,
    outsideCoverage: 0,
    otherCity: 0,
  };

  // 1. Exact address, nearest point if the City has several. `|| ''` keeps the planner off the
  // trigram index (16 ms per equality probe); a hash join over Address Points takes about a second.
  const matches = new Map<string, string>();
  for (let i = 0; i < items.length; i += MATCH_BATCH) {
    const batch = items.slice(i, i + MATCH_BATCH);
    const found = await sql<{ id: string; ap_id: string }[]>`
      WITH g AS (
        SELECT * FROM unnest(${batch.map((b) => b.id)}::uuid[], ${batch.map((b) => b.address.norm)}::text[])
          AS g(id, norm))
      SELECT DISTINCT ON (g.id) g.id, ap.id AS ap_id
      FROM g
      JOIN listings src ON src.id = g.id
      JOIN address_points ap ON ap.address_norm || '' = g.norm
      WHERE ST_DWithin(ap.location, src.location, ${MAX_SHIFT_M})
      ORDER BY g.id, ST_Distance(ap.location, src.location)`;
    for (const f of found) matches.set(f.id, f.ap_id);
  }
  result.exact = matches.size;

  // 2. Same house number, close spelling ("CHURCH STR", "ST CLAIR AVE W" vs "ST. CLAIR"); `%` is
  // index-backed at the session's threshold, set to FUZZY_MIN (a fixed constant).
  const rest = items.filter((it) => !matches.has(it.id));
  if (rest.length) {
    await sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL pg_trgm.similarity_threshold = ${FUZZY_MIN}`);
      for (let i = 0; i < rest.length; i += MATCH_BATCH) {
        const batch = rest.slice(i, i + MATCH_BATCH);
        const found = await tx<{ id: string; ap_id: string }[]>`
          WITH g AS (
            SELECT * FROM unnest(${batch.map((b) => b.id)}::uuid[], ${batch.map((b) => b.address.number)}::text[],
              ${batch.map((b) => b.address.norm)}::text[]) AS g(id, num, norm))
          SELECT g.id, ap.ap_id
          FROM g
          JOIN listings src ON src.id = g.id
          CROSS JOIN LATERAL (
            SELECT a.id AS ap_id
            FROM address_points a
            WHERE a.address_norm % g.norm
              AND a.address_norm LIKE g.num || ' %'
              AND ST_DWithin(a.location, src.location, ${MAX_SHIFT_M})
            ORDER BY similarity(a.address_norm, g.norm) DESC, a.location <-> src.location
            LIMIT 1
          ) ap`;
        for (const f of found) matches.set(f.id, f.ap_id);
      }
    });
  }
  result.fuzzy = matches.size - result.exact;

  // A dry run stops here: matching is read-only.
  if (options.dryRun) return { ...result, matches };

  // Write: the point's location, precision and areas, in short batches.
  const pairs = [...matches];
  for (let i = 0; i < pairs.length; i += WRITE_BATCH) {
    const batch = pairs.slice(i, i + WRITE_BATCH);
    await sql`
      UPDATE listings l SET
        location = ap.location, location_precision = 'exact', address_point_id = ap.id,
        neighbourhood_id = coalesce(ap.neighbourhood_id, l.neighbourhood_id), updated_at = now()
      FROM unnest(${batch.map((p) => p[0])}::uuid[], ${batch.map((p) => p[1])}::text[]) AS m(id, ap_id)
      JOIN address_points ap ON ap.id = m.ap_id
      WHERE l.id = m.id AND l.address_point_id IS NULL`;
  }

  const [{ neighbourhoods, waterloo }] = await sql<
    { neighbourhoods: number; waterloo: number }[]
  >`
    SELECT (SELECT count(*)::int FROM neighbourhoods) AS neighbourhoods,
      (SELECT count(*)::int FROM neighbourhoods WHERE id LIKE ${WATERLOO_ID_PREFIX + "%"}) AS waterloo`;

  if (neighbourhoods) {
    result.areaJoined = (
      await sql`
        UPDATE listings l SET
          neighbourhood_id = (SELECT n.id FROM neighbourhoods n WHERE ST_Covers(n.geometry, l.location::geometry) LIMIT 1),
          updated_at = now()
        WHERE l.neighbourhood_id IS NULL AND l.status <> 'removed'`
    ).count;
  }
  // Waterloo's neighbourhoods cover the City; a point outside every one (Kitchener, Woolwich)
  // isn't Waterloo. Only Waterloo neighbourhoods count, so a database still holding Toronto's
  // never deletes every listing.
  if (waterloo > 0) {
    result.outsideCoverage = (
      await sql`
        DELETE FROM listings l
        WHERE l.address_point_id IS NULL -- an Address Point is in Waterloo by definition
          AND NOT EXISTS (SELECT 1 FROM neighbourhoods n
            WHERE n.id LIKE ${WATERLOO_ID_PREFIX + "%"} AND ST_Covers(n.geometry, l.location::geometry))
          -- A Waterloo address whose street-level point lands just over the line stays.
          AND NOT (l.address_text ~* '\\mwaterloo\\M' AND l.address_text !~* '\\m(kitchener|cambridge|woolwich|elmira|st\\.? jacobs|breslau)\\M'
            AND EXISTS (SELECT 1 FROM neighbourhoods n
              WHERE n.id LIKE ${WATERLOO_ID_PREFIX + "%"} AND ST_DWithin(n.geometry::geography, l.location, ${EDGE_M})))`
    ).count;
  }
  // A point inside Waterloo with an address elsewhere: the source placed it imprecisely.
  const unmatched = await sql<{ id: string; title: string; address_text: string | null }[]>`
    SELECT id, title, address_text FROM listings WHERE address_point_id IS NULL`;
  const elsewhere = unmatched
    .filter((r) => namesOtherCity(r.title, r.address_text))
    .map((r) => r.id);
  for (let i = 0; i < elsewhere.length; i += WRITE_BATCH) {
    result.otherCity += (
      await sql`DELETE FROM listings WHERE id IN ${sql(elsewhere.slice(i, i + WRITE_BATCH))}`
    ).count;
  }

  return result;
}
