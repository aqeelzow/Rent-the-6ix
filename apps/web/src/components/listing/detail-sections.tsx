"use client";

import { CircleHelp, ExternalLink, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { modeIcons } from "@/components/mode-icons";
import { SafetyInfoButton } from "@/components/safety/safety-info";
import { PriceBadge } from "@/components/results/price-badge";
import {
  daysSince,
  plainHardFilterNote,
  priceSummary,
  yearSpan,
} from "@/components/results/card-data";
import { formatDaysAgo } from "@/lib/format/date";
import { t, type MessageKey } from "@/lib/format/messages";
import { formatCad, formatCount } from "@/lib/format/number";
import { redactIntent } from "@/lib/store/actions";
import type { DetailResponse, SearchIntent, SearchResultItem } from "@/lib/store/types";
import { homeFields, scoreBreakdown, travelTable, type ModeTime } from "./detail-data";

// The sections of the listing detail page, in SPEC 11.3 order. Every figure comes from B's,
// C's or D's data; these components only word and arrange it.

const l = (key: string, params?: Record<string, string | number>) =>
  t(`listing.${key}` as MessageKey, params);
const decimal = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 1 });
const km = (metres: number) => decimal.format(metres / 1000);

const partColors = {
  value: "bg-score-value",
  price: "bg-score-price",
  travel: "bg-score-travel",
  home: "bg-score-home",
  safety: "bg-score-safety",
} as const;

const caveatStyles = {
  info: "bg-caveat-info text-caveat-info-foreground",
  warning: "bg-caveat-warning text-caveat-warning-foreground",
  high: "bg-caveat-high text-caveat-high-foreground",
} as const;

export function DetailSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby={`${id}-title`}
      className="bg-card flex flex-col gap-4 rounded-xl border p-4 sm:p-5"
    >
      <h2 id={`${id}-title`} className="text-lg font-semibold tracking-tight">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** P2.36: score breakdown whose bars add up to the total, with each part's evidence. */
export function WhyItRanks({
  result,
  intent,
}: {
  result: SearchResultItem;
  intent: SearchIntent | null;
}) {
  const { total, parts, omitted } = scoreBreakdown(result.matchScore);
  return (
    <DetailSection id="why" title={l("sections.why")}>
      <ExplanationSlot listingId={result.listing.id} intent={intent} />
      <p className="figures text-2xl font-semibold">{l("why.total", { total })}</p>
      <div aria-hidden className="bg-muted flex h-3 overflow-hidden rounded-full">
        {parts.map((part) => (
          <span
            key={part.id}
            className={`${partColors[part.id]} h-full`}
            style={{ width: `${part.points}%` }}
          />
        ))}
      </div>
      <ul className="flex flex-col gap-4">
        {parts.map((part) => (
          <li key={part.id} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="flex items-center gap-2 font-medium">
                <span aria-hidden className={`size-3 rounded-sm ${partColors[part.id]}`} />
                {t(`results.parts.${part.id}` as MessageKey)}
              </span>
              <span className="figures text-muted-foreground text-sm">
                {l("why.part", {
                  score: formatCount(part.score),
                  weight: formatCount(part.effectiveWeight * 100),
                })}{" "}
                ={" "}
                <span className="text-foreground font-semibold">
                  {l("why.points", { points: formatCount(part.points) })}
                </span>
              </span>
            </div>
            <div aria-hidden className="bg-muted h-1.5 overflow-hidden rounded-full">
              <div
                className={`${partColors[part.id]} h-full`}
                style={{ width: `${part.score}%` }}
              />
            </div>
            {part.evidence.length > 0 && (
              <ul className="text-muted-foreground list-disc pl-5 text-sm">
                {part.evidence.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground text-xs">
        {l("why.sum")}
        {omitted.length > 0 &&
          ` ${l("why.omitted", { parts: omitted.map((id) => t(`results.parts.${id}` as MessageKey)).join(", ") })}`}
      </p>
    </DetailSection>
  );
}

/**
 * Slot for B's grounded explanation (SPEC 10.2, P3.1). Shows nothing until the route answers;
 * the renter's own words are never sent (redacted intent).
 */
function ExplanationSlot({
  listingId,
  intent,
}: {
  listingId: string;
  intent: SearchIntent | null;
}) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/listings/${encodeURIComponent(listingId)}/explain`, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(intent ? { intent: redactIntent(intent) } : {}),
    })
      .then(async (response) => {
        if (!response.ok) return;
        const body: unknown = await response.json();
        const explanation = (body as { explanation?: unknown })?.explanation;
        if (typeof explanation === "string" && explanation.trim()) setText(explanation.trim());
      })
      .catch(() => {});
    return () => controller.abort();
  }, [listingId, intent]);
  if (!text) return null;
  return (
    <div className="bg-accent flex gap-2 rounded-lg p-3 text-sm">
      <Sparkles aria-hidden className="text-primary mt-0.5 size-4 shrink-0" />
      <p>
        <span className="sr-only">{l("explanation")}: </span>
        {text}
      </p>
    </div>
  );
}

/** P2.31: price label, estimate, range, difference, confidence, comparables, adjustments, benchmark. */
export function RentCheck({ result, now }: { result: SearchResultItem; now: number }) {
  const { valuation, listing } = result;
  const summary = priceSummary(valuation);
  const comparables = [...valuation.comparables]
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, 10);

  return (
    <DetailSection id="rent" title={l("sections.rent")}>
      <PriceBadge valuation={valuation} />
      {valuation.status === "ok" && summary.label !== "unknown" ? (
        <dl className="figures grid gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground text-sm">{l("rent.estimate")}</dt>
            <dd className="text-xl font-semibold">{formatCad(valuation.estimatedRentCad!)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-sm">{l("rent.range")}</dt>
            <dd className="text-xl font-semibold">
              {formatCad(valuation.lowCad!)}–{formatCad(valuation.highCad!)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-sm">{l("rent.difference")}</dt>
            <dd className="font-medium">
              {summary.direction === "in_line"
                ? l("rent.inLine")
                : l(`rent.${summary.direction}`, {
                    amount: formatCad(Math.abs(valuation.differenceCad!)),
                    percent: formatCount(summary.percent),
                  })}
            </dd>
          </div>
        </dl>
      ) : null}
      <p className="text-sm">
        {valuation.status === "ok"
          ? l("rent.basis", {
              count: formatCount(valuation.comparableCount),
              km: km(valuation.radiusM),
              days: valuation.windowDays,
              confidence: t(`results.price.confidence.${valuation.confidence}` as MessageKey),
            })
          : l("rent.thin", {
              count: formatCount(valuation.comparableCount),
              km: km(valuation.radiusM),
            })}
      </p>

      {comparables.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="font-medium">{l("rent.comparables")}</h3>
          <div className="overflow-x-auto">
            <table className="figures w-full text-sm">
              <thead className="text-muted-foreground text-left">
                <tr>
                  <th className="py-1 pr-3 font-normal">{l("rent.colRent")}</th>
                  <th className="py-1 pr-3 font-normal">{l("rent.colAdjusted")}</th>
                  <th className="py-1 pr-3 font-normal">{l("rent.colDistance")}</th>
                  <th className="py-1 pr-3 font-normal">{l("rent.colSeen")}</th>
                  <th className="py-1 font-normal">
                    <span className="sr-only">{l("rent.view")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {comparables.map((comparable) => (
                  <tr key={comparable.listingId} className="border-t">
                    <td className="py-1.5 pr-3">{formatCad(comparable.rentCad)}</td>
                    <td className="py-1.5 pr-3">{formatCad(comparable.adjustedRentCad)}</td>
                    <td className="py-1.5 pr-3">{km(comparable.distanceM)} km</td>
                    <td className="py-1.5 pr-3">
                      {formatDaysAgo(daysSince(comparable.lastSeenAt, now))}
                    </td>
                    <td className="py-1.5">
                      <Link
                        href={`/listing/${comparable.listingId}`}
                        className="text-primary underline-offset-4 hover:underline"
                      >
                        {l("rent.view")}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-muted-foreground text-xs">{l("rent.mapNote")}</p>
        </div>
      )}

      {valuation.adjustments.length > 0 && (
        <div className="flex flex-col gap-1">
          <h3 className="font-medium">{l("rent.adjustments")}</h3>
          <ul className="figures text-sm">
            {valuation.adjustments.map((adjustment) => (
              <li key={adjustment.label} className="flex justify-between gap-3">
                <span>{adjustment.label}</span>
                <span>
                  {adjustment.amountCad > 0 ? "+" : "−"}
                  {formatCad(Math.abs(adjustment.amountCad))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-1 text-sm">
        <h3 className="font-medium">{l("rent.benchmark")}</h3>
        <p className={valuation.benchmark ? "figures" : "text-muted-foreground"}>
          {valuation.benchmark
            ? l("rent.benchmarkValue", {
                label: valuation.benchmark.label,
                value: formatCad(valuation.benchmark.valueCad),
                period: valuation.benchmark.period,
              })
            : l("rent.benchmarkNone")}
        </p>
      </div>
      <p className="text-muted-foreground text-xs">{l("rent.asking")}</p>
      {listing.rentIsPerRoom && (
        <p className="text-muted-foreground text-xs">{t("results.perRoom")}</p>
      )}
    </DetailSection>
  );
}

/** P2.33: every unit field; unknowns say "Not stated", never "no". */
export function TheHome({ result }: { result: SearchResultItem }) {
  return (
    <DetailSection id="home" title={l("sections.home")}>
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {homeFields(result.listing).map((field) => (
          <div key={field.key} className="flex flex-col">
            <dt className="text-muted-foreground text-sm">{field.label}</dt>
            <dd className="figures">
              {field.value ?? (
                <span className="text-muted-foreground flex items-center gap-1.5">
                  <CircleHelp aria-hidden className="size-3.5" />
                  {l("values.notStated")}
                </span>
              )}
              {field.value && field.aiRead && (
                <span className="text-muted-foreground ml-2 text-xs">({l("values.aiRead")})</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </DetailSection>
  );
}

function modeTimeText(time: ModeTime): string {
  if (time.kind === "routed") {
    return l(time.mode === "drive" ? "travel.routedDrive" : "travel.routed", {
      minutes: formatCount(time.minutes),
    });
  }
  if (time.kind === "straight_line") return l("travel.straightLine", { km: km(time.distanceM) });
  return l("travel.missing");
}

/** P2.32: each travel target in all four modes; the renter's mode highlighted; honest labels. */
export function GettingAround({
  result,
  targets,
}: {
  result: SearchResultItem;
  targets: SearchIntent["travelTargets"];
}) {
  const table = travelTable(targets, result.travel);
  return (
    <DetailSection id="travel" title={l("sections.travel")}>
      {table.length === 0 ? (
        <p className="text-muted-foreground text-sm">{l("travel.none")}</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {table.map((target) => (
            <li key={target.id} className="flex flex-col gap-2">
              <h3 className="font-medium">{target.label}</h3>
              <ul className="grid gap-1.5 sm:grid-cols-2">
                {target.modes.map((time) => {
                  const Icon = modeIcons[time.mode];
                  const chosen = target.chosen.includes(time.mode);
                  return (
                    <li
                      key={time.mode}
                      className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm ${chosen ? "border-primary" : ""}`}
                    >
                      <span className="flex items-center gap-2">
                        <Icon aria-hidden className="text-muted-foreground size-4" />
                        <span className="capitalize">
                          {t(`filters.modes.${time.mode}` as MessageKey)}
                        </span>
                        {chosen && (
                          <span className="bg-primary text-primary-foreground rounded-full px-1.5 py-px text-[0.65rem] font-medium">
                            {l("travel.chosen")}
                          </span>
                        )}
                      </span>
                      <span
                        className={
                          time.kind === "routed" ? "figures font-medium" : "text-muted-foreground"
                        }
                      >
                        {modeTimeText(time)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
      <p className="text-muted-foreground text-xs">{l("travel.note")}</p>
    </DetailSection>
  );
}

/** Safety (only when the renter turned it on): the rate as given, always with its caveats. */
export function SafetySection({ result }: { result: SearchResultItem }) {
  const { safety } = result;
  return (
    <DetailSection id="safety" title={l("sections.safety")}>
      <p className="figures text-sm">
        {safety && safety.relativeRate !== null
          ? l("safety.rate", {
              rate: decimal.format(safety.relativeRate),
              years: yearSpan(safety.years),
            })
          : l("safety.noData")}
      </p>
      {safety && Object.values(safety.byType).some((value) => value !== null) && (
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium">{l("safety.byType")}</h3>
          <dl className="figures grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
            {Object.entries(safety.byType).map(([type, value]) => (
              <div key={type} className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{l(`safety.types.${type}`)}</dt>
                <dd>{value === null ? "–" : decimal.format(value)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      <SafetyInfoButton caveats={safety?.caveats} className="self-start text-sm" />
    </DetailSection>
  );
}

/** P2.34: the RentSafeTO record (D's data; not delivered yet, so an honest placeholder). */
export function BuildingSection() {
  return (
    <DetailSection id="building" title={l("sections.building")}>
      <p className="text-muted-foreground text-sm">{l("building.none")}</p>
    </DetailSection>
  );
}

/** A readable name for one of D's indicator ids; an unknown id is shown as it is. */
function indicatorLabel(id: string): string {
  const key = `listing.indicators.${id}`;
  const label = t(key as MessageKey);
  return label === key ? id : label;
}

/** P2.34: neighbourhood and ward with their indicators (SPEC 9.1), from the detail route. */
export function AreaCard({ extras }: { extras: DetailResponse | null }) {
  const areas = extras?.areas ?? [];
  const indicators = extras?.indicators ?? [];
  return (
    <DetailSection id="area" title={l("sections.area")}>
      {areas.length === 0 && indicators.length === 0 ? (
        <p className="text-muted-foreground text-sm">{l("area.none")}</p>
      ) : (
        <>
          {areas.length > 0 && (
            <p className="font-medium">{areas.map((area) => area.name).join(" · ")}</p>
          )}
          <dl className="flex flex-col gap-3">
            {indicators.map((indicator) => (
              <div key={`${indicator.areaId}-${indicator.indicatorId}`} className="flex flex-col">
                <dt className="text-sm">{indicatorLabel(indicator.indicatorId)}</dt>
                <dd className="figures font-medium">
                  {indicator.value === null
                    ? t("results.price.unknown")
                    : l("area.indicator", {
                        value: decimal.format(indicator.value),
                        unit: indicator.unit,
                      })}
                  <span className="text-muted-foreground block text-xs font-normal">
                    {l("area.source", { period: indicator.period, source: indicator.sourceId })}
                    {indicator.sampleSize !== undefined &&
                      ` · ${l("area.sample", { n: formatCount(indicator.sampleSize) })}`}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </DetailSection>
  );
}

/** Things to check (SPEC 7.7): every caveat with its severity and plain explanation. */
export function ThingsToCheck({ result }: { result: SearchResultItem }) {
  const { caveats, hardFilterNotes } = result.matchScore;
  return (
    <>
      <DetailSection id="check" title={l("sections.check")}>
        {caveats.length === 0 ? (
          <p className="text-muted-foreground text-sm">{l("check.none")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {caveats.map((caveat) => (
              <li key={caveat.code} className="flex flex-col items-start gap-1">
                <span
                  className={`rounded-md px-2 py-0.5 text-xs font-medium ${caveatStyles[caveat.severity]}`}
                >
                  {caveat.title}
                </span>
                <span className="text-sm">{caveat.explanation}</span>
              </li>
            ))}
          </ul>
        )}
      </DetailSection>
      {hardFilterNotes.length > 0 && (
        <DetailSection id="unconfirmed" title={l("sections.unconfirmed")}>
          <ul className="text-caveat-warning-foreground list-disc pl-5 text-sm">
            {hardFilterNotes.map((note) => (
              <li key={note}>{plainHardFilterNote(note)}</li>
            ))}
          </ul>
        </DetailSection>
      )}
    </>
  );
}

/** "View on Kijiji" — renters contact landlords on the source site (SPEC 2.6). */
export function SourceButton({ result }: { result: SearchResultItem }) {
  const source = t(`results.sources.${result.listing.source}` as MessageKey);
  return (
    <a
      href={result.listing.sourceUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="bg-primary text-primary-foreground focus-visible:ring-ring/50 inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-medium outline-none hover:opacity-90 focus-visible:ring-3"
    >
      {l("viewOnSource", { source })}
      <ExternalLink aria-hidden className="size-4" />
    </a>
  );
}
