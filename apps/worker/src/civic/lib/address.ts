// Address normalisation for pg_trgm matching (P1.11). Listings write addresses the way humans do
// ("123 Queen Street West", "Unit 4 - 123 Queen St W") while the City's repository is terse
// ("123 Queen St W"). Both sides go through this one function so the trigram index on
// `address_points.address_norm` is comparable, and C's geocoder must import it rather than
// roll its own: two different normalisers silently destroy recall.
//
// It is deliberately conservative — it never invents a street type, only abbreviates the
// standard ones, and it drops unit/suite tokens because the City's points are per building.

const SUFFIXES: Record<string, string> = {
  STREET: "ST",
  AVENUE: "AVE",
  ROAD: "RD",
  BOULEVARD: "BLVD",
  DRIVE: "DR",
  CRESCENT: "CRES",
  COURT: "CT",
  PLACE: "PL",
  TERRACE: "TER",
  TRAIL: "TRL",
  LANE: "LN",
  PARKWAY: "PKWY",
  SQUARE: "SQ",
  GARDENS: "GDNS",
  GARDEN: "GDN",
  HEIGHTS: "HTS",
  CIRCLE: "CIR",
  GROVE: "GRV",
  MEWS: "MEWS",
  QUAY: "QUAY",
  RIDGE: "RDG",
  VISTA: "VISTA",
  WOOD: "WOOD",
  GATE: "GATE",
  PATH: "PATH",
  ROW: "ROW",
  WAY: "WAY",
  HILL: "HILL",
};

const DIRECTIONS: Record<string, string> = {
  WEST: "W",
  EAST: "E",
  NORTH: "N",
  SOUTH: "S",
};

// "Unit 4", "Apt. 1203", "#5", "Suite 200" — the leading unit marker and its value.
const UNIT = /(?:^|\s)(?:UNIT|APT|APARTMENT|SUITE|STE|#)\s*[A-Z0-9-]+/g;

/** Uppercase, unit-free, abbreviation-normalised address for similarity matching. */
export function normalizeAddress(address: string): string {
  const cleaned = address
    .toUpperCase()
    .replace(/[.,]/g, " ")
    .replace(/\s*&\s*/g, " AND ")
    .replace(UNIT, " ")
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned
    .split(" ")
    .map((token) => SUFFIXES[token] ?? DIRECTIONS[token] ?? token)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
