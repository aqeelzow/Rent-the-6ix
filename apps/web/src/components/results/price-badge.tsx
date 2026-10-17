"use client";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { t, type MessageKey } from "@/lib/format/messages";
import { formatCount } from "@/lib/format/number";
import type { SearchResultItem } from "@/lib/store/types";
import { priceSummary } from "./card-data";

const r = (key: string, params?: Record<string, string | number>) =>
  t(`results.price.${key}` as MessageKey, params);

/** Price badge colours (SPEC 18): green / neutral / amber; thin data is dashed and uncoloured. */
const styles = {
  underpriced: "bg-price-underpriced text-price-underpriced-foreground",
  reasonable: "bg-price-reasonable text-price-reasonable-foreground",
  overpriced: "bg-price-overpriced text-price-overpriced-foreground",
  unknown: "border border-dashed border-input text-muted-foreground",
} as const;

/**
 * "Underpriced" / "Reasonably priced" / "Overpriced" / "Not enough data" with the percent under it
 * and, on tap, what it was compared with (SPEC 7.2). Wording only; every number comes from C's
 * valuation.
 */
export function PriceBadge({
  valuation,
  tinted = false,
}: {
  valuation: SearchResultItem["valuation"];
  /** On a panel already tinted by the label: a quiet pill with the detail beside it. */
  tinted?: boolean;
}) {
  const summary = priceSummary(valuation);
  const label = r(summary.label);
  const detail =
    summary.label === "unknown"
      ? r("thin")
      : summary.direction === "in_line"
        ? r("inLine")
        : r(summary.direction, { percent: formatCount(summary.percent) });

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${label}. ${detail}. ${r("more")}`}
          className={`focus-visible:ring-ring/50 relative z-10 flex rounded-md text-left outline-none focus-visible:ring-3 ${tinted ? "flex-wrap items-center gap-x-2 gap-y-1" : "flex-col items-start gap-1"}`}
        >
          <span
            className={`rounded-full text-xs font-semibold ${tinted ? "bg-black/[0.07] px-3 py-1 dark:bg-white/12" : `px-2 py-0.5 ${styles[summary.label]}`}`}
          >
            {label}
          </span>
          <span className={`figures text-xs ${tinted ? "opacity-80" : "text-muted-foreground"}`}>
            {detail}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-72 flex-col gap-1 text-sm">
        <p>
          {summary.label === "unknown"
            ? r("noteThin")
            : r("note", { count: formatCount(summary.comparableCount) })}
        </p>
        {summary.label !== "unknown" && (
          <p className="text-muted-foreground">{r(`confidence.${summary.confidence}`)}</p>
        )}
      </PopoverContent>
    </Popover>
  );
}
