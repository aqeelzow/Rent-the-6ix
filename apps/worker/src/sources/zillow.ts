// Zillow Toronto rentals. Results are embedded in __NEXT_DATA__ under
// searchPageState.cat1.searchResults.listResults.
// Zillow answers plain Playwright with a PerimeterX captcha (403); CloakBrowser gets through and
// the parser was checked against a live page on 2026-10-16 (SOURCES.md).
import { htmlToText } from "../lib/text.ts";
import {
  emptyRawListing,
  httpsUrl,
  type DetailPatch,
  type RawListing,
  type SourceAdapter,
  type TriState,
} from "./types.ts";

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
  /** The card's cover photo. */
  imgSrc?: string | null;
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
      imageUrl: zillowPhoto(httpsUrl(r.imgSrc)),
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

/**
 * Zillow names each photo size with a suffix; search cards use `-p_e` (about 600 px wide).
 * `-cc_ft_960` is the same photo at 960 px (checked 2026-10-17).
 */
export function zillowPhoto(url: string | null): string | null {
  return url?.replace(/-[a-z0-9_]+\.(jpg|webp)$/, "-cc_ft_960.$1") ?? null;
}

function money(text: string | undefined): number | null {
  const digits = text?.replace(/[^\d.]/g, "");
  return digits ? Number(digits) : null;
}

// --- Detail pages ------------------------------------------------------------------------
// Unit pages (/homedetails/) keep the unit in pageProps.componentProps.gdpClientCache (a JSON
// string); building pages (/apartments/, /b/) keep it in initialReduxState.gdp.building. /b/ pages
// usually carry nothing beyond the unit list, which is fine: an empty patch changes nothing.

interface ZillowUnitFacts {
  laundryFeatures?: string[] | null;
  hasPetsAllowed?: boolean | null;
  parkingCapacity?: number | null;
  cooling?: string[] | null;
  furnished?: boolean | null;
  livingArea?: string | null;
  yearBuilt?: number | null;
  leaseTerm?: string | null;
  availabilityDate?: number | null;
}

interface ZillowBuilding {
  description?: string | null;
  structuredAmenities?: Record<
    string,
    { amenityGroups?: { title?: string; amenities?: string[] }[] }
  > | null;
  amenitySummary?: { buildingDetails?: string[] | null; laundry?: string[] | null } | null;
  buildingAttributes?: { hasSharedLaundry?: boolean | null } | null;
  detailedPetPolicy?: { petPolicies?: { allowed?: boolean | null }[] | null } | null;
}

export function parseZillowDetail(html: string): DetailPatch {
  const match = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/,
  );
  if (!match) return {};
  const props = JSON.parse(match[1]).props?.pageProps?.componentProps;
  if (typeof props?.gdpClientCache === "string") {
    const cache: Record<
      string,
      { property?: { description?: string; resoFacts?: ZillowUnitFacts } }
    > = JSON.parse(props.gdpClientCache);
    const property = Object.values(cache).find((v) => v?.property)?.property;
    if (property) return unitPatch(property.description ?? null, property.resoFacts ?? {});
  }
  const building: ZillowBuilding | undefined = props?.initialReduxState?.gdp?.building;
  return building ? buildingPatch(building) : {};
}

function unitPatch(description: string | null, facts: ZillowUnitFacts): DetailPatch {
  const laundry = (facts.laundryFeatures ?? []).join(" ");
  const cooling = (facts.cooling ?? []).join(" ");
  const sqft = Number(facts.livingArea?.match(/[\d,]+/)?.[0].replace(",", ""));
  return {
    description: description ? htmlToText(description) : null,
    laundryInSuite: /in unit|in suite|washer/i.test(laundry)
      ? true
      : /shared|common|in building|coin/i.test(laundry)
        ? false
        : null,
    petsAllowed: facts.hasPetsAllowed ?? null,
    parking: facts.parkingCapacity ? true : null,
    airConditioning: /central/i.test(cooling) ? "central" : cooling ? true : null,
    // Zillow fills `furnished: false` by default, so only a yes is information.
    furnished: facts.furnished ? true : null,
    sqft: sqft || null,
    yearBuilt: facts.yearBuilt ?? null,
    leaseTerm: zillowLease(facts.leaseTerm),
    availableFrom: facts.availabilityDate
      ? new Date(facts.availabilityDate).toISOString().slice(0, 10)
      : null,
  };
}

function buildingPatch(b: ZillowBuilding): DetailPatch {
  const amenities = Object.values(b.structuredAmenities ?? {})
    .flatMap((section) => section?.amenityGroups ?? [])
    .flatMap((group) => [group.title ?? "", ...(group.amenities ?? [])])
    .concat(b.amenitySummary?.laundry ?? [])
    .join(" | ");
  const pets = (b.detailedPetPolicy?.petPolicies ?? []).map((p) => p.allowed);
  const built = (b.amenitySummary?.buildingDetails ?? []).join(" ").match(/built in (\d{4})/i);
  let petsAllowed: TriState = null;
  if (pets.includes(true)) petsAllowed = true;
  else if (pets.length && pets.every((p) => p === false)) petsAllowed = false;
  return {
    description: b.description ? htmlToText(b.description) : null,
    airConditioning: /central air/i.test(amenities)
      ? "central"
      : /air condition/i.test(amenities)
        ? true
        : null,
    laundryInSuite: /laundry: in unit|washer\/dryer|in-unit (washer|dryer)/i.test(amenities)
      ? true
      : b.buildingAttributes?.hasSharedLaundry
        ? false
        : null,
    petsAllowed,
    yearBuilt: built ? Number(built[1]) : null,
  };
}

function zillowLease(term: string | null | undefined): string | null {
  if (!term) return null;
  if (/month[- ]to[- ]month/i.test(term)) return "month-to-month";
  const years = term.match(/(\d+)\s*year/i);
  if (years) return `${Number(years[1]) * 12} months`;
  const months = term.match(/(\d+)\s*month/i);
  return months ? `${Number(months[1])} months` : null;
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
  async fetchDetail(session, listing) {
    const { html } = await session.visit(listing.sourceUrl);
    return parseZillowDetail(html);
  },
};
