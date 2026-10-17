// torontorentals.com and rentals.ca run on the same platform (Rentals.ca network). The search
// page loads its results from /graphql, which we capture while the page loads; rentals.ca instead
// embeds the same results in the page (`App.store.search = { response: … }`) with a few fields
// renamed, which `findEmbeddedResults` maps to the same shape.
// One building has several floor plans; each floor plan becomes one RawListing.
// The building's contact (name, phone, email) and photos are never read.
import {
  emptyRawListing,
  type RawListing,
  type SourceAdapter,
  type SourceId,
  type TriState,
} from "./types.ts";

interface FloorPlan {
  beds?: number | null;
  baths?: number | null;
  rent?: number | null;
  size?: number | null;
  availability?: { date?: string | null; now?: boolean | null } | null;
  furnished?: string | null;
  externalId?: string | null;
  parkingSpots?: number | null;
}

interface RentalNode {
  id: string;
  name?: string | null;
  path: string;
  type?: string | null;
  /** [lng, lat] */
  location?: number[] | null;
  created?: string | null;
  modified?: string | null;
  address?: {
    street?: string | null;
    postalCode?: string | null;
    neighbourhood?: { name?: string } | null;
  } | null;
  building?: { yearBuilt?: number | null } | null;
  petOptions?: string[] | null;
  floorPlans?: FloorPlan[] | null;
}

interface RentalListingsPage {
  data?: {
    rentalListings?: {
      edges?: { node: RentalNode }[];
      pageInfo?: { hasNextPage?: boolean } | null;
    };
  };
}

/** Pick the results response (the one with floor plans) out of everything the page loaded. */
export function findResults(bodies: unknown[]): RentalListingsPage | null {
  for (const body of bodies) {
    const edges = (body as RentalListingsPage)?.data?.rentalListings?.edges;
    if (edges?.length && edges.some((e) => e.node?.floorPlans)) return body as RentalListingsPage;
  }
  return null;
}

/** rentals.ca's embedded node: the /graphql node with a few fields renamed. */
interface EmbeddedNode {
  id: string;
  path: string;
  rentalListingName?: string | null;
  rentalListingLocation?: number[] | null;
  listingType?: string | null;
  modified?: string | null;
  address?: { street?: string | null; postalCode?: string | null } | null;
  building?: { yearBuilt?: number | null } | null;
  petOptions?: string[] | null;
  floorPlans?:
    | {
        beds?: number | null;
        baths?: number | null;
        rent?: number | null;
        sqft?: number | null;
        den?: boolean | null;
        parkingSpots?: number | null;
      }[]
    | null;
}

/** The JSON object literal that follows `marker` in a script, or null. */
function objectAfter(html: string, marker: string): unknown {
  const at = html.indexOf(marker);
  if (at < 0) return null;
  const start = html.indexOf("{", at + marker.length);
  let depth = 0;
  let inString = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return JSON.parse(html.slice(start, i + 1));
  }
  return null;
}

/** rentals.ca: results embedded in the search page, mapped to the /graphql shape. */
export function findEmbeddedResults(html: string): RentalListingsPage | null {
  const store = html.indexOf("App.store.search");
  if (store < 0) return null;
  const response = objectAfter(html.slice(store), "response:") as {
    data?: { edges?: { node: EmbeddedNode }[]; pageInfo?: { hasNextPage?: boolean } };
  } | null;
  const edges = response?.data?.edges;
  if (!edges?.length) return null;
  return {
    data: {
      rentalListings: {
        pageInfo: response?.data?.pageInfo ?? null,
        edges: edges.map(({ node: n }) => ({
          node: {
            id: n.id,
            path: n.path,
            name: n.rentalListingName ?? null,
            // "residential:apartment:apartment" → "apartment"
            type: n.listingType?.split(":").pop() ?? null,
            location: n.rentalListingLocation ?? null,
            modified: n.modified ?? null,
            address: { street: n.address?.street, postalCode: n.address?.postalCode },
            building: { yearBuilt: n.building?.yearBuilt ?? null },
            petOptions: n.petOptions ?? null,
            floorPlans: (n.floorPlans ?? []).map((f) => ({
              // A den shows as half a bedroom, as on torontorentals ("1.5" = 1 + den).
              beds: f.beds === null || f.beds === undefined ? null : f.beds + (f.den ? 0.5 : 0),
              baths: f.baths,
              rent: f.rent,
              size: f.sqft,
              parkingSpots: f.parkingSpots,
              externalId: null,
            })),
          },
        })),
      },
    },
  };
}

export function parseRentalListings(
  source: SourceId,
  origin: string,
  page: RentalListingsPage,
): RawListing[] {
  const listings: RawListing[] = [];
  for (const { node } of page.data?.rentalListings?.edges ?? []) {
    const plans = node.floorPlans ?? [];
    plans.forEach((plan, i) => {
      if (!plan.rent) return;
      const beds = plan.beds ?? null;
      const bedrooms = beds === null ? null : Math.floor(beds);
      const street = node.address?.street?.trim() || null;
      listings.push({
        ...emptyRawListing,
        source,
        sourceListingId: plan.externalId ?? `${node.id}:${i}`,
        sourceUrl: `${origin}/${node.path}`,
        title: `${bedLabel(bedrooms)}${beds !== null && beds % 1 ? " + den" : ""} at ${node.name?.trim() || street || "Toronto"}`,
        monthlyRentCad: plan.rent,
        bedrooms,
        den: beds !== null && beds % 1 !== 0,
        bathrooms: plan.baths ?? null,
        unitType: node.type ?? null,
        sqft: plan.size || null,
        yearBuilt: node.building?.yearBuilt ?? null,
        furnished: plan.furnished === "yes" ? true : plan.furnished === "no" ? false : null,
        petsAllowed: pets(node.petOptions),
        // 0 spots is how the site shows "not listed", so only a positive count is a yes.
        parking: plan.parkingSpots ? true : null,
        availableFrom: plan.availability?.date ? plan.availability.date.slice(0, 10) : null,
        address: street
          ? `${street}, Toronto, ON${node.address?.postalCode ? ` ${node.address.postalCode}` : ""}`
          : null,
        postalCode: node.address?.postalCode ?? null,
        lng: node.location?.[0] ?? null,
        lat: node.location?.[1] ?? null,
        postedAt: node.modified ?? node.created ?? null,
      });
    });
  }
  return listings;
}

function bedLabel(bedrooms: number | null): string {
  if (bedrooms === null) return "Unit";
  return bedrooms === 0 ? "Studio" : `${bedrooms} bed`;
}

function pets(options: string[] | null | undefined): TriState {
  if (!options?.length) return null;
  if (options.includes("none")) return false;
  return true;
}

function rentalsNetworkAdapter(
  id: SourceId,
  displayName: string,
  origin: string,
  searchPath: string,
): SourceAdapter {
  return {
    id,
    displayName,
    async fetchIndex(session, cursor) {
      const page = cursor ? Number(cursor) : 1;
      const url = `${origin}${searchPath}${page > 1 ? `?p=${page}` : ""}`;
      const { json, html } = await session.visit(url, {
        captureJson: (u) => u.startsWith(`${origin}/graphql`),
        settleMs: 3000,
      });
      const results = findResults(json) ?? findEmbeddedResults(html);
      if (!results) throw new Error(`${id}: no results response on ${url} (page layout changed?)`);
      const listings = parseRentalListings(id, origin, results);
      const hasNext = results.data?.rentalListings?.pageInfo?.hasNextPage ?? false;
      return { listings, nextCursor: hasNext ? String(page + 1) : null };
    },
  };
}

export const torontoRentals = rentalsNetworkAdapter(
  "torontorentals",
  "TorontoRentals.com",
  "https://www.torontorentals.com",
  "/toronto",
);

// Same platform; rentals.ca embeds its results in the page instead of calling /graphql.
export const rentalsCa = rentalsNetworkAdapter(
  "rentals_ca",
  "Rentals.ca",
  "https://rentals.ca",
  "/toronto",
);
