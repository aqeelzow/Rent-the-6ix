import { DetailSection } from "@/components/listing/detail-sections";
import { SafetyInfoButton } from "@/components/safety/safety-info";
import { t, type MessageKey } from "@/lib/format/messages";
import type { WardCrime } from "@/lib/db/ward-crime";

const c = (key: string, params?: Record<string, string | number>) =>
  t(`areas.crime.${key}` as MessageKey, params);
const rate = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 2 });
const percent = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 0 });

/**
 * Police-reported crime under "This ward at a glance" (SPEC 7.6, 9.1). TPS publishes neighbourhood
 * rates only, so this lists the neighbourhoods covering the ward, each with its own rate relative
 * to the city and the caveats one tap away. Figures only: no "safe", "unsafe" or colour judgement.
 */
export function WardCrimeSection({ crime }: { crime: WardCrime }) {
  const years = crime.neighbourhoods.find((n) => n.safety?.years.length)?.safety?.years ?? [];
  return (
    <DetailSection id="crime" title={c("title")}>
      <p className="text-muted-foreground text-sm">{c("intro")}</p>
      <ul className="divide-y">
        {crime.neighbourhoods.map((neighbourhood) => (
          <li
            key={neighbourhood.id}
            className="flex items-baseline justify-between gap-3 py-2 text-sm"
          >
            <span className="min-w-0">
              {neighbourhood.name}
              <span className="text-muted-foreground figures block text-xs">
                {c("share", { share: percent.format(neighbourhood.share * 100) })}
              </span>
            </span>
            <span className="figures shrink-0 font-medium">
              {neighbourhood.safety?.relativeRate != null
                ? c("rate", { rate: rate.format(neighbourhood.safety.relativeRate) })
                : c("noData")}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground text-xs">
        {years.length > 0 && c("source", { years: `${years[0]}–${years.at(-1)}` })}{" "}
        <SafetyInfoButton caveats={crime.caveats} />
      </p>
    </DetailSection>
  );
}
