// The nearest place behind a result's trip line ("Est. 2 min walk to groceries"): hovering the line
// pins that grocery store (or park, pharmacy, stop…) on the map. The place comes from the listing's
// nearby lookup (/api/listings/[id]/nearby), the same nearest-first list the listing page shows,
// fetched once per listing and kept for the visit.
import { create } from "zustand";
import { fetchNearby } from "@/lib/store/actions";
import type { SearchIntent } from "@/lib/store/types";

type Target = SearchIntent["travelTargets"][number];

export interface AmenityPin {
  listingId: string;
  name: string;
  distanceM: number;
  from: { lng: number; lat: number };
  location: { lng: number; lat: number };
}

export const useAmenityPin = create<{ pin: AmenityPin | null }>(() => ({ pin: null }));

const nearby = new Map<string, ReturnType<typeof fetchNearby>>();

/** Which listing the pointer is on now, so a slow lookup can't pin after it has left. */
let pointedAt: string | null = null;

/** Pin the nearest place of `target`'s kind to the listing. Only amenity targets have one. */
export async function showNearestAmenity(
  listing: { id: string; location: { lng: number; lat: number } },
  target: Target | undefined,
): Promise<void> {
  pointedAt = listing.id;
  if (target?.kind !== "amenity" || !target.category) return;
  let lookup = nearby.get(listing.id);
  if (!lookup) {
    lookup = fetchNearby(listing.id);
    nearby.set(listing.id, lookup);
  }
  const result = await lookup;
  if (pointedAt !== listing.id) return;
  if (!result.ok) {
    nearby.delete(listing.id);
    return;
  }
  const { nearby: places } = result;
  const place =
    target.category === "rapid_transit"
      ? places.nearestRapid
      : places.categories.find((group) => group.category === target.category)?.places[0];
  if (!place) return;
  useAmenityPin.setState({
    pin: {
      listingId: listing.id,
      name: place.name,
      distanceM: place.distanceM,
      from: listing.location,
      location: place.location,
    },
  });
}

export function clearAmenityPin(): void {
  pointedAt = null;
  useAmenityPin.setState({ pin: null });
}
