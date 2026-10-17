"use client";

import { useId } from "react";
import { t, type MessageKey } from "@/lib/format/messages";
import { runSearch } from "@/lib/store/actions";
import { useAppStore } from "@/lib/store/store";
import type { SearchIntent } from "@/lib/store/types";

type Sort = SearchIntent["sortBy"];

// "Lowest true monthly cost" waits for affordability (P4.21); B's route answers 503 for it today.
const SORTS: Sort[] = ["best_match", "lowest_rent", "best_value", "shortest_trips", "newest"];

/** Sort selector next to the Filters button; changing it re-runs search without parsing. */
export function SortSelect() {
  const id = useId();
  const intent = useAppStore((s) => s.intent);
  const updateIntent = useAppStore((s) => s.updateIntent);
  if (!intent) return null;
  const sorts = SORTS.filter((sort) => sort !== "shortest_trips" || intent.travelTargets.length);

  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-muted-foreground text-sm">
        {t("filters.panel.sortBy")}
      </label>
      <select
        id={id}
        value={intent.sortBy}
        onChange={(event) => {
          const sortBy = event.target.value as Sort;
          updateIntent((current) => ({
            ...current,
            sortBy,
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
      </select>
    </div>
  );
}
