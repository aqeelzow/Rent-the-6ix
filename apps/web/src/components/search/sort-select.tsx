"use client";

import { useId } from "react";
import { preferredAreaReference } from "@/components/results/travel-facts-data";
import { t, type MessageKey } from "@/lib/format/messages";
import { runSearch } from "@/lib/store/actions";
import { useAppStore } from "@/lib/store/store";
import type { SearchIntent } from "@/lib/store/types";

type Sort = SearchIntent["sortBy"];
/** Sorts B runs itself, plus the two that only reorder the results already on screen. */
type LocalOrder = "carbon" | "distance";
type Choice = Sort | LocalOrder;

// "Lowest true monthly cost" waits for affordability (P4.21); B's route answers 503 for it today.
const SORTS: Sort[] = ["best_match", "lowest_rent", "best_value", "shortest_trips", "newest"];

/**
 * Sort selector next to the Filters button. Server sorts re-run the search; "closest to my area"
 * and "lowest-carbon trips" are a local reorder of the results already loaded, so they cost nothing
 * and are labelled as estimates on the cards themselves.
 */
export function SortSelect() {
  const id = useId();
  const intent = useAppStore((s) => s.intent);
  const results = useAppStore((s) => s.results);
  const resultOrder = useAppStore((s) => s.resultOrder);
  const setResultOrder = useAppStore((s) => s.setResultOrder);
  const updateIntent = useAppStore((s) => s.updateIntent);
  if (!intent) return null;

  const reference = preferredAreaReference(intent);
  const routed = results.some((result) => result.travel.some((row) => row.method === "otp"));
  const sorts = SORTS.filter((sort) => sort !== "shortest_trips" || intent.travelTargets.length);
  const locals: LocalOrder[] = [
    ...(routed ? (["carbon"] as const) : []),
    ...(reference ? (["distance"] as const) : []),
  ];
  const value: Choice = resultOrder === "server" ? intent.sortBy : resultOrder;

  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-muted-foreground text-sm">
        {t("filters.panel.sortBy")}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => {
          const next = event.target.value as Choice;
          if (next === "carbon" || next === "distance") {
            setResultOrder(next);
            return;
          }
          setResultOrder("server");
          if (next === intent.sortBy) return;
          updateIntent((current) => ({
            ...current,
            sortBy: next,
            fieldSources: { ...current.fieldSources, sortBy: { source: "user" } },
          }));
          void runSearch();
        }}
        className="border-input bg-card focus-visible:ring-ring/50 h-9 rounded-lg border px-2.5 text-sm outline-none focus-visible:ring-3"
      >
        {sorts.map((sort) => (
          <option key={sort} value={sort}>
            {t(`filters.chips.sorts.${sort}` as MessageKey)}
          </option>
        ))}
        {locals.map((local) => (
          <option key={local} value={local}>
            {t(`filters.chips.sorts.${local === "carbon" ? "lowest_carbon" : "closest_area"}`)}
          </option>
        ))}
      </select>
    </div>
  );
}
