"use client";

import { AlertCircle, Info, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { FilterChips } from "./filter-chips";
import { FiltersPanel } from "./filters-panel";
import { SortSelect } from "./sort-select";
import { t, type MessageKey } from "@/lib/format/messages";
import { formatCad, formatCount } from "@/lib/format/number";
import { parseAndSearch, runSearch } from "@/lib/store/actions";
import { appStore, useAppStore } from "@/lib/store/store";
import type { ApiError, SearchResultItem } from "@/lib/store/types";

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
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
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
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <FiltersPanel />
            <SortSelect />
          </div>
          <FilterChips intent={intent} />
        </div>
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
          {/* Interim rows; P1.33 replaces them with full result cards. */}
          <ol className={busy ? "flex flex-col gap-2 opacity-60" : "flex flex-col gap-2"}>
            {results.map((result) => (
              <ResultRow key={result.listing.id} result={result} />
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}

function ResultRow({ result }: { result: SearchResultItem }) {
  const { listing } = result;
  const bedrooms =
    listing.bedrooms === null
      ? null
      : listing.bedrooms === 0
        ? t("search.studio")
        : t("search.bedrooms", { count: listing.bedrooms });
  return (
    <li className="bg-card flex items-center justify-between gap-4 rounded-lg border px-4 py-3">
      <span className="min-w-0">
        <span className="block truncate font-medium">{listing.title}</span>
        {bedrooms && <span className="text-muted-foreground text-sm">{bedrooms}</span>}
      </span>
      <span className="figures shrink-0 font-semibold">
        {t("search.perMonth", { rent: formatCad(listing.monthlyRentCad) })}
      </span>
    </li>
  );
}

function ResultSkeletons() {
  return (
    <div aria-hidden className="flex flex-col gap-2">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-16 w-full rounded-lg" />
      ))}
    </div>
  );
}
