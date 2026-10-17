// Zillow Toronto rentals. Results are embedded in __NEXT_DATA__ under
// searchPageState.cat1.searchResults.listResults.
// Zillow answers plain Playwright with a PerimeterX captcha (403); CloakBrowser gets through and
// the parser was checked against a live page on 2026-10-16 (SOURCES.md).
import { emptyRawListing, type RawListing, type SourceAdapter } from "./types.ts";

const ORIGIN = "https://www.zillow.com";

interface ZillowResult {
  zpid?: string | number;
  detailUrl?: string;
  buildingName?: string | null;
  address?: string | null;
  addressZipcode?: string | null;
  unformattedPrice?: number | null;
  beds?: number | null;
  baths?: number | null;
  area?: number | null;
  latLong?: { latitude?: number; longitude?: number } | null;
  units?: { price?: string; beds?: string }[] | null;
}

export function parseZillow(html: string): { listings: RawListing[]; totalPages: number | null } {
  const match = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/,
  );
  if (!match) throw new Error("zillow: __NEXT_DATA__ not found (page layout changed?)");
  const state = JSON.parse(match[1]).props?.pageProps?.searchPageState;
  const results: ZillowResult[] = state?.cat1?.searchResults?.listResults ?? [];

  const listings: RawListing[] = [];
  for (const r of results) {
    if (!r.zpid || !r.detailUrl) continue;
    const base = {
      ...emptyRawListing,
      source: "zillow" as const,
      sourceUrl: r.detailUrl.startsWith("http") ? r.detailUrl : `${ORIGIN}${r.detailUrl}`,
      address: r.address ?? null,
      postalCode: r.addressZipcode ?? null,
      lat: r.latLong?.latitude ?? null,
      lng: r.latLong?.longitude ?? null,
    };
    if (r.units?.length) {
      // A building card: one row per unit type, priced "from".
      r.units.forEach((unit, i) => {
        const rent = money(unit.price);
        const beds = unit.beds === undefined ? null : Number(unit.beds);
        if (!rent) return;
        listings.push({
          ...base,
          sourceListingId: `${r.zpid}:${i}`,
          title: `${beds === 0 ? "Studio" : `${beds} bed`} at ${r.buildingName ?? r.address ?? "Toronto"}`,
          monthlyRentCad: rent,
          bedrooms: Number.isNaN(beds) ? null : beds,
        });
      });
    } else if (r.unformattedPrice) {
      listings.push({
        ...base,
        sourceListingId: String(r.zpid),
        title: r.address ?? "Toronto rental",
        monthlyRentCad: r.unformattedPrice,
        bedrooms: r.beds ?? null,
        bathrooms: r.baths ?? null,
        sqft: r.area || null,
      });
    }
  }
  return { listings, totalPages: state?.cat1?.searchList?.totalPages ?? null };
}

function money(text: string | undefined): number | null {
  const digits = text?.replace(/[^\d.]/g, "");
  return digits ? Number(digits) : null;
}

export const zillow: SourceAdapter = {
  id: "zillow",
  displayName: "Zillow",
  async fetchIndex(session, cursor) {
    const page = cursor ? Number(cursor) : 1;
    const { html } = await session.visit(
      `${ORIGIN}/toronto-on/rentals/${page > 1 ? `${page}_p/` : ""}`,
    );
    const { listings, totalPages } = parseZillow(html);
    const hasNext = listings.length > 0 && totalPages !== null && page < totalPages;
    return { listings, nextCursor: hasNext ? String(page + 1) : null };
  },
};
