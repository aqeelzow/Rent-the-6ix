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
 * Match score with a bar segmented by part. Segments are score × effective weight, so together
 * they fill exactly `total` percent of the bar; the number and an aria label carry the same
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
      className={`flex items-center gap-2 ${className}`}
    >
      <span className="figures shrink-0 text-sm font-semibold">
        {t("results.score", { total: matchScore.total })}
      </span>
      <span className="bg-muted flex h-2 min-w-16 flex-1 overflow-hidden rounded-full">
        {segments.map((segment) => (
          <span
            key={segment.id}
            className={`${partColors[segment.id]} h-full`}
            style={{ width: `${segment.points}%` }}
          />
        ))}
      </span>
    </div>
  );
}
