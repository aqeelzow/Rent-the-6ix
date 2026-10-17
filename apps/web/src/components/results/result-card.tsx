"use client";

import { Bookmark, Building2, CircleHelp, ShieldQuestion } from "lucide-react";
import Link from "next/link";
import { modeIcons } from "@/components/mode-icons";
import { formatDaysAgo } from "@/lib/format/date";
import { t, type MessageKey } from "@/lib/format/messages";
import { formatCad, formatCount } from "@/lib/format/number";
import { selectIsShortlisted } from "@/lib/store/searchSlice";
import { useAppStore } from "@/lib/store/store";
import type { SearchIntent, SearchResultItem } from "@/lib/store/types";
import { daysSince, topCaveat, travelSummaries, yearSpan, type TravelSummary } from "./card-data";
import { PriceBadge } from "./price-badge";
import { ScoreBar } from "./score-bar";

const r = (key: string, params?: Record<string, string | number>) =>
  t(`results.${key}` as MessageKey, params);
const decimal = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 1 });

const caveatStyles = {
  info: "bg-caveat-info text-caveat-info-foreground",
  warning: "bg-caveat-warning text-caveat-warning-foreground",
  high: "bg-caveat-high text-caveat-high-foreground",
} as const;

/** Honest travel labels (SPEC 7.4): minutes only when routed; straight-line is only km. */
function travelText(summary: TravelSummary): string {
  if (summary.kind === "routed") {
    return r(`travel.${summary.mode}`, {
      minutes: formatCount(summary.minutes),
      target: summary.target,
    });
  }
  if (summary.kind === "straight_line") {
    return r("travel.straightLine", {
      km: decimal.format(summary.distanceM / 1000),
      target: summary.target,
    });
  }
  return r("travel.missing", { target: summary.target });
}

function homeFacts(listing: SearchResultItem["listing"]): string[] {
  const facts: string[] = [];
  if (listing.bedrooms !== null) {
    facts.push(listing.bedrooms === 0 ? r("studio") : r("beds", { n: listing.bedrooms }));
  }
  if (listing.bathrooms !== null) facts.push(r("baths", { n: decimal.format(listing.bathrooms) }));
  if (listing.sqft !== null) facts.push(r("sqft", { n: formatCount(listing.sqft) }));
  if (listing.yearBuilt !== null) facts.push(r("built", { year: listing.yearBuilt }));
  if (listing.airConditioning === "central") facts.push(r("acCentral"));
  else if (listing.airConditioning === "yes") facts.push(r("acYes"));
  return facts;
}

export function ResultCard({
  result,
  targets,
  safetyOn,
  now,
}: {
  result: SearchResultItem;
  targets: SearchIntent["travelTargets"];
  safetyOn: boolean;
  now: number;
}) {
  const { listing, valuation, safety, matchScore } = result;
  const id = listing.id;
  const highlighted = useAppStore((s) => s.hoveredListingId === id || s.selectedListingId === id);
  const shortlisted = useAppStore(selectIsShortlisted(id));
  const setHovered = useAppStore((s) => s.setHoveredListingId);
  const toggleShortlist = useAppStore((s) => s.toggleShortlist);

  const caveat = topCaveat(matchScore.caveats);
  const travel = travelSummaries(result, targets);
  const days = daysSince(listing.lastSeenAt, now);
  const facts = homeFacts(listing);

  return (
    <article
      id={`listing-${id}`}
      onMouseEnter={() => setHovered(id)}
      onMouseLeave={() => setHovered(null)}
      onFocus={() => setHovered(id)}
      onBlur={() => setHovered(null)}
      className={`bg-card relative flex flex-col gap-3 rounded-xl border p-4 transition-shadow hover:shadow-md ${highlighted ? "ring-primary/60 ring-2" : ""}`}
    >
      <div className="flex gap-3">
        <div className="bg-muted text-muted-foreground grid size-16 shrink-0 place-items-center overflow-hidden rounded-lg">
          {listing.imageUrl ? (
            // Hot-linked thumbnail from the source, only when its terms allow (SPEC 8.4).
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={listing.imageUrl}
              alt=""
              referrerPolicy="no-referrer"
              className="size-full object-cover"
            />
          ) : (
            <Building2 aria-hidden className="size-6" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="figures text-lg leading-tight font-semibold">
              {formatCad(listing.monthlyRentCad)}
              <span className="text-muted-foreground text-sm font-normal">
                {listing.rentIsPerRoom ? r("perRoom") : r("perMonth")}
              </span>
            </p>
            <button
              type="button"
              aria-pressed={shortlisted}
              aria-label={r(shortlisted ? "shortlistRemove" : "shortlistAdd", {
                title: listing.title,
              })}
              onClick={() => toggleShortlist(id)}
              className="hover:bg-accent focus-visible:ring-ring/50 relative z-10 -mt-1 -mr-1 grid size-9 shrink-0 place-items-center rounded-md outline-none focus-visible:ring-3"
            >
              <Bookmark
                aria-hidden
                className={`size-5 ${shortlisted ? "fill-primary text-primary" : "text-muted-foreground"}`}
              />
            </button>
          </div>
          <h3 className="truncate text-sm font-medium">
            {/* Stretched link: the whole card opens the listing; buttons sit above it. */}
            <Link
              href={`/listing/${id}`}
              className="after:absolute after:inset-0 after:rounded-xl hover:underline focus-visible:underline focus-visible:outline-none"
            >
              {listing.title}
            </Link>
          </h3>
          {facts.length > 0 && (
            <p className="text-muted-foreground figures text-sm">{facts.join(" · ")}</p>
          )}
        </div>
      </div>

      <div className="flex items-start justify-between gap-4">
        <PriceBadge valuation={valuation} />
        <ScoreBar matchScore={matchScore} className="w-36 pt-0.5" />
      </div>

      {travel.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm">
          {travel.map((summary) => {
            const Icon = modeIcons[summary.mode];
            return (
              <li key={summary.target} className="flex items-start gap-2">
                <Icon aria-hidden className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                <span className={summary.kind === "routed" ? "figures" : "text-muted-foreground"}>
                  {travelText(summary)}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {safetyOn && (
        <p className="text-muted-foreground figures flex items-start gap-2 text-sm">
          <ShieldQuestion aria-hidden className="mt-0.5 size-4 shrink-0" />
          {safety && safety.relativeRate !== null
            ? r("safety", {
                rate: decimal.format(safety.relativeRate),
                years: yearSpan(safety.years),
              })
            : r("safetyNoData")}
        </p>
      )}

      {(caveat || matchScore.hardFilterNotes.length > 0) && (
        <div className="flex flex-col items-start gap-1.5">
          {caveat && (
            <span
              className={`rounded-md px-2 py-0.5 text-xs font-medium ${caveatStyles[caveat.severity]}`}
            >
              {caveat.title}
            </span>
          )}
          {matchScore.hardFilterNotes.length > 0 && (
            <p className="text-caveat-warning-foreground flex items-start gap-1.5 text-xs">
              <CircleHelp aria-hidden className="mt-px size-3.5 shrink-0" />
              {matchScore.hardFilterNotes.join(" · ")}
            </p>
          )}
        </div>
      )}

      <p className="text-muted-foreground text-xs">
        {r(`sources.${listing.source}`)} · {r("seen", { when: formatDaysAgo(days) })}
        {listing.dataStatus !== "live" && <> · {r(`dataStatus.${listing.dataStatus}`)}</>}
      </p>
    </article>
  );
}
