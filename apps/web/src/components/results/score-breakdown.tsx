import { t, type MessageKey } from "@/lib/format/messages";
import type { SearchResultItem } from "@/lib/store/types";

const decimal = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 1 });

export const partColors = {
  value: "bg-score-value",
  price: "bg-score-price",
  travel: "bg-score-travel",
  home: "bg-score-home",
  safety: "bg-score-safety",
} as const;

/** Explains the API's scores and evidence without recalculating them in the browser. */
export function ScoreBreakdown({ matchScore }: { matchScore: SearchResultItem["matchScore"] }) {
  const weightSum = matchScore.parts.reduce(
    (sum, part) => sum + (part.score === null ? 0 : part.weight),
    0,
  );

  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-xs">{t("results.scoreCalculation.total")}</p>
      <ul className="flex flex-col gap-4">
        {matchScore.parts.map((part) => (
          <li key={part.id} className="flex flex-col gap-1.5">
            <span className="flex items-center justify-between gap-3 font-medium">
              <span className="flex items-center gap-2">
                <span aria-hidden className={`size-2.5 rounded-full ${partColors[part.id]}`} />
                {t(`results.parts.${part.id}` as MessageKey)}
              </span>
              {part.score !== null && part.effectiveWeight > 0 && (
                <span className="figures text-sm">
                  {t("results.scorePoints", {
                    points: decimal.format(part.score * part.effectiveWeight),
                  })}
                </span>
              )}
            </span>
            <p className="text-muted-foreground text-xs">
              {t(`results.scoreCalculation.${part.id}`)}
            </p>
            {part.score === null ? (
              <p className="text-muted-foreground text-xs">
                {t("results.scoreCalculation.unavailable")}
              </p>
            ) : part.effectiveWeight === 0 ? (
              <p className="text-muted-foreground text-xs">
                {t("results.scoreCalculation.zeroWeight")}
              </p>
            ) : (
              <p className="figures text-xs">
                {t("results.scoreCalculation.contribution", {
                  score: decimal.format(part.score),
                  weight: decimal.format(part.weight),
                  weightSum: decimal.format(weightSum),
                  share: decimal.format(part.effectiveWeight * 100),
                  points: decimal.format(part.score * part.effectiveWeight),
                })}
              </p>
            )}
            {part.score !== null && part.evidence.length > 0 && (
              <ul className="text-muted-foreground list-disc pl-4 text-xs">
                {part.evidence.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground border-t pt-2 text-xs">
        {t("results.scoreCalculation.requirements")}
      </p>
    </div>
  );
}
