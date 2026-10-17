import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { t, type MessageKey } from "@/lib/format/messages";
import { formatCount } from "@/lib/format/number";
import type { SearchResultItem } from "@/lib/store/types";
import { scoreSegments } from "./card-data";

const partColors = {
  value: "bg-score-value",
  price: "bg-score-price",
  travel: "bg-score-travel",
  home: "bg-score-home",
  safety: "bg-score-safety",
} as const;

/**
 * Match score with a bar segmented by part (vertical, or a horizontal row on result cards);
 * hovering or focusing it lists each part. Segments are score × effective weight, so together
 * they fill exactly `total` percent of the bar; the number and an aria label carry the same
 * information as the colours.
 * Lives inside a TooltipProvider (the root layout has one).
 */
export function ScoreBar({
  matchScore,
  orientation = "vertical",
  className = "",
}: {
  matchScore: SearchResultItem["matchScore"];
  /** Horizontal: a labelled row with the bar under it, filling left to right. */
  orientation?: "vertical" | "horizontal";
  className?: string;
}) {
  const segments = scoreSegments(matchScore);
  const parts = segments
    .map((segment) =>
      t("results.scorePart", {
        part: t(`results.parts.${segment.id}` as MessageKey),
        points: formatCount(segment.points),
      }),
    )
    .join(", ");

  return (
    <Tooltip>
      {/* A button so the breakdown also opens by keyboard; it sits above the card's link. */}
      <TooltipTrigger asChild>
        {orientation === "horizontal" ? (
          <button
            type="button"
            aria-label={t("results.scoreAria", { total: matchScore.total, parts })}
            className={`focus-visible:ring-ring/50 relative z-10 flex w-full cursor-help flex-col gap-2 rounded-md text-left outline-none focus-visible:ring-3 ${className}`}
          >
            <span className="flex items-baseline justify-between text-sm">
              <span className="opacity-80">{t("results.scoreRow")}</span>
              <span className="figures font-semibold">{matchScore.total}</span>
            </span>
            <span className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full bg-black/[0.07] dark:bg-white/12">
              {segments.map((segment) => (
                <span
                  key={segment.id}
                  className={`${partColors[segment.id]} h-full shrink-0 first:rounded-l-full last:rounded-r-full`}
                  style={{ width: `${segment.points}%` }}
                />
              ))}
            </span>
          </button>
        ) : (
          <button
            type="button"
            aria-label={t("results.scoreAria", { total: matchScore.total, parts })}
            className={`focus-visible:ring-ring/50 relative z-10 flex cursor-help flex-col items-center gap-2 rounded-lg p-1 outline-none focus-visible:ring-3 ${className}`}
          >
            <span className="flex flex-col items-center leading-none">
              <span className="figures text-3xl font-semibold">{matchScore.total}</span>
              <span className="text-muted-foreground mt-1 text-xs">{t("results.scoreLabel")}</span>
            </span>
            {/* Fills from the bottom; the first part sits lowest. */}
            <span className="bg-muted flex h-24 w-4 flex-col-reverse gap-0.5 overflow-hidden rounded-full">
              {segments.map((segment) => (
                <span
                  key={segment.id}
                  className={`${partColors[segment.id]} w-full shrink-0`}
                  style={{ height: `${segment.points}%` }}
                />
              ))}
            </span>
          </button>
        )}
      </TooltipTrigger>
      <TooltipContent
        side={orientation === "horizontal" ? "top" : "left"}
        className="flex-col items-stretch gap-1.5 py-2"
      >
        <p className="font-semibold">{t("results.scoreBreakdown", { total: matchScore.total })}</p>
        <ul className="flex flex-col gap-1">
          {/* Top to bottom in the same order as the bar, highest segment first. */}
          {[...segments].reverse().map((segment) => (
            <li key={segment.id} className="flex items-center gap-2">
              <span aria-hidden className={`size-2.5 rounded-full ${partColors[segment.id]}`} />
              <span className="flex-1">{t(`results.parts.${segment.id}` as MessageKey)}</span>
              <span className="figures font-medium">
                {t("results.scorePoints", { points: formatCount(segment.points) })}
              </span>
            </li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}
