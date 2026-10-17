import type { AreaFilter, Listing, TravelTarget } from "../schemas/index";
import { distanceM } from "./travel";

/**
 * "How far is this from the area I care about?" (owner D).
 *
 * The search intent already says which place matters — the renter's own resolved travel target,
 * or the point behind a "near me"-style area filter — so no extra question is needed and no
 * geocoding happens here. The figure is straight-line distance and is labelled as such wherever
 * it is shown: it is a comparison between listings, not a trip length (SPEC 7.4).
 */

export type PreferredReference = {
  /** The renter's own words when they named a place; null for an unnamed radius filter. */
  label: string | null;
  point: { lat: number; lng: number };
  kind: "place" | "area";
};

export type PreferredAreaInput = {
  areas: readonly AreaFilter[];
  travelTargets: readonly TravelTarget[];
};

/**
 * The reference point, in order of how specifically the renter named it: a place target they gave
 * coordinates for, then a radius area. Neighbourhood and ward filters carry no point here — the
 * listing's own `neighbourhoodId` already answers "is it in there", and inventing a centroid
 * would invent a distance.
 */
export function preferredReference(intent: PreferredAreaInput): PreferredReference | null {
  const place = intent.travelTargets.find(
    (target) =>
      target.kind === "place" &&
      target.resolved !== undefined &&
      Number.isFinite(target.resolved.lat) &&
      Number.isFinite(target.resolved.lng),
  );
  if (place?.resolved) {
    return {
      // The renter's own wording, not the resolver's — it says "UofT St. George", where the
      // resolver's label adds "campus representative point", which means nothing to a reader.
      label: place.label,
      point: { lat: place.resolved.lat, lng: place.resolved.lng },
      kind: "place",
    };
  }
  const near = intent.areas.find((area) => area.kind === "near");
  if (near && near.kind === "near") {
    return { label: null, point: { lat: near.point.lat, lng: near.point.lng }, kind: "area" };
  }
  return null;
}

/** Straight-line metres from the listing to the reference, or null without one. */
export function distanceToPreferredArea(
  listing: Pick<Listing, "location">,
  reference: PreferredReference | null,
): number | null {
  if (!reference) return null;
  const metres = distanceM(listing.location, reference.point);
  return Number.isFinite(metres) ? Math.round(metres) : null;
}
