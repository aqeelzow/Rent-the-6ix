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
 * Match score with a vertical bar segmented by part. Segments are score × effective weight, so together
 * they fill exactly `total` percent of the bar from the bottom; the number and an aria label carry the same
 * information as the colours.
 */
export function ScoreBar({
  matchScore,
  className = "",
}: {
  matchScore: SearchResultItem["matchScore"];
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
    <div
      role="img"
      aria-label={t("results.scoreAria", { total: matchScore.total, parts })}
      className={`flex items-stretch gap-2 ${className}`}
    >
      <span className="flex flex-col items-end justify-end leading-none">
        <span className="figures text-2xl font-semibold">{matchScore.total}</span>
        <span className="text-muted-foreground mt-1 text-xs">{t("results.scoreLabel")}</span>
      </span>
      {/* Fills from the bottom; the first part sits lowest. */}
      <span className="bg-muted flex h-14 w-2.5 flex-col-reverse overflow-hidden rounded-full">
        {segments.map((segment) => (
          <span
            key={segment.id}
            className={`${partColors[segment.id]} w-full`}
            style={{ height: `${segment.points}%` }}
          />
        ))}
      </span>
    </div>
  );
}
