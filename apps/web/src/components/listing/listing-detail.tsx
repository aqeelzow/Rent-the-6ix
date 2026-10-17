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
import type { DetailResponse, SearchResultItem } from "@/lib/store/types";
import {
  AreaCard,
  BuildingSection,
  GettingAround,
  RentCheck,
  SafetySection,
  SourceButton,
  TheHome,
  ThingsToCheck,
  WhyItRanks,
} from "./detail-sections";
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
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
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
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6">
      {back}
      <Header result={data} extras={extras} now={now} />
      <WhyItRanks result={data} intent={intent} />
      <RentCheck result={data} now={now} />
      <TheHome result={data} />
      <GettingAround result={data} targets={intent?.travelTargets ?? []} />
      {intent?.safety.enabled && <SafetySection result={data} />}
      <BuildingSection />
      <AreaCard extras={extras} />
      <ThingsToCheck result={data} />
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
  ].filter(Boolean);
  const duplicates = extras?.duplicates ?? [];
  const status =
    listing.dataStatus === "snapshot"
      ? l("dataStatus.snapshot", { date: formatDate(listing.lastSeenAt) })
      : l(`dataStatus.${listing.dataStatus}`);

  return (
    <header className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="figures text-3xl font-semibold tracking-tight">
            {formatCad(listing.monthlyRentCad)}
            <span className="text-muted-foreground text-base font-normal">
              {listing.rentIsPerRoom ? l("perRoom") : l("perMonth")}
            </span>
          </p>
          <h1 className="mt-1 text-xl font-semibold text-balance">{listing.title}</h1>
          {facts.length > 0 && <p className="text-muted-foreground figures">{facts.join(" · ")}</p>}
          <p className="mt-1 text-sm">
            {listing.addressText ?? (
              <span className="text-muted-foreground">{l("approxAddress")}</span>
            )}
          </p>
        </div>
        <button
          type="button"
          aria-pressed={shortlisted}
          aria-label={t(shortlisted ? "results.shortlistRemove" : "results.shortlistAdd", {
            title: listing.title,
          })}
          onClick={() => toggleShortlist(listing.id)}
          className="hover:bg-accent focus-visible:ring-ring/50 grid size-10 shrink-0 place-items-center rounded-md outline-none focus-visible:ring-3"
        >
          <Bookmark
            aria-hidden
            className={`size-6 ${shortlisted ? "fill-primary text-primary" : "text-muted-foreground"}`}
          />
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SourceButton result={result} />
        <p className="text-muted-foreground text-sm">
          {l("seen", { when: formatDaysAgo(daysSince(listing.lastSeenAt, now)) })} ·{" "}
          {l("listedSince", { date: formatDate(listing.firstSeenAt) })} · {status}
        </p>
      </div>
      {duplicates.length > 0 && (
        <p className="text-sm">
          {l("alsoOn")}
          {duplicates.map((duplicate, index) => (
            <span key={duplicate.id}>
              {index > 0 && ", "}
              <a
                href={duplicate.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline underline-offset-2"
              >
                {t(`results.sources.${duplicate.source}` as MessageKey)}
              </a>
            </span>
          ))}
        </p>
      )}
      <p className="text-muted-foreground text-xs">{l("sourceNote")}</p>
    </header>
  );
}
