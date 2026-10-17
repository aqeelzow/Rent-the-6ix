import type { AreaFacts } from "@rentthe6ix/shared/schemas";
import Link from "next/link";
import { t, type MessageKey } from "@/lib/format/messages";
import { formatCount } from "@/lib/format/number";
import { cityValueText, factLabel, factValueText, periodLabel } from "./fact-format";

const f = (key: string, params?: Record<string, string | number>) =>
  t(`areas.facts.${key}` as MessageKey, params);

/** Rents first, then housing stock, getting around, amenities and development; unknown ids last. */
const ORDER = [
  "median_asking_rent_0br",
  "median_asking_rent_1br",
  "median_asking_rent_2br",
  "median_asking_rent_3br",
  "listing_count_30d",
  "renter_households_pct",
  "renters_shelter_cost_30pct",
  "median_household_income",
  "rentsafeto_buildings",
  "rentsafeto_avg_score",
  "transit_stops_per_km2",
  "rapid_transit_within_800m_pct",
  "libraries",
  "parks",
  "dev_applications_12m",
  "residential_units_proposed_12m",
];
const LISTINGS = "rentthe6ix-listings";

/**
 * "This ward at a glance" (SPEC 9.3): each of the area's figures beside Toronto's, with the period
 * and a link to its source, so every number can be traced.
 */
export function AreaFactsList({ facts }: { facts: AreaFacts }) {
  const sources = new Map(facts.sources.map((source) => [source.id, source]));
  const rank = (id: string) => (ORDER.includes(id) ? ORDER.indexOf(id) : ORDER.length);
  const rows = [...facts.facts].sort((a, b) => rank(a.indicatorId) - rank(b.indicatorId));

  return (
    <div className="flex flex-col gap-3">
      <ul className="divide-y">
        {rows.map((fact) => {
          const source = sources.get(fact.sourceId);
          return (
            <li
              key={fact.indicatorId}
              className="grid gap-2 py-3 first:pt-0 sm:grid-cols-[minmax(0,1fr)_16rem] sm:items-center"
            >
              <div className="min-w-0">
                <p className="font-medium">{factLabel(fact.indicatorId)}</p>
                <p className="text-muted-foreground text-xs">
                  {periodLabel(fact.period)}
                  {fact.sourceId === LISTINGS && fact.sampleSize !== null && (
                    <> · {f("listings", { n: formatCount(fact.sampleSize) })}</>
                  )}
                  {source && (
                    <>
                      {" · "}
                      {source.url.startsWith("/") ? (
                        <Link href={source.url} className="underline underline-offset-2">
                          {f("source", { source: source.title })}
                        </Link>
                      ) : (
                        <a href={source.url} className="underline underline-offset-2">
                          {f("source", { source: source.title })}
                        </a>
                      )}
                    </>
                  )}
                </p>
              </div>
              <dl className="figures grid grid-cols-2 gap-x-4 text-sm">
                <div>
                  <dt className="text-muted-foreground text-xs">{f("thisArea")}</dt>
                  <dd className="font-semibold">{factValueText(fact)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">{f("city")}</dt>
                  <dd>{cityValueText(fact)}</dd>
                </div>
              </dl>
            </li>
          );
        })}
      </ul>
      {rows.some((fact) => fact.sourceId === LISTINGS) && (
        <p className="text-muted-foreground text-xs">{f("listingsNote")}</p>
      )}
    </div>
  );
}
