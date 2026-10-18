import type { Metadata } from "next";
import { ExternalLink } from "lucide-react";
import en from "../../../messages/en.json";
import { CAVEATS, engineConfig, VALUATION } from "@rentthe6ix/shared/engine/config";
import { getClient } from "@/lib/db";
import { loadDataPage, type DataSource, type ListingSite } from "@/lib/db/data-sources";
import { formatDate } from "@/lib/format/date";
import { t, type MessageKey } from "@/lib/format/messages";
import { formatCad, formatCount } from "@/lib/format/number";

// About the data (SPEC 11.6), drafted by C for D's review. The datasets come live from the
// `sources` table; every method number is read from engine/config.ts, so this page can't drift
// from the code. Dedupe and freshness numbers are the worker's (apps/worker/src/pipeline).

export const metadata: Metadata = { title: t("layout.nav.data") };
export const dynamic = "force-dynamic";

const d = (key: string, params?: Record<string, string | number>) =>
  t(`dataPage.${key}` as MessageKey, params);

/** Keys of a numbered list in en.json ("1", "2", …), in order. */
const items = (list: Record<string, string>) => Object.keys(list);

const oneDecimal = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 1 });

const SECTIONS = [
  "datasets",
  "listings",
  "rent",
  "score",
  "travel",
  "safety",
  "ai",
  "limits",
] as const;

/** Worker constants shown here (dedupe.ts DEDUPE.maxBelowNextCopy, scrub.ts EXCERPT_MAX). */
const WORKER = { belowNextPct: 15, excerptMax: 280 };

async function loadData(): Promise<{ sources: DataSource[]; sites: ListingSite[] } | null> {
  try {
    const sql = getClient();
    return sql ? await loadDataPage(sql) : null;
  } catch {
    return null;
  }
}

function Section({ id, children }: { id: (typeof SECTIONS)[number]; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-20">
      <h2 id={`${id}-heading`} className="mb-3 text-xl font-semibold tracking-tight">
        {d(`sections.${id}`)}
      </h2>
      <div className="flex flex-col gap-3 text-sm leading-relaxed">{children}</div>
    </section>
  );
}

function Rules({
  list,
  prefix,
  params,
}: {
  list: Record<string, string>;
  prefix: string;
  params?: Record<string, string | number>;
}) {
  return (
    <ul className="list-disc space-y-1.5 pl-5">
      {items(list).map((key) => (
        <li key={key}>{d(`${prefix}.${key}`, params)}</li>
      ))}
    </ul>
  );
}

export default async function DataPage() {
  const data = await loadData();
  const w = engineConfig.weights;
  const km = (m: number) => `${formatCount(m / 1000)} km`;
  const radii = VALUATION.radiiM.map(km).join(", ");

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 py-10">
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">{d("title")}</h1>
        <p className="text-muted-foreground">{d("intro")}</p>
        <nav aria-label={d("contents")} className="flex flex-wrap gap-2 pt-1">
          {SECTIONS.map((id) => (
            <a
              key={id}
              href={`#${id}`}
              className="bg-muted hover:bg-accent rounded-full px-3 py-1 text-xs font-medium"
            >
              {d(`sections.${id}`)}
            </a>
          ))}
        </nav>
      </header>

      <Section id="datasets">
        <p>{d("datasets.intro")}</p>
        {data ? (
          <ul className="flex flex-col divide-y rounded-xl border">
            {data.sources.map((source) => (
              <li key={source.id} className="flex flex-col gap-1 p-4">
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-medium underline-offset-2 hover:underline"
                >
                  {source.title}
                  <ExternalLink aria-hidden className="size-3.5 shrink-0" />
                </a>
                {source.id in en.dataPage.datasets.usedFor && (
                  <p>{d(`datasets.usedFor.${source.id}`)}</p>
                )}
                <p className="text-muted-foreground text-xs">
                  {[
                    source.licence,
                    source.period ? d("datasets.period", { period: source.period }) : null,
                    d("datasets.retrieved", { date: formatDate(source.retrievedAt) }),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">{d("datasets.unavailable")}</p>
        )}
      </Section>

      <Section id="listings">
        <p>{d("listings.intro")}</p>
        {data && data.sites.length > 0 && (
          <ul className="flex flex-col divide-y rounded-xl border">
            {data.sites.map((site) => (
              <li
                key={site.source}
                className="flex flex-wrap items-baseline justify-between gap-2 p-4"
              >
                <span className="font-medium">
                  {t(`results.sources.${site.source}` as MessageKey)}
                </span>
                <span className="text-muted-foreground figures text-xs">
                  {d("listings.site", {
                    shown: formatCount(site.shown),
                    when: site.newestSeenAt ? formatDate(site.newestSeenAt) : "—",
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
        <Rules
          list={en.dataPage.listings.rules}
          prefix="listings.rules"
          params={{
            excerpt: WORKER.excerptMax,
            belowNext: WORKER.belowNextPct,
            staleDays: CAVEATS.staleDays,
          }}
        />
      </Section>

      <Section id="rent">
        <p>{d("rent.intro")}</p>
        <Rules
          list={en.dataPage.rent.rules}
          prefix="rent.rules"
          params={{
            bathrooms: VALUATION.maxBathroomDifference,
            windowDays: VALUATION.windowDays,
            radii,
            minComparables: VALUATION.minComparables,
            perBuilding: VALUATION.maxPerBuilding,
            utilities: formatCad(VALUATION.adjustmentsCad.utilitiesIncluded),
            parking: formatCad(VALUATION.adjustmentsCad.parking),
            furnished: formatCad(VALUATION.adjustmentsCad.furnished),
            laundry: formatCad(VALUATION.adjustmentsCad.laundryInSuite),
            band: VALUATION.labelBandPct.medium,
            lowBand: VALUATION.labelBandPct.low,
            farBelow: CAVEATS.farBelowPct,
          }}
        />
      </Section>

      <Section id="score">
        <p>{d("score.intro")}</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            {d("score.parts.value", { weight: w.value, fairness: engineConfig.fairnessWeight })}
          </li>
          <li>{d("score.parts.price", { weight: w.price })}</li>
          <li>{d("score.parts.travel", { weight: w.travel })}</li>
          <li>{d("score.parts.home", { weight: w.home })}</li>
          <li>{d("score.parts.safety", { weight: engineConfig.safetyWeight })}</li>
        </ul>
        <Rules list={en.dataPage.score.rules} prefix="score.rules" />
      </Section>

      <Section id="travel">
        <p>{d("travel.intro")}</p>
        <ul className="list-disc space-y-1.5 pl-5">
          {(["transit", "walk", "bike", "drive"] as const).map((mode) => {
            const m = engineConfig.travelEstimate[mode];
            return (
              <li key={mode}>
                {d(m.overheadMinutes ? "travel.mode" : "travel.modeNoOverhead", {
                  mode: d(`modes.${mode}`),
                  speed: oneDecimal.format(m.speedKmh),
                  detour: m.routeFactor,
                  overhead: m.overheadMinutes,
                })}
              </li>
            );
          })}
        </ul>
        <p className="text-muted-foreground">{d("travel.note")}</p>
      </Section>

      <Section id="safety">
        <p>{d("safety.body")}</p>
      </Section>

      <Section id="ai">
        <Rules list={en.dataPage.ai.rules} prefix="ai.rules" />
      </Section>

      <Section id="limits">
        <Rules list={en.dataPage.limits.rules} prefix="limits.rules" />
      </Section>
    </div>
  );
}
