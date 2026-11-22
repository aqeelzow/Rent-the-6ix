// Building names in listing text (issue #30, RENT_K_DUBS_SPEC.md Additions 2). Student posts often
// name only the building ("Furnished room sublet at ICON 330"); this finds which catalogue building
// a title or excerpt names, so geocode can place the listing at that building's address.
//
// Conservative on purpose: a wrong building is worse than none.
// - `aliases` match case-insensitively as whole words; `strictAliases` ("ICON") case-sensitively.
// - "near ICON", "5 min walk to ICON", "across from ICON" describe a different home: skipped.
// - The listing's own point must be within MAX_DISTANCE_M of the building, so a post that names a
//   Waterloo building but sits elsewhere stays unmatched.
// - Text naming two different buildings ("Luxe 1 or Luxe 2") matches neither.
// - A street address in the text settles it: the building's own address ("Address: 330 Phillip
//   Street") names it, and another number on the same street ("Ivy Towns 3, 338 Albert St" when
//   Ivytowns is 253 Albert) rules it out.
import { distanceM } from "./dedupe.ts";

/** A named building must be this close to the listing's own point. */
export const MAX_DISTANCE_M = 1_000;

/** A civic address as house number and lower-case street name ("330", "phillip"). */
export interface CivicAddress {
  number: string;
  street: string;
  /** "n", "s", "e", "w", or null when not written. */
  direction: string | null;
}

export interface CatalogueBuilding {
  id: string;
  aliases: string[];
  strictAliases: string[];
  points: { lng: number; lat: number }[];
  addresses: CivicAddress[];
}

export interface BuildingMatch {
  buildingId: string;
  /** The words in the listing that named it. */
  evidence: string;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A space or hyphen in an alias matches either, or nothing: "rez-one", "rez one", "rezone". */
const pattern = (alias: string) => escape(alias).replace(/\\?[- ]/g, "[- ]?");
/** Words just before a name that mean the home is elsewhere ("near", "walk to", "across from"). */
const NEARBY =
  /\b(?:near(?:by)?|close to|closer to|walk(?:ing)?(?: distance)? (?:to|from)|mins? (?:to|from)|minutes? (?:to|from)|steps (?:to|from)|across (?:the street )?from|next to|beside|behind|opposite|by)\s*(?:the\s+)?$/i;

/** Same street, allowing for a direction one side leaves out ("King St" vs "King St N"). */
const sameStreet = (a: CivicAddress, b: CivicAddress) =>
  a.street === b.street && (!a.direction || !b.direction || a.direction === b.direction);

const nearby = (text: string, index: number) =>
  NEARBY.test(text.slice(Math.max(0, index - 40), index));

function mentions(text: string, alias: string, caseSensitive: boolean): string | null {
  const re = new RegExp(`(?<![\\w-])${pattern(alias)}(?![\\w-])`, caseSensitive ? "g" : "gi");
  for (const m of text.matchAll(re)) if (!nearby(text, m.index)) return m[0];
  return null;
}

const STREET_TYPES =
  "st|street|ave|avenue|rd|road|dr|drive|blvd|boulevard|cres|crescent|crt|ct|court|pl|place|way|ln|lane|trl|trail|gate|cir|circle|ter|terrace|pkwy|parkway";
const ADDRESS = new RegExp(
  `\\b(\\d{1,5})[a-z]?\\s+((?:[a-z'.]+\\s+){0,2}?[a-z'.]+)\\s+(?:${STREET_TYPES})\\b\\.?(?:\\s+(north|south|east|west|[nsew])\\b)?`,
  "gi",
);

/** Street addresses written in text ("Address: 330 Phillip Street", "17 Barrel Yards Blvd"). */
export function addressesIn(text: string): (CivicAddress & { index: number; text: string })[] {
  return [...text.matchAll(ADDRESS)].map((m) => ({
    number: m[1],
    street: m[2].toLowerCase().replace(/\.$/, ""),
    direction: m[3]?.[0].toLowerCase() ?? null,
    index: m.index,
    text: m[0],
  }));
}

/** The one catalogue building the text names within reach of `location`, or null. */
export function buildingNamed(
  text: string,
  location: { lng: number; lat: number },
  buildings: readonly CatalogueBuilding[],
): BuildingMatch | null {
  const found = new Map<string, string>();
  const written = addressesIn(text).filter((a) => !nearby(text, a.index));
  for (const b of buildings) {
    if (!b.points.some((p) => distanceM(p, location) <= MAX_DISTANCE_M)) continue;
    const onStreet = written.filter((w) => b.addresses.some((a) => sameStreet(a, w)));
    const own = onStreet.find((w) =>
      b.addresses.some((a) => a.number === w.number && sameStreet(a, w)),
    );
    // Another number on this building's street: the home is somewhere else on that street.
    if (onStreet.length && !own) continue;
    const hit =
      b.aliases.map((a) => mentions(text, a, false)).find(Boolean) ??
      b.strictAliases.map((a) => mentions(text, a, true)).find(Boolean) ??
      own?.text;
    if (hit) found.set(b.id, hit);
  }
  if (found.size !== 1) return null;
  const [[buildingId, evidence]] = found;
  return { buildingId, evidence };
}
