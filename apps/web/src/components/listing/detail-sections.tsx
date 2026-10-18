"use client";

import {
  ChevronDown,
  CircleHelp,
  ExternalLink,
  Info,
  OctagonAlert,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useEffect, useId, useState } from "react";
import { SafetyInfoButton } from "@/components/safety/safety-info";
import { daysSince, plainHardFilterNote, yearSpan } from "@/components/results/card-data";
import { formatDaysAgo } from "@/lib/format/date";
import { t, type MessageKey } from "@/lib/format/messages";
import { formatCad, formatCount } from "@/lib/format/number";
import { redactIntent } from "@/lib/store/actions";
import type { DetailResponse, SearchIntent, SearchResultItem } from "@/lib/store/types";
import { AdjustmentBars, PricePosition } from "./detail-charts";
import { homeFields } from "./detail-data";
import { ScoreBreakdown } from "@/components/results/score-breakdown";

// The sections of the listing detail page, in SPEC 11.3 order. Every figure comes from B's,
// C's or D's data; these components only word and arrange it.

const l = (key: string, params?: Record<string, string | number>) =>
  t(`listing.${key}` as MessageKey, params);
const decimal = new Intl.NumberFormat("en-CA", { maximumFractionDigits: 1 });
const km = (metres: number) => decimal.format(metres / 1000);

const caveatStyles = {
  info: "bg-caveat-info text-caveat-info-foreground",
  warning: "bg-caveat-warning text-caveat-warning-foreground",
  high: "bg-caveat-high text-caveat-high-foreground",
} as const;

export function DetailSection({
  id,
  title,
  className = "",
  children,
}: {
  id: string;
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby={`${id}-title`}
      className={`bg-card flex min-w-0 flex-col gap-4 rounded-2xl border p-5 ${className}`}
    >
      <h2 id={`${id}-title`} className="text-lg font-semibold tracking-tight">
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * P2.36: the score breakdown (shown on hover of the match score tile): B's plain explanation,
 * then each part's points, how they were reached and the evidence behind them.
 */
export function WhyItRanksContent({
  result,
  intent,
}: {
  result: SearchResultItem;
  intent: SearchIntent | null;
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="font-semibold">{l("sections.why")}</p>
      <ExplanationSlot listingId={result.listing.id} intent={intent} />
      <ScoreBreakdown matchScore={result.matchScore} />
    </div>
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
export function RentCheck({
  result,
  now,
  className,
}: {
  result: SearchResultItem;
  now: number;
  className?: string;
}) {
  const { valuation, listing } = result;
  const comparables = [...valuation.comparables]
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, 10);

  return (
    <DetailSection id="rent" title={l("sections.rent")} className={className}>
      {valuation.status === "ok" ? (
        <ul className="figures flex flex-wrap gap-2 text-sm">
          {[
            l("rent.chipCount", { count: formatCount(valuation.comparableCount) }),
            l("rent.chipRadius", { km: km(valuation.radiusM) }),
            l("rent.chipDays", { days: valuation.windowDays }),
            t(`results.price.confidence.${valuation.confidence}` as MessageKey),
          ].map((chip) => (
            <li key={chip} className="bg-muted rounded-full px-3 py-1">
              {chip}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">
          {l("rent.thin", { count: formatCount(valuation.comparableCount) })}
        </p>
      )}

      {valuation.comparables.length > 0 && (
        <PricePosition valuation={valuation} rent={listing.monthlyRentCad} />
      )}

      {valuation.adjustments.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">{l("rent.adjustments")}</h3>
          <AdjustmentBars adjustments={valuation.adjustments} />
        </div>
      )}

      {valuation.benchmark && (
        <p className="figures text-sm">
          {l("rent.benchmarkValue", {
            label: valuation.benchmark.label,
            value: formatCad(valuation.benchmark.valueCad),
            period: valuation.benchmark.period,
          })}
        </p>
      )}

      {comparables.length > 0 && (
        <Disclosure label={l("rent.comparables", { count: formatCount(comparables.length) })}>
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
        </Disclosure>
      )}
      <p className="text-muted-foreground text-xs">
        {l("rent.asking")}
        {listing.rentIsPerRoom && ` ${t("results.perRoom")}`}
      </p>
    </DetailSection>
  );
}

/** A quiet "show more" row: hidden detail stays one tap away without taking up the page. */
export function Disclosure({
  label,
  children,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();
  return (
    <div className="border-t pt-3">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => setExpanded((open) => !open)}
        className="text-muted-foreground hover:text-foreground flex w-full cursor-pointer items-center gap-1.5 rounded text-left text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
      >
        <ChevronDown
          aria-hidden
          className={`size-4 shrink-0 transition-transform duration-300 motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`}
        />
        {label}
      </button>
      <div
        id={contentId}
        aria-hidden={!expanded}
        inert={!expanded}
        className={`grid transition-[grid-template-rows] duration-300 ease-in-out motion-reduce:transition-none ${expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="pt-3">{children}</div>
        </div>
      </div>
    </div>
  );
}

/** Which facts go in which group: the place itself, what comes with it, and the terms. */
const homeGroups = {
  home: ["bedrooms", "bathrooms", "sqft", "unitType", "yearBuilt", "locationPrecision"],
  amenities: [
    "airConditioning",
    "parking",
    "laundryInSuite",
    "utilitiesIncluded",
    "furnished",
    "petsAllowed",
  ],
  terms: ["availableFrom", "leaseTerm"],
} as const;

/**
 * P2.33: the unit's facts in three short lists (home, amenities, other info). Known facts are
 * rows; unknowns fold into one "not stated" line per group.
 */
export function TheHome({ result, className }: { result: SearchResultItem; className?: string }) {
  const fields = homeFields(result.listing);
  return (
    <>
      {(Object.keys(homeGroups) as (keyof typeof homeGroups)[]).map((group) => (
        <FactsGroup
          key={group}
          id={`home-${group}`}
          title={l(`sections.${group === "home" ? "homeFacts" : group}`)}
          fields={fields.filter((field) =>
            (homeGroups[group] as readonly string[]).includes(field.key),
          )}
          className={className}
        />
      ))}
    </>
  );
}

function FactsGroup({
  id,
  title,
  fields,
  className,
}: {
  id: string;
  title: string;
  fields: ReturnType<typeof homeFields>;
  className?: string;
}) {
  const known = fields.filter((field) => field.value);
  const unknown = fields.filter((field) => !field.value);
  if (fields.length === 0) return null;
  return (
    <DetailSection id={id} title={title} className={className}>
      {known.length > 0 && (
        <dl className="flex flex-col divide-y text-sm">
          {known.map((field) => (
            <div key={field.key} className="flex items-baseline justify-between gap-4 py-2">
              <dt className="text-muted-foreground">{field.label}</dt>
              <dd className="figures text-right font-semibold">
                {field.value}
                {field.aiRead && (
                  <span className="text-muted-foreground block text-xs font-normal">
                    {l("values.aiRead")}
                  </span>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {unknown.length > 0 && (
        <Disclosure label={l("home.notStated", { count: formatCount(unknown.length) })}>
          <ul className="flex flex-wrap gap-2">
            {unknown.map((field) => (
              <li
                key={field.key}
                className="text-muted-foreground flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm"
              >
                <CircleHelp aria-hidden className="size-3.5" />
                {field.label}
                <span className="sr-only">: {l("values.notStated")}</span>
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
    </DetailSection>
  );
}

/** Safety (only when the renter turned it on): the rate as given, always with its caveats. */
export function SafetySection({
  result,
  className,
}: {
  result: SearchResultItem;
  className?: string;
}) {
  const { safety } = result;
  return (
    <DetailSection id="safety" title={l("sections.safety")} className={className}>
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

/** A readable name for one of D's indicator ids; an unknown id is shown as it is, capitalised. */
function indicatorLabel(id: string): string {
  const key = `listing.indicators.${id}`;
  const label = t(key as MessageKey);
  return label === key ? id.charAt(0).toUpperCase() + id.slice(1).replaceAll("_", " ") : label;
}

/**
 * P2.34: neighbourhood and ward facts (SPEC 9.1), as small tiles grouped by area. Each tile's
 * period, source and sample size sit behind an info button, so the figures stay traceable.
 */
export function AreaCard({
  extras,
  className,
}: {
  extras: DetailResponse | null;
  className?: string;
}) {
  const areas = extras?.areas ?? [];
  const indicators = extras?.indicators ?? [];
  // No area section is shown until area data is available.
  if (areas.length === 0 && indicators.length === 0) return null;
  const groups = [
    ...areas.map((area) => ({
      id: area.id,
      name: `${area.name} (${l(`area.kind.${area.kind}`)})`,
      items: indicators.filter((indicator) => indicator.areaId === area.id),
    })),
    {
      id: "other",
      name: null,
      items: indicators.filter((indicator) => !areas.some((area) => area.id === indicator.areaId)),
    },
  ].filter((group) => group.items.length > 0);

  return (
    <DetailSection id="area" title={l("sections.area")} className={className}>
      {groups.map((group) => (
        <div key={group.id} className="flex flex-col gap-2">
          {group.name && <h3 className="text-sm font-medium">{group.name}</h3>}
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
            {group.items.map((indicator) => (
              <div
                key={`${indicator.areaId}-${indicator.indicatorId}`}
                className="bg-accent flex flex-col gap-0.5 rounded-xl p-2.5"
              >
                <dt className="text-muted-foreground flex items-start justify-between gap-1 text-xs">
                  <span className="line-clamp-2">{indicatorLabel(indicator.indicatorId)}</span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        aria-label={l("area.sourceAria", {
                          label: indicatorLabel(indicator.indicatorId),
                        })}
                        className="hover:text-foreground focus-visible:ring-ring/50 -m-0.5 shrink-0 rounded p-0.5 outline-none focus-visible:ring-2"
                      >
                        <Info aria-hidden className="size-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="figures">
                      {l("area.source", { period: indicator.period, source: indicator.sourceId })}
                      {indicator.sampleSize !== undefined &&
                        `, ${l("area.sample", { n: formatCount(indicator.sampleSize) })}`}
                    </TooltipContent>
                  </Tooltip>
                </dt>
                <dd className="figures text-sm font-semibold">
                  {indicator.value === null
                    ? t("results.price.unknown")
                    : l("area.indicator", {
                        value: decimal.format(indicator.value),
                        unit: indicator.unit,
                      })}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </DetailSection>
  );
}

/**
 * Things to check (SPEC 7.7) as one banner across the page: each caveat is a short pill, and
 * hovering or tapping it opens the full explanation. Must-haves we couldn't confirm sit beside them.
 */
export function ThingsToCheck({
  result,
  className,
}: {
  result: SearchResultItem;
  className?: string;
}) {
  const { caveats, hardFilterNotes } = result.matchScore;
  const pills = [
    ...caveats.map((caveat) => ({
      key: caveat.code,
      severity: caveat.severity,
      title: caveat.title,
      detail: caveat.explanation,
    })),
    ...hardFilterNotes.map((note) => ({
      key: note,
      severity: "warning" as const,
      title: l("check.unconfirmed"),
      detail: plainHardFilterNote(note),
    })),
  ];
  return (
    <section
      aria-labelledby="check-title"
      className={`bg-card flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border px-5 py-3 ${className ?? ""}`}
    >
      <h2 id="check-title" className="font-semibold">
        {l("sections.check")}
      </h2>
      {pills.length === 0 ? (
        <p className="text-muted-foreground text-sm">{l("check.none")}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {pills.map((pill) => (
            <li key={pill.key}>
              <CheckPill severity={pill.severity} title={pill.title} detail={pill.detail} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const severityIcons = { info: Info, warning: TriangleAlert, high: OctagonAlert } as const;

function CheckPill({
  severity,
  title,
  detail,
}: {
  severity: keyof typeof caveatStyles;
  title: string;
  detail: string;
}) {
  const [open, setOpen] = useState(false);
  const Icon = severityIcons[severity];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        onPointerEnter={(event) => event.pointerType === "mouse" && setOpen(true)}
        onPointerLeave={(event) => event.pointerType === "mouse" && setOpen(false)}
        className={`focus-visible:ring-ring/50 flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium outline-none focus-visible:ring-3 ${caveatStyles[severity]}`}
      >
        <Icon aria-hidden className="size-3.5" />
        {title}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 text-sm">
        <p className="mb-1 font-semibold">{title}</p>
        <p className="text-muted-foreground">{detail}</p>
      </PopoverContent>
    </Popover>
  );
}

/** "View on Kijiji" — renters contact landlords on the source site (SPEC 2.6). */
export function SourceButton({ result, onDark }: { result: SearchResultItem; onDark?: boolean }) {
  const source = t(`results.sources.${result.listing.source}` as MessageKey);
  return (
    <a
      href={result.listing.sourceUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={`focus-visible:ring-ring/50 inline-flex h-10 items-center gap-2 rounded-full px-5 text-sm font-semibold outline-none hover:opacity-90 focus-visible:ring-3 ${onDark ? "bg-hero-foreground text-hero" : "bg-primary text-primary-foreground"}`}
    >
      {l("viewOnSource", { source })}
      <ExternalLink aria-hidden className="size-4" />
    </a>
  );
}
