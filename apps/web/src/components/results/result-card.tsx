"use client";

import { Bookmark, Building2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ListingPhoto } from "@/components/listing/listing-photo";
import { BAND_COLORS, scoreBand } from "@/components/map/map-data";
import { clearAmenityPin, showNearestAmenity } from "@/components/map/amenity-pin";
import { ACTIVE_COLOR } from "@/components/map/map-pins";
import { fetchPath } from "@/components/map/route-path";
import { t, type MessageKey } from "@/lib/format/messages";
import { formatCad, formatCount } from "@/lib/format/number";
import { selectIsShortlisted } from "@/lib/store/searchSlice";
import { useAppStore } from "@/lib/store/store";
import type { SearchIntent, SearchResultItem } from "@/lib/store/types";
import { priceSummary, travelSummaries, type TravelSummary } from "./card-data";

const r = (key: string, params?: Record<string, string | number>) =>
  t(`results.${key}` as MessageKey, params);
const decimal = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 1 });

/** The price verdict as coloured text, the way the reference row shows "Open 'til 6pm". */
const verdictStyles = {
  underpriced: "text-emerald-600 dark:text-[#3ddc97]",
  reasonable: "text-muted-foreground",
  overpriced: "text-amber-600 dark:text-amber-400",
} as const;

/** Every duration is labelled as a distance-based estimate. */
function travelText(summary: TravelSummary): string {
  if (summary.kind === "estimated") {
    return r(`travel.${summary.mode}`, {
      minutes: formatCount(summary.minutes),
      target: summary.target,
    });
  }
  return r("travel.missing", { target: summary.target });
}

/**
 * The routed minutes for a trip to a named place (#24), once OpenTripPlanner answers; null until
 * then, or when there's no router or no trip, and the row keeps its estimate.
 */
function useRoutedMinutes(
  listing: SearchResultItem["listing"],
  target: SearchIntent["travelTargets"][number] | undefined,
  trip: TravelSummary | undefined,
): number | null {
  const [routed, setRouted] = useState<{ key: string; minutes: number } | null>(null);
  const to = target?.kind === "place" ? target.resolved : undefined;
  const mode = trip?.kind === "estimated" ? trip.mode : null;
  const key = to && mode ? `${listing.id}|${to.lng},${to.lat}|${mode}` : null;
  useEffect(() => {
    if (!key || !to || !mode) return;
    let current = true;
    void fetchPath([listing.location.lng, listing.location.lat], [to.lng, to.lat], mode).then(
      (path) => {
        if (current && path) setRouted({ key, minutes: path.minutes });
      },
    );
    return () => {
      current = false;
    };
  }, [key, listing.location.lng, listing.location.lat, to, mode]);
  return routed && routed.key === key ? routed.minutes : null;
}

/** "2 bed · 1 bath", or whichever of them the listing states. */
function rooms(listing: SearchResultItem["listing"]): string[] {
  const parts: string[] = [];
  if (listing.bedrooms !== null) {
    parts.push(listing.bedrooms === 0 ? r("studio") : r("beds", { n: listing.bedrooms }));
  }
  if (listing.bathrooms !== null) parts.push(r("baths", { n: decimal.format(listing.bathrooms) }));
  return parts;
}

/**
 * One result as a compact row: a round photo, the title, rent and rooms with the price verdict,
 * the first trip to the renter's places, and a bookmark and match score on the right. The full
 * breakdown (facts, caveats, score parts, sources) is on the listing page.
 */
export function ResultCard({
  result,
  targets,
}: {
  result: SearchResultItem;
  targets: SearchIntent["travelTargets"];
}) {
  const { listing, valuation, matchScore } = result;
  const id = listing.id;
  const selected = useAppStore((s) => s.selectedListingId === id);
  const hovered = useAppStore((s) => s.hoveredListingId === id);
  const setSelected = useAppStore((s) => s.setSelectedListingId);
  const shortlisted = useAppStore(selectIsShortlisted(id));
  const setHovered = useAppStore((s) => s.setHoveredListingId);
  const toggleShortlist = useAppStore((s) => s.toggleShortlist);

  const price = priceSummary(valuation);
  const trip = travelSummaries(result, targets)[0];
  // An amenity trip ("Est. 2 min walk to groceries") pins that place on the map while hovered.
  const pinsPlace = trip?.kind === "estimated" && targets[0]?.kind === "amenity";
  const routedMinutes = useRoutedMinutes(listing, targets[0], trip);
  const score = Math.round(matchScore.total);
  const rent = `${formatCad(listing.monthlyRentCad)}${
    listing.rentIsPerRoom ? r("perRoom") : r("perMonth")
  }`;

  return (
    <article
      id={`listing-${id}`}
      onMouseEnter={() => setHovered(id)}
      onMouseLeave={() => setHovered(null)}
      onFocus={() => setHovered(id)}
      onBlur={() => setHovered(null)}
      aria-current={selected ? "true" : undefined}
      className={`relative flex items-center gap-3 rounded-2xl border px-3 py-3 transition-colors ${
        selected ? "bg-accent" : hovered ? "bg-accent/60 border-transparent" : "border-transparent"
      }`}
      style={selected ? { borderColor: ACTIVE_COLOR } : undefined}
    >
      <div className="bg-muted text-muted-foreground grid size-12 shrink-0 place-items-center overflow-hidden rounded-full">
        <ListingPhoto
          src={listing.imageUrl}
          className="size-full object-cover"
          fallback={<Building2 aria-hidden className="size-5" />}
        />
      </div>

      <div className="min-w-0 flex-1">
        <h3 className="truncate text-[0.9375rem] leading-tight font-semibold">
          {/* Stretched link: the whole row opens the listing; buttons sit above it. */}
          <Link
            href={`/listing/${id}`}
            onClick={(event) => {
              // Beside the map, a click shows the listing there (and again unselects it).
              // Phones, and new-tab clicks, open the page.
              if (!window.matchMedia("(min-width: 1024px)").matches) return;
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
              event.preventDefault();
              setSelected(selected ? null : id, "list");
            }}
            className="after:absolute after:inset-0 after:rounded-2xl focus-visible:underline focus-visible:outline-none"
          >
            {listing.title}
          </Link>
        </h3>
        <p className="figures text-muted-foreground mt-1 truncate text-xs">
          <span className="text-foreground font-medium">{rent}</span>
          {rooms(listing).map((part) => (
            <span key={part}> • {part}</span>
          ))}
          {price.label !== "unknown" && (
            <span className={`font-medium ${verdictStyles[price.label]}`}>
              {" "}
              • {r(`price.${price.label}`)}
            </span>
          )}
        </p>
        {trip && (
          <p
            // Above the row's stretched link, so it gets the hover; a click still selects the row.
            onMouseEnter={
              pinsPlace ? () => void showNearestAmenity(listing, targets[0]) : undefined
            }
            onMouseLeave={pinsPlace ? clearAmenityPin : undefined}
            onClick={
              pinsPlace
                ? () => {
                    if (window.matchMedia("(min-width: 1024px)").matches)
                      setSelected(selected ? null : id, "list");
                  }
                : undefined
            }
            className={`text-muted-foreground mt-0.5 max-w-full truncate text-xs ${trip.kind === "estimated" ? "figures" : ""} ${pinsPlace ? "relative z-10 w-fit cursor-pointer underline decoration-dotted underline-offset-2" : ""}`}
          >
            {routedMinutes !== null && trip.kind === "estimated"
              ? r(`travel.routed.${trip.mode}`, {
                  minutes: formatCount(routedMinutes),
                  target: trip.target,
                })
              : travelText(trip)}
          </p>
        )}
      </div>

      <div className="relative z-10 flex shrink-0 flex-col items-center gap-1.5">
        <button
          type="button"
          aria-pressed={shortlisted}
          aria-label={r(shortlisted ? "shortlistRemove" : "shortlistAdd", {
            title: listing.title,
          })}
          onClick={() => toggleShortlist(listing)}
          className="hover:bg-accent focus-visible:ring-ring/50 grid size-7 place-items-center rounded-full outline-none focus-visible:ring-3"
        >
          <Bookmark
            aria-hidden
            className={`size-4 ${shortlisted ? "fill-primary text-primary" : "text-muted-foreground"}`}
          />
        </button>
        <span
          role="img"
          aria-label={t("results.map.cardScore", { score })}
          title={t("results.map.cardScore", { score })}
          className="figures grid size-7 place-items-center rounded-full border-2 text-[0.625rem] font-semibold"
          style={{ borderColor: BAND_COLORS[scoreBand(matchScore.total)] }}
        >
          {score}
        </span>
      </div>
    </article>
  );
}
