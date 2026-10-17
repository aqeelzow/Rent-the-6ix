// Kijiji long-term rentals, City of Toronto. The search page embeds its results as Apollo
// state in __NEXT_DATA__ (RealEstateListing:<id> entries), so one index page gives full rows.
// Two categories: Apartments & Condos (c37), then Room Rentals & Roommates (c36), whose entries
// are StandardListing with no attributes: rooms, priced per room. Cursor: "5" = apartments page 5,
// "r:5" = rooms page 5.
import { htmlToText } from "../lib/text.ts";
import {
  emptyRawListing,
  toPatch,
  type RawListing,
  type SourceAdapter,
  type TriState,
} from "./types.ts";

const CATEGORIES = {
  apartments: { path: "b-apartments-condos", code: "c37l1700273" },
  rooms: { path: "b-room-rental-roommate", code: "c36l1700273" },
} as const;
type Category = keyof typeof CATEGORIES;

export function kijijiPageUrl(page: number, category: Category = "apartments"): string {
  const { path, code } = CATEGORIES[category];
  return `https://www.kijiji.ca/${path}/city-of-toronto/${page > 1 ? `page-${page}/` : ""}${code}`;
}

interface KijijiListing {
  __typename: string;
  id: string;
  title: string;
  description?: string | null;
  url: string;
  activationDate?: string | null;
  location?: {
    address?: string | null;
    coordinates?: { latitude: number; longitude: number } | null;
  } | null;
  price?: { __typename: string; amount?: number | null } | null;
  attributes?: { all?: { canonicalName: string; canonicalValues: string[] }[] } | null;
}

export function parseKijiji(
  html: string,
  category: Category = "apartments",
): { listings: RawListing[]; lastPage: number | null } {
  const match = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/,
  );
  if (!match) throw new Error("kijiji: __NEXT_DATA__ not found (page layout changed?)");
  const state: Record<string, KijijiListing> =
    JSON.parse(match[1]).props?.pageProps?.__APOLLO_STATE__ ?? {};

  const listings: RawListing[] = [];
  for (const entry of Object.values(state)) {
    const standard = entry?.__typename === "StandardListing";
    if (entry?.__typename !== "RealEstateListing" && !standard) continue;
    // A whole basement or studio posted under Room Rentals isn't a room.
    const room =
      standard &&
      !(
        !/\broom/i.test(entry.title) &&
        /\b(basement|apartment|studio|condo|suite|bachelor|house)\b/i.test(entry.title)
      );
    // NonAmountPrice = "please contact"; no rent, nothing to compare.
    const cents = entry.price?.__typename === "StandardAmountPrice" ? entry.price.amount : null;
    if (!cents) continue;

    const attrs = new Map(
      (entry.attributes?.all ?? []).map((a) => [a.canonicalName, a.canonicalValues[0]]),
    );
    const beds = num(attrs.get("numberbedrooms"));
    const baths = num(attrs.get("numberbathrooms"));
    const sqft = num(attrs.get("areainfeet"));
    const parkingSpots = num(attrs.get("numberparkingspots"));
    const available = attrs.get("dateavailable");
    const coords = entry.location?.coordinates;

    listings.push({
      ...emptyRawListing,
      source: "kijiji",
      sourceListingId: entry.id,
      sourceUrl: entry.url,
      title: entry.title,
      // Search pages carry a snippet; the listing's own page the full HTML description.
      description: entry.description ? htmlToText(entry.description) : null,
      monthlyRentCad: cents / 100,
      // "1.5" bedrooms is Kijiji's 1 + den.
      bedrooms: beds === null ? null : Math.floor(beds),
      den: beds !== null && beds % 1 !== 0,
      // Bathrooms are stored in tenths: "15" = 1.5.
      bathrooms: baths === null ? null : baths / 10,
      // Room Rentals entries have no attributes; the category is the unit type.
      unitType: room ? "room" : standard ? null : known(attrs.get("unittype")),
      rentIsPerRoom: room,
      sqft: sqft || null,
      airConditioning: flag(attrs.get("airconditioning")),
      furnished: flag(attrs.get("furnished")),
      petsAllowed: attrs.get("petsallowed") === "limited" ? true : flag(attrs.get("petsallowed")),
      parking: parkingSpots === null ? null : parkingSpots > 0,
      laundryInSuite: flag(attrs.get("laundryinunit")),
      utilitiesIncluded: allIncluded(attrs),
      availableFrom: available ? available.slice(0, 10) : null,
      leaseTerm: LEASE_TERMS[attrs.get("agreementtype") ?? ""] ?? null,
      address: entry.location?.address ?? null,
      postalCode:
        entry.location?.address?.match(/[A-Z]\d[A-Z] ?\d[A-Z]\d/i)?.[0].toUpperCase() ?? null,
      lat: coords?.latitude ?? null,
      lng: coords?.longitude ?? null,
      postedAt: entry.activationDate ?? null,
    });
  }

  const code = CATEGORIES[category].code;
  const pages = [...html.matchAll(new RegExp(`/page-(\\d+)/${code}`, "g"))].map((m) =>
    Number(m[1]),
  );
  return { listings, lastPage: pages.length ? Math.max(...pages) : null };
}

const LEASE_TERMS: Record<string, string> = {
  "one-year": "12 months",
  "month-to-month": "month-to-month",
};

function known(value: string | undefined): string | null {
  return value && value !== "Not Available" ? value : null;
}

function num(value: string | undefined): number | null {
  const v = known(value);
  return v === null || Number.isNaN(Number(v)) ? null : Number(v);
}

function flag(value: string | undefined): TriState {
  const v = known(value);
  return v === "1" ? true : v === "0" ? false : null;
}

/** Heat, water and hydro all included → true; any one explicitly excluded → false. */
function allIncluded(attrs: Map<string, string>): TriState {
  const parts = ["heat", "water", "hydro"].map((k) => flag(attrs.get(k)));
  if (parts.includes(false)) return false;
  return parts.every((p) => p === true) ? true : null;
}

export const kijiji: SourceAdapter = {
  id: "kijiji",
  displayName: "Kijiji",
  async fetchIndex(session, cursor) {
    const category: Category = cursor?.startsWith("r:") ? "rooms" : "apartments";
    const page = cursor ? Number(cursor.replace("r:", "")) : 1;
    const { html } = await session.visit(kijijiPageUrl(page, category));
    const { listings, lastPage } = parseKijiji(html, category);
    const hasNext = listings.length > 0 && lastPage !== null && page < lastPage;
    const prefix = category === "rooms" ? "r:" : "";
    if (hasNext) return { listings, nextCursor: `${prefix}${page + 1}` };
    // Apartments done: rooms next.
    return { listings, nextCursor: category === "apartments" ? "r:1" : null };
  },
  // The listing page has the same RealEstateListing entry with the full description and every
  // attribute. posterInfo (the poster's name and contact) is never read.
  async fetchDetail(session, listing) {
    const { html } = await session.visit(listing.sourceUrl);
    const full = parseKijiji(html).listings.find(
      (l) => l.sourceListingId === listing.sourceListingId,
    );
    return full ? toPatch(full) : {};
  },
};
