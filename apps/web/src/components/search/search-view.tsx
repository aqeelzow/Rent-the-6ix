"use client";

import { AlertCircle, Info, List, LoaderCircle, MapIcon, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ResultsMap } from "@/components/map/results-map";
import { ResultCard } from "@/components/results/result-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useMediaQuery } from "@/components/use-media-query";
import { FilterChips } from "./filter-chips";
import { FiltersPanel } from "./filters-panel";
import { SortSelect } from "./sort-select";
import { t, type MessageKey } from "@/lib/format/messages";
import { formatCount } from "@/lib/format/number";
import { parseAndSearch, runSearch } from "@/lib/store/actions";
import { appStore, useAppStore } from "@/lib/store/store";
import type { ApiError, SearchIntent, SearchResultItem } from "@/lib/store/types";

const knownErrors = new Set([
  "rate_limited",
  "service_unavailable",
  "network_error",
  "validation_error",
  "search_timeout",
  "search_capacity",
  "search_routing_incomplete",
  "search_job_expired",
]);

function errorMessage(error: ApiError): string {
  const key = (knownErrors.has(error.code) ? error.code : "default") as string;
  return t(`search.errors.${key}` as MessageKey, { seconds: error.retryAfterSeconds ?? 30 });
}

export function SearchView({ prompt }: { prompt: string | null }) {
  const status = useAppStore((s) => s.status);
  const intent = useAppStore((s) => s.intent);
  const error = useAppStore((s) => s.error);
  const results = useAppStore((s) => s.results);
  const eligibleCount = useAppStore((s) => s.eligibleCount);
  const parser = useAppStore((s) => s.parser);
  const parseNotice = useAppStore((s) => s.parseNotice);
  const notices = useAppStore((s) => s.notices);
  const selectedId = useAppStore((s) => s.selectedListingId);
  const setSelected = useAppStore((s) => s.setSelectedListingId);
  // "Seen N days ago" is measured from when this view opened.
  const [now] = useState(() => Date.now());
  // Desktop shows the map beside the list; phones switch between them (SPEC 11.2).
  const desktop = useMediaQuery("(min-width: 1024px)");
  const [mobileView, setMobileView] = useState<"list" | "map">("list");

  useEffect(() => {
    if (!prompt) return;
    // Coming back to a prompt that's already been read keeps its edited filters.
    if (appStore.getState().intent?.rawPrompt === prompt) return;
    void parseAndSearch(prompt);
  }, [prompt]);

  if (!prompt) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col items-start gap-4 px-4 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">{t("search.title")}</h1>
        <p className="text-muted-foreground">{t("search.noPrompt")}</p>
        <Button asChild>
          <Link href="/">{t("search.startSearch")}</Link>
        </Button>
      </div>
    );
  }

  const busy = status === "parsing" || status === "searching";
  const retry = () =>
    intent?.rawPrompt === prompt ? void runSearch() : void parseAndSearch(prompt);

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,45fr)_minmax(0,55fr)]">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 lg:max-w-none lg:px-6">
        <h1 className="sr-only">{t("search.title")}</h1>

        <section aria-labelledby="request-label" className="bg-card rounded-xl border p-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="request-label" className="text-muted-foreground text-sm font-medium">
              {t("search.yourRequest")}
            </h2>
            <Link
              href="/"
              className="text-primary text-sm font-medium underline-offset-4 hover:underline"
            >
              {t("search.editRequest")}
            </Link>
          </div>
          <p className="mt-1">{prompt}</p>
        </section>

        {intent && intent.rawPrompt === prompt && (
          <>
            {/* A direct child of the column so it stays stuck on phones while the list scrolls
                and Filters is always one tap away (SPEC 18). */}
            <div className="bg-background/95 sticky top-14 z-20 -mx-4 -mb-3 flex flex-wrap items-center justify-between gap-2 px-4 py-2 backdrop-blur lg:static lg:mx-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
              <FiltersPanel />
              <SortSelect />
            </div>
            <FilterChips intent={intent} />
          </>
        )}

        <div aria-live="polite" className="flex flex-col gap-4">
          {busy && (
            <p className="text-muted-foreground flex items-center gap-2 text-sm">
              <LoaderCircle aria-hidden className="size-4 animate-spin" />
              {t(status === "parsing" ? "search.parsing" : "search.searching")}
            </p>
          )}

          {status === "error" && error && (
            <div
              role="alert"
              className="bg-caveat-high text-caveat-high-foreground flex flex-col items-start gap-3 rounded-xl p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <p className="flex items-start gap-2">
                <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0" />
                {errorMessage(error)}
              </p>
              <Button variant="outline" size="sm" onClick={retry}>
                {t("search.retry")}
              </Button>
            </div>
          )}

          {parser === "fallback" && parseNotice && status !== "parsing" && (
            <p className="bg-caveat-info text-caveat-info-foreground flex items-start gap-2 rounded-lg px-3 py-2 text-sm">
              <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span>
                <span className="font-medium">{t("search.basicSearch")}.</span> {parseNotice}
              </span>
            </p>
          )}

          {intent && intent.droppedRequests.length > 0 && status !== "parsing" && (
            <div className="rounded-lg border border-dashed px-3 py-2 text-sm">
              <p className="font-medium">{t("search.droppedTitle")}</p>
              <ul className="text-muted-foreground mt-1 list-disc pl-5">
                {intent.droppedRequests.map((dropped) => (
                  <li key={dropped.phrase}>
                    “{dropped.phrase}”: {dropped.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {busy && results.length === 0 ? (
          <ResultSkeletons />
        ) : status === "ready" && results.length === 0 ? (
          <p className="text-muted-foreground">{t("search.noResults")}</p>
        ) : results.length > 0 ? (
          <section aria-labelledby="results-count" className="flex flex-col gap-3">
            <h2 id="results-count" className="text-muted-foreground figures text-sm">
              {t("search.count", {
                shown: formatCount(results.length),
                eligible: formatCount(eligibleCount),
              })}
            </h2>
            {notices.length > 0 && (
              <ul className="text-muted-foreground text-xs">
                {notices.map((notice) => (
                  <li key={notice}>{notice}</li>
                ))}
              </ul>
            )}
            <ol className={`flex flex-col gap-3 ${busy ? "opacity-60" : ""}`}>
              {results.map((result) => (
                <li key={result.listing.id}>
                  <ResultCard
                    result={result}
                    targets={intent?.travelTargets ?? []}
                    safetyOn={intent?.safety.enabled ?? false}
                    now={now}
                  />
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        {/* Sticky at the bottom of the screen while the list scrolls; rests after the last card. */}
        {!desktop && results.length > 0 && (
          <div className="sticky bottom-4 z-20 flex justify-center">
            <Button
              onClick={() => setMobileView("map")}
              className="h-10 rounded-full px-4 shadow-lg"
            >
              <MapIcon aria-hidden data-icon="inline-start" />
              {t("results.mobile.showMap")}
            </Button>
          </div>
        )}
      </div>
      {desktop ? (
        <ResultsMap className="sticky top-14 h-[calc(100dvh-3.5rem)] border-l" />
      ) : (
        mobileView === "map" && (
          <div className="fixed inset-x-0 top-14 bottom-0 z-30">
            <ResultsMap className="size-full" />
            <Button
              onClick={() => setMobileView("list")}
              className="absolute top-3 left-1/2 z-10 h-10 -translate-x-1/2 rounded-full px-4 shadow-lg"
            >
              <List aria-hidden data-icon="inline-start" />
              {t("results.mobile.showList")}
            </Button>
            <MobileListingCard
              result={results.find((r) => r.listing.id === selectedId)}
              intent={intent}
              now={now}
              onClose={() => setSelected(null)}
            />
          </div>
        )
      )}
    </div>
  );
}

/** On a phone's map view, the tapped pin's card slides up from the bottom (SPEC 11.2). */
function MobileListingCard({
  result,
  intent,
  now,
  onClose,
}: {
  result: SearchResultItem | undefined;
  intent: SearchIntent | null;
  now: number;
  onClose: () => void;
}) {
  if (!result) return null;
  return (
    <div className="animate-in slide-in-from-bottom-4 absolute inset-x-0 bottom-0 z-10 max-h-[70%] overflow-y-auto p-3">
      <div className="relative">
        <Button
          variant="secondary"
          size="icon-sm"
          aria-label={t("results.mobile.closeCard")}
          onClick={onClose}
          className="absolute -top-3 right-2 z-20 rounded-full shadow"
        >
          <X aria-hidden />
        </Button>
        <ResultCard
          result={result}
          targets={intent?.travelTargets ?? []}
          safetyOn={intent?.safety.enabled ?? false}
          now={now}
        />
      </div>
    </div>
  );
}

function ResultSkeletons() {
  return (
    <div aria-hidden className="flex flex-col gap-2">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-56 w-full rounded-xl" />
      ))}
    </div>
  );
}
