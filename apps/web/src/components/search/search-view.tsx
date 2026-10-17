"use client";

import { AlertCircle, ChevronRight, Info, List, LoaderCircle, MapIcon, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { ResultsMap } from "@/components/map/results-map";
import { ResultCard } from "@/components/results/result-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useMediaQuery } from "@/components/use-media-query";
import { FilterChips } from "./filter-chips";
import { FiltersPanel } from "./filters-panel";
import { ShareSearch } from "./share-search";
import { SortSelect } from "./sort-select";
import { t, type MessageKey } from "@/lib/format/messages";
import { formatCount } from "@/lib/format/number";
import { parseAndSearch, restoreSearch, runSearch } from "@/lib/store/actions";
import { LAST_SEARCH_KEY, parseLastSearch, readLastSearch } from "@/lib/store/persist";
import { decodeSharedSearch } from "@/lib/store/share";
import { appStore, useAppStore } from "@/lib/store/store";
import type { ApiError, SearchIntent, SearchResultItem } from "@/lib/store/types";

/** Cards drawn at a time; a live search can return 500 (the map shows them all). */
const PAGE_SIZE = 25;
/** Seconds before the "taking a while" message appears. */
const SLOW_AFTER_SECONDS = 3;

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

// The last search's stored text; a string, so `useSyncExternalStore` sees no change between reads.
function subscribeToStorage(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}
function storedLastSearch(): string | null {
  try {
    return window.localStorage.getItem(LAST_SEARCH_KEY);
  } catch {
    return null;
  }
}

/** "Continue your last search" on `/search` without a prompt, when this browser has one. */
function LastSearchLink() {
  const raw = useSyncExternalStore(subscribeToStorage, storedLastSearch, () => null);
  const last = useMemo(() => parseLastSearch(raw), [raw]);
  if (!last) return null;
  return (
    <Button asChild variant="outline">
      <Link href={`/search?q=${encodeURIComponent(last.intent.rawPrompt)}`}>
        {t("search.lastSearch")}
      </Link>
    </Button>
  );
}

function errorMessage(error: ApiError): string {
  const key = (knownErrors.has(error.code) ? error.code : "default") as string;
  return t(`search.errors.${key}` as MessageKey, { seconds: error.retryAfterSeconds ?? 30 });
}

export function SearchView({ prompt, shared }: { prompt: string | null; shared: string | null }) {
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
  const busySince = useAppStore((s) => s.busySince);
  const elapsed = useElapsedSeconds(busySince);
  // Paging resets whenever a new set of results arrives.
  const [paging, setPaging] = useState({ results, count: PAGE_SIZE });
  const pageCount = paging.results === results ? paging.count : PAGE_SIZE;
  const visibleCount = Math.min(results.length, pageCount);
  const selectedIndex = selectedId ? results.findIndex((r) => r.listing.id === selectedId) : -1;
  const selectedResult = selectedIndex >= 0 ? results[selectedIndex] : undefined;
  // A pin past "Show more" opens its card over the map instead of growing the list.
  const selectedOffList = selectedIndex >= visibleCount;

  // A pin whose card is in the list scrolls the list to it (SPEC 11.2).
  useEffect(() => {
    if (!selectedId) return;
    document
      .querySelector(`ol #listing-${CSS.escape(selectedId)}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [selectedId]);

  useEffect(() => {
    if (!prompt) return;
    // Coming back to a prompt that's already been read keeps its edited filters (Back from a
    // listing included). Otherwise a shared link's filters, then this browser's last search for
    // the same words (a reload), and only then the parser.
    if (appStore.getState().intent?.rawPrompt === prompt) return;
    const last = readLastSearch();
    const saved =
      (shared ? decodeSharedSearch(shared, prompt) : null) ??
      (last?.intent.rawPrompt === prompt ? last : null);
    void (saved ? restoreSearch(saved) : parseAndSearch(prompt));
  }, [prompt, shared]);

  if (!prompt) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col items-start gap-4 px-4 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">{t("search.title")}</h1>
        <p className="text-muted-foreground">{t("search.noPrompt")}</p>
        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href="/">{t("search.startSearch")}</Link>
          </Button>
          <LastSearchLink />
        </div>
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
          <h2 id="request-label" className="text-muted-foreground text-sm font-medium">
            {t("search.yourRequest")}
          </h2>
          <p className="mt-1">{prompt}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
            <Link
              href={`/?q=${encodeURIComponent(prompt)}#start`}
              className="text-primary text-sm font-medium underline-offset-4 hover:underline"
            >
              {t("search.editRequest")}
            </Link>
            {intent?.rawPrompt === prompt && <ShareSearch />}
          </div>
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
            <div className="text-muted-foreground flex flex-col gap-0.5 text-sm">
              <p className="figures flex items-center gap-2">
                <LoaderCircle aria-hidden className="size-4 animate-spin" />
                {status === "parsing"
                  ? t("search.parsing")
                  : elapsed >= SLOW_AFTER_SECONDS
                    ? t("search.searchingElapsed", { seconds: formatCount(elapsed) })
                    : t("search.searching")}
              </p>
              {status === "searching" && elapsed >= SLOW_AFTER_SECONDS && (
                <p className="pl-6 text-xs">{t("search.slowHint")}</p>
              )}
            </div>
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
            // Collapsed by default; the details open on tap.
            <details className="group rounded-lg border border-dashed px-3 py-2 text-sm">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 font-medium [&::-webkit-details-marker]:hidden">
                <ChevronRight
                  aria-hidden
                  className="size-4 shrink-0 transition-transform group-open:rotate-90"
                />
                {t(
                  intent.droppedRequests.length === 1 ? "search.droppedOne" : "search.droppedMany",
                  {
                    count: formatCount(intent.droppedRequests.length),
                  },
                )}
              </summary>
              <ul className="text-muted-foreground mt-2 list-disc pl-5">
                {intent.droppedRequests.map((dropped) => (
                  <li key={dropped.phrase}>
                    “{dropped.phrase}”: {dropped.reason}
                  </li>
                ))}
              </ul>
            </details>
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
                shown: formatCount(visibleCount),
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
              {results.slice(0, visibleCount).map((result) => (
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
            {visibleCount < results.length && (
              <Button
                variant="outline"
                className="self-center"
                onClick={() => setPaging({ results, count: visibleCount + PAGE_SIZE })}
              >
                {t("search.showMore", {
                  count: formatCount(Math.min(PAGE_SIZE, results.length - visibleCount)),
                })}
              </Button>
            )}
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
        <div className="sticky top-14 h-[calc(100dvh-3.5rem)] border-l">
          <ResultsMap className="size-full" />
          {selectedOffList && (
            <MapListingCard
              result={selectedResult}
              intent={intent}
              now={now}
              onClose={() => setSelected(null)}
            />
          )}
        </div>
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
            <MapListingCard
              result={selectedResult}
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

/**
 * The picked pin's card over the map: always on a phone's map view, and on desktop when the
 * card isn't in the list yet (SPEC 11.2).
 */
function MapListingCard({
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
    <div className="animate-in slide-in-from-bottom-4 absolute inset-x-0 bottom-0 z-10 max-h-[70%] overflow-y-auto p-3 lg:right-auto lg:bottom-4 lg:left-4 lg:w-[26rem]">
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

/** Whole seconds since `since`, ticking once a second; 0 when nothing is running. */
function useElapsedSeconds(since: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [since]);
  return since === null ? 0 : Math.max(0, Math.floor((now - since) / 1000));
}
