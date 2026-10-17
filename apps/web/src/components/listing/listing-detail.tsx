"use client";

import { AlertCircle, ArrowLeft, Bookmark } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { daysSince } from "@/components/results/card-data";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, formatDaysAgo } from "@/lib/format/date";
import { t, type MessageKey } from "@/lib/format/messages";
import { formatCad, formatCount } from "@/lib/format/number";
import { selectIsShortlisted } from "@/lib/store/searchSlice";
import { useAppStore } from "@/lib/store/store";
import type { DetailResponse, SearchIntent, SearchResultItem } from "@/lib/store/types";
import { PriceBadge } from "@/components/results/price-badge";
import { priceSummary } from "@/components/results/card-data";
import {
  AreaCard,
  NotYetAvailable,
  GettingAround,
  RentCheck,
  SafetySection,
  SourceButton,
  TheHome,
  ThingsToCheck,
  WhyItRanks,
} from "./detail-sections";
import { modeIcons } from "@/components/mode-icons";
import { modeTimeText, RangeBar, ScoreGauge } from "./detail-charts";
import { scoreBreakdown, travelTable } from "./detail-data";
import { useListingDetail } from "./use-listing-detail";

const l = (key: string, params?: Record<string, string | number>) =>
  t(`listing.${key}` as MessageKey, params);
const decimal = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 1 });

/** The listing detail page (SPEC 11.3). Renders from search at once, then adds B's detail extras. */
export function ListingDetail({ id }: { id: string }) {
  const intent = useAppStore((s) => s.intent);
  const { data, extras, loading, error, retry } = useListingDetail(id);
  // "Seen N days ago" is measured from when the page opened.
  const [now] = useState(() => Date.now());

  const back = intent?.rawPrompt ? (
    <Link
      href={`/search?q=${encodeURIComponent(intent.rawPrompt)}`}
      className="text-primary inline-flex items-center gap-1 text-sm font-medium underline-offset-4 hover:underline"
    >
      <ArrowLeft aria-hidden className="size-4" />
      {l("back")}
    </Link>
  ) : (
    <Link
      href="/"
      className="text-primary inline-flex items-center gap-1 text-sm font-medium underline-offset-4 hover:underline"
    >
      <ArrowLeft aria-hidden className="size-4" />
      {l("newSearch")}
    </Link>
  );

  if (!data) {
    return (
      <div className="mx-auto flex w-full max-w-[96rem] flex-col gap-4 px-4 py-6 lg:px-8">
        {back}
        {loading ? (
          <div aria-live="polite" className="flex flex-col gap-4">
            <span className="sr-only">{l("loading")}</span>
            <Skeleton className="h-32 w-full rounded-xl" />
            <Skeleton className="h-64 w-full rounded-xl" />
          </div>
        ) : (
          <div
            role="alert"
            className="bg-caveat-high text-caveat-high-foreground flex flex-col items-start gap-3 rounded-xl p-4"
          >
            <p className="flex items-start gap-2">
              <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
              {error?.code === "listing_not_found" ? l("notFound") : l("loadFailed")}
            </p>
            {error?.code !== "listing_not_found" && (
              <Button variant="outline" size="sm" onClick={retry}>
                {l("retry")}
              </Button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[96rem] flex-col gap-5 px-4 py-6 lg:px-8">
      {back}
      <Header result={data} extras={extras} now={now} />
      <StatTiles result={data} targets={intent?.travelTargets ?? []} />
      <ThingsToCheck result={data} />
      <div className="grid items-start gap-5 lg:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-5 lg:col-span-8">
          <RentCheck result={data} now={now} />
          <TheHome result={data} />
          <AreaCard extras={extras} />
        </div>
        <div className="flex min-w-0 flex-col gap-5 lg:col-span-4">
          <WhyItRanks result={data} intent={intent} />
          {(intent?.travelTargets.length ?? 0) > 0 && (
            <GettingAround result={data} targets={intent?.travelTargets ?? []} />
          )}
          {intent?.safety.enabled && <SafetySection result={data} />}
          <NotYetAvailable result={data} extras={extras} />
        </div>
      </div>
    </div>
  );
}

/** P2.30: rent, rooms, address or area, the source button, freshness and data status. */
function Header({
  result,
  extras,
  now,
}: {
  result: SearchResultItem;
  extras: DetailResponse | null;
  now: number;
}) {
  const { listing } = result;
  const shortlisted = useAppStore(selectIsShortlisted(listing.id));
  const toggleShortlist = useAppStore((s) => s.toggleShortlist);
  const facts = [
    listing.bedrooms === null
      ? null
      : listing.bedrooms === 0
        ? t("results.studio")
        : t("results.beds", { n: listing.bedrooms }),
    listing.bathrooms === null
      ? null
      : t("results.baths", { n: decimal.format(listing.bathrooms) }),
    listing.sqft === null ? null : t("results.sqft", { n: formatCount(listing.sqft) }),
  ].filter((fact): fact is string => Boolean(fact));
  const duplicates = extras?.duplicates ?? [];
  const status =
    listing.dataStatus === "snapshot"
      ? l("dataStatus.snapshot", { date: formatDate(listing.lastSeenAt) })
      : l(`dataStatus.${listing.dataStatus}`);
  const meta = [
    l("seen", { when: formatDaysAgo(daysSince(listing.lastSeenAt, now)) }),
    l("listedSince", { date: formatDate(listing.firstSeenAt) }),
    status,
  ];

  const source = t(`results.sources.${listing.source}` as MessageKey);

  return (
    <header className="bg-hero text-hero-foreground flex flex-col gap-6 rounded-2xl p-5 sm:p-7 lg:flex-row lg:items-stretch">
      {listing.imageUrl && (
        // Hot-linked from the source, only when its terms allow (SPEC 8.4); never re-hosted.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={listing.imageUrl}
          alt={l("photoAlt", { source })}
          referrerPolicy="no-referrer"
          className="aspect-[4/3] w-full shrink-0 rounded-xl bg-white/10 object-cover lg:w-80"
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
          {listing.title}
        </h1>
        {listing.addressText !== listing.title && (
          <p className="text-hero-muted">{listing.addressText ?? l("approxAddress")}</p>
        )}
        {facts.length > 0 && (
          <ul className="figures flex flex-wrap gap-2">
            {facts.map((fact) => (
              <li key={fact} className="rounded-full bg-white/12 px-3 py-1 text-sm font-medium">
                {fact}
              </li>
            ))}
          </ul>
        )}
        <ul className="text-hero-muted mt-auto flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {meta.map((item) => (
            <li key={item}>{item}</li>
          ))}
          {duplicates.length > 0 && (
            <li>
              {l("alsoOn")}
              {duplicates.map((duplicate, index) => (
                <span key={duplicate.id}>
                  {index > 0 && ", "}
                  <a
                    href={duplicate.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-hero-foreground underline underline-offset-2"
                  >
                    {t(`results.sources.${duplicate.source}` as MessageKey)}
                  </a>
                </span>
              ))}
            </li>
          )}
        </ul>
      </div>
      <div className="flex flex-col gap-3 lg:items-end lg:text-right">
        <p className="figures text-5xl font-semibold tracking-tight sm:text-6xl">
          {formatCad(listing.monthlyRentCad)}
          <span className="text-hero-muted text-base font-normal">
            {listing.rentIsPerRoom ? l("perRoom") : l("perMonth")}
          </span>
        </p>
        <div className="flex items-center gap-2">
          <SourceButton result={result} onDark />
          <button
            type="button"
            aria-pressed={shortlisted}
            aria-label={t(shortlisted ? "results.shortlistRemove" : "results.shortlistAdd", {
              title: listing.title,
            })}
            onClick={() => toggleShortlist(listing)}
            className="grid size-10 shrink-0 place-items-center rounded-full border border-white/25 outline-none hover:bg-white/10 focus-visible:ring-3 focus-visible:ring-white/50"
          >
            <Bookmark
              aria-hidden
              className={`size-5 ${shortlisted ? "fill-hero-foreground" : ""}`}
            />
          </button>
        </div>
        <p className="text-hero-muted text-xs">{l("sourceNote", { source })}</p>
      </div>
    </header>
  );
}

const priceTint = {
  underpriced: "bg-price-underpriced text-price-underpriced-foreground",
  reasonable: "bg-price-reasonable text-price-reasonable-foreground",
  overpriced: "bg-price-overpriced text-price-overpriced-foreground",
  unknown: "bg-card border border-dashed",
} as const;

const partDots = {
  value: "bg-score-value",
  price: "bg-score-price",
  travel: "bg-score-travel",
  home: "bg-score-home",
  safety: "bg-score-safety",
} as const;

/** The three numbers a renter looks for first: match score, price position, the main trip. */
function StatTiles({
  result,
  targets,
}: {
  result: SearchResultItem;
  targets: SearchIntent["travelTargets"];
}) {
  const { total, parts } = scoreBreakdown(result.matchScore);
  const { valuation, listing } = result;
  const summary = priceSummary(valuation);
  const priced = valuation.status === "ok" && summary.label !== "unknown";
  const first = travelTable(targets, result.travel, result.listing.location)[0];
  const trip = first?.modes.find((time) => time.mode === first.chosen[0]);
  const TripIcon = trip ? modeIcons[trip.mode] : null;

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <section
        aria-label={t("results.scoreAria", {
          total,
          parts: parts
            .map((part) =>
              t("results.scorePart", {
                part: t(`results.parts.${part.id}` as MessageKey),
                points: formatCount(part.points),
              }),
            )
            .join(", "),
        })}
        className="bg-card flex flex-col items-center gap-3 rounded-2xl border p-5"
      >
        <h2 className="self-start font-medium">{l("stats.score")}</h2>
        <ScoreGauge total={total} parts={parts} />
        <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm">
          {parts.map((part) => (
            <li key={part.id} className="flex items-center gap-1.5">
              <span aria-hidden className={`size-2.5 rounded-full ${partDots[part.id]}`} />
              {t(`results.parts.${part.id}` as MessageKey)}
              <span className="figures text-muted-foreground">{formatCount(part.points)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section
        className={`flex flex-col gap-3 rounded-2xl p-5 ${priceTint[priced ? summary.label : "unknown"]}`}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-medium">{l("stats.price")}</h2>
          <PriceBadge valuation={valuation} />
        </div>
        {priced ? (
          <>
            <p className="figures text-4xl font-semibold tracking-tight">
              {summary.direction === "in_line"
                ? l("stats.inLine")
                : l(`stats.${summary.direction}`, {
                    amount: formatCad(Math.abs(valuation.differenceCad!)),
                  })}
            </p>
            <p className="figures text-sm opacity-80">
              {l("stats.vsEstimate", { value: formatCad(valuation.estimatedRentCad!) })}
            </p>
            {valuation.lowCad && valuation.highCad && (
              <div className="mt-auto flex flex-col gap-1">
                <RangeBar
                  low={valuation.lowCad}
                  high={valuation.highCad}
                  rent={listing.monthlyRentCad}
                />
                <p className="figures flex justify-between text-xs opacity-80">
                  <span>{formatCad(valuation.lowCad)}</span>
                  <span>{l("stats.typical")}</span>
                  <span>{formatCad(valuation.highCad)}</span>
                </p>
              </div>
            )}
          </>
        ) : (
          <p className="text-muted-foreground text-sm">{l("stats.priceNone")}</p>
        )}
      </section>

      {first && trip && TripIcon ? (
        <section className="bg-score-travel flex flex-col gap-3 rounded-2xl p-5 text-white">
          <h2 className="truncate font-medium">{l("stats.commute", { place: first.label })}</h2>
          <p
            className={
              trip.kind === "estimated"
                ? "figures text-5xl font-semibold tracking-tight"
                : "text-lg font-medium"
            }
          >
            {modeTimeText(trip)}
          </p>
          <p className="mt-auto flex items-center gap-2 text-sm capitalize opacity-90">
            <TripIcon aria-hidden className="size-4" />
            {t(`filters.modes.${trip.mode}` as MessageKey)}
          </p>
        </section>
      ) : (
        <section className="bg-score-travel/10 border-score-travel/40 flex flex-col gap-2 rounded-2xl border border-dashed p-5">
          <h2 className="font-medium">{l("stats.commuteNone")}</h2>
          <p className="text-muted-foreground text-sm">{l("stats.commuteHint")}</p>
        </section>
      )}
    </div>
  );
}
