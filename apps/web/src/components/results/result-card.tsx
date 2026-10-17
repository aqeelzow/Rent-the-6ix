"use client";

import {
  Bath,
  BedDouble,
  Bookmark,
  Building2,
  CalendarDays,
  CircleHelp,
  Ruler,
  ShieldQuestion,
  Snowflake,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { modeIcons } from "@/components/mode-icons";
import { formatDaysAgo } from "@/lib/format/date";
import { t, type MessageKey } from "@/lib/format/messages";
import { formatCad, formatCount } from "@/lib/format/number";
import { selectIsShortlisted } from "@/lib/store/searchSlice";
import { useAppStore } from "@/lib/store/store";
import type { SearchIntent, SearchResultItem } from "@/lib/store/types";
import {
  acFact,
  daysSince,
  plainHardFilterNote,
  topCaveat,
  travelSummaries,
  yearSpan,
  type TravelSummary,
} from "./card-data";
import { TravelFacts } from "./travel-facts";
import { SafetyInfoButton } from "@/components/safety/safety-info";
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

type HomeFact = { key: string; icon: LucideIcon; text: string };

function homeFacts(listing: SearchResultItem["listing"], acInSearch: boolean): HomeFact[] {
  const facts: HomeFact[] = [];
  if (listing.bedrooms !== null) {
    facts.push({
      key: "beds",
      icon: BedDouble,
      text: listing.bedrooms === 0 ? r("studio") : r("beds", { n: listing.bedrooms }),
    });
  }
  if (listing.bathrooms !== null) {
    facts.push({
      key: "baths",
      icon: Bath,
      text: r("baths", { n: decimal.format(listing.bathrooms) }),
    });
  }
  if (listing.sqft !== null) {
    facts.push({ key: "sqft", icon: Ruler, text: r("sqft", { n: formatCount(listing.sqft) }) });
  }
  if (listing.yearBuilt !== null) {
    facts.push({ key: "built", icon: CalendarDays, text: r("built", { year: listing.yearBuilt }) });
  }
  const ac = acFact(listing.airConditioning, acInSearch);
  const acText =
    ac === "central"
      ? r("acCentral")
      : ac === "yes"
        ? r("acYes")
        : ac === "not_stated"
          ? r("acNotStated")
          : null;
  if (acText) facts.push({ key: "ac", icon: Snowflake, text: acText });
  return facts;
}

export function ResultCard({
  result,
  targets,
  areas = [],
  safetyOn,
  acInSearch,
  now,
}: {
  result: SearchResultItem;
  targets: SearchIntent["travelTargets"];
  /** Area filters, so a "within X km" search still has a point to measure distance from. */
  areas?: SearchIntent["areas"];
  safetyOn: boolean;
  /** The renter asked for air conditioning, as a must-have or a preference. */
  acInSearch: boolean;
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
  const facts = homeFacts(listing, acInSearch);
  const unconfirmed = matchScore.hardFilterNotes.map(plainHardFilterNote);

  return (
    <article
      id={`listing-${id}`}
      onMouseEnter={() => setHovered(id)}
      onMouseLeave={() => setHovered(null)}
      onFocus={() => setHovered(id)}
      onBlur={() => setHovered(null)}
      className={`bg-card relative flex flex-col rounded-3xl border p-1.5 shadow-sm transition-shadow hover:shadow-md ${highlighted ? "ring-primary/60 ring-2" : ""}`}
    >
      {/* One calm tint for every card; the price pill carries the label's colour. */}
      <div className="bg-accent text-accent-foreground flex flex-col gap-4 rounded-[1.25rem] p-5">
        <div className="flex gap-4">
          <div className="flex min-w-0 flex-1 flex-col items-start gap-2.5">
            <PriceBadge valuation={valuation} inline />
            <h3 className="line-clamp-2 text-lg leading-snug font-semibold text-balance">
              {/* Stretched link: the whole card opens the listing; buttons sit above it. */}
              <Link
                href={`/listing/${id}`}
                className="after:absolute after:inset-0 after:rounded-3xl hover:underline focus-visible:underline focus-visible:outline-none"
              >
                {listing.title}
              </Link>
            </h3>
            {listing.addressText && listing.addressText !== listing.title && (
              <p className="-mt-1 line-clamp-1 text-sm opacity-75">{listing.addressText}</p>
            )}
            {facts.length > 0 && (
              <ul className="figures flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                {facts.map((fact) => (
                  <li key={fact.key} className="flex items-center gap-1.5">
                    <fact.icon aria-hidden className="size-4 opacity-70" />
                    {fact.text}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="grid size-24 shrink-0 place-items-center overflow-hidden rounded-2xl bg-black/[0.06] shadow-md sm:size-28 dark:bg-white/10">
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
              <Building2 aria-hidden className="size-8 opacity-50" />
            )}
          </div>
        </div>

        {(travel.length > 0 || safetyOn || caveat || unconfirmed.length > 0) && (
          <div className="flex flex-col gap-1.5 text-sm">
            {travel.length > 0 && (
              <ul className="flex flex-col gap-1">
                {travel.map((summary) => {
                  const Icon = modeIcons[summary.mode];
                  return (
                    <li key={summary.target} className="flex items-start gap-2">
                      <Icon aria-hidden className="mt-0.5 size-4 shrink-0 opacity-70" />
                      <span className={summary.kind === "routed" ? "figures" : "opacity-80"}>
                        {travelText(summary)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}

            {/* Distance from the place the renter named, and what the trips emit (owner D). */}
            <TravelFacts result={result} targets={targets} areas={areas} />

            {safetyOn && (
              <p className="figures flex items-start gap-2 opacity-80">
                <ShieldQuestion aria-hidden className="mt-0.5 size-4 shrink-0" />
                <span>
                  {safety && safety.relativeRate !== null
                    ? r("safety", {
                        rate: decimal.format(safety.relativeRate),
                        years: yearSpan(safety.years),
                      })
                    : r("safetyNoData")}{" "}
                  <SafetyInfoButton caveats={safety?.caveats} className="text-xs" />
                </span>
              </p>
            )}

            {(caveat || unconfirmed.length > 0) && (
              <div className="flex flex-col items-start gap-1.5 pt-1">
                {caveat && (
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${caveatStyles[caveat.severity]}`}
                  >
                    {caveat.title}
                  </span>
                )}
                {unconfirmed.length > 0 && (
                  <p className="flex items-start gap-1.5 text-xs">
                    <CircleHelp aria-hidden className="mt-px size-3.5 shrink-0" />
                    {unconfirmed.join(" · ")}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        <ScoreBar matchScore={matchScore} orientation="horizontal" />
      </div>

      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="figures text-lg leading-tight font-semibold">
            {formatCad(listing.monthlyRentCad)}
            <span className="text-muted-foreground text-sm font-normal">
              {listing.rentIsPerRoom ? r("perRoom") : r("perMonth")}
            </span>
          </p>
          <p className="text-muted-foreground truncate text-xs">
            {r(`sources.${listing.source}`)} · {r("seen", { when: formatDaysAgo(days) })}
            {listing.dataStatus !== "live" && <> · {r(`dataStatus.${listing.dataStatus}`)}</>}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            aria-pressed={shortlisted}
            aria-label={r(shortlisted ? "shortlistRemove" : "shortlistAdd", {
              title: listing.title,
            })}
            onClick={() => toggleShortlist(listing)}
            className="hover:bg-accent focus-visible:ring-ring/50 relative z-10 grid size-10 place-items-center rounded-full border outline-none focus-visible:ring-3"
          >
            <Bookmark
              aria-hidden
              className={`size-5 ${shortlisted ? "fill-primary text-primary" : "text-muted-foreground"}`}
            />
          </button>
          {/* Looks like a button; the card's stretched title link does the opening. */}
          <span
            aria-hidden
            className="bg-foreground text-background rounded-full px-5 py-2.5 text-sm font-semibold"
          >
            {r("view")}
          </span>
        </div>
      </div>
    </article>
  );
}
