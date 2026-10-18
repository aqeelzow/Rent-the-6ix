"use client";

import {
  Bus,
  GraduationCap,
  Library,
  Pill,
  School,
  ShoppingCart,
  Stethoscope,
  TrainFront,
  Trees,
  Users,
  type LucideIcon,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { t, type MessageKey } from "@/lib/format/messages";
import { DetailSection, Disclosure } from "./detail-sections";
import { formatDistance, moreRows, nearestRows, tileRows, type NearbyRow } from "./nearby-data";
import type { NearbyState } from "./use-nearby";

const n = (key: string, params?: Record<string, string | number>) =>
  t(`listing.nearby.${key}` as MessageKey, params);

const ICONS: Record<NearbyRow["kind"], LucideIcon> = {
  grocery: ShoppingCart,
  pharmacy: Pill,
  park: Trees,
  school: School,
  library: Library,
  clinic: Stethoscope,
  community_centre: Users,
  university: GraduationCap,
  stop: Bus,
  rapid: TrainFront,
};

/** A place's name, with elementary/secondary for schools. */
function PlaceName({ row }: { row: NearbyRow }) {
  return (
    <span className="min-w-0 truncate" title={row.name}>
      {row.name}
      {row.detail && <span className="text-muted-foreground"> · {n(`school.${row.detail}`)}</span>}
    </span>
  );
}

/** One line: what it is, the nearest one's name under it, and how far (the same layout as the tile). */
function Row({ row }: { row: NearbyRow }) {
  const Icon = ICONS[row.kind];
  return (
    <li className="flex items-center gap-3 py-2">
      <Icon aria-hidden className="text-muted-foreground size-4 shrink-0" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm">{n(`nearest.${row.kind}`)}</span>
        <span className="text-muted-foreground text-xs break-words">
          {row.name}
          {row.detail && <> · {n(`school.${row.detail}`)}</>}
        </span>
      </span>
      <span className="figures shrink-0 text-sm font-medium">{formatDistance(row.distanceM)}</span>
    </li>
  );
}

/**
 * Nearby (SPEC 11.3): the nearest place of each kind and the nearest TTC stop and station, one line
 * each; the next places fold under "Show more nearby". Straight-line distances only, never minutes
 * (travel times are in "Getting around").
 */
export function NearbySection({ state, className }: { state: NearbyState; className?: string }) {
  const more = state.status === "ok" ? moreRows(state.nearby) : [];
  return (
    <DetailSection id="nearby" title={t("listing.sections.nearby")} className={className}>
      {state.status === "loading" && (
        <div className="flex flex-col gap-2" aria-busy="true">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-6 rounded-md" />
          ))}
        </div>
      )}
      {state.status === "error" && (
        <p className="text-muted-foreground text-sm">{n("unavailable")}</p>
      )}
      {state.status === "ok" && (
        <>
          <ul className="-my-2 divide-y">
            {nearestRows(state.nearby).map((row) => (
              <Row key={row.kind} row={row} />
            ))}
          </ul>
          {more.length > 0 && (
            <Disclosure label={n("more")}>
              <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                {more.map((group) => (
                  <section key={group.kind} aria-label={n(`categories.${group.kind}`)}>
                    <h3 className="text-sm font-medium">{n(`categories.${group.kind}`)}</h3>
                    <ul className="divide-y">
                      {group.rows.map((row) => (
                        <li
                          key={`${row.name}-${row.distanceM}`}
                          className="flex items-baseline justify-between gap-3 py-1.5 text-sm"
                        >
                          <PlaceName row={row} />
                          <span className="figures shrink-0">{formatDistance(row.distanceM)}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            </Disclosure>
          )}
          <p className="text-muted-foreground text-xs">
            {n("note")}
            {state.nearby.locationPrecision !== "exact" && ` ${n("approximate")}`}
          </p>
        </>
      )}
    </DetailSection>
  );
}

/** The summary tile: nearest grocery, subway or rail station and park, at a glance. */
export function NearbyTile({ state }: { state: NearbyState }) {
  const rows = state.status === "ok" ? tileRows(state.nearby) : [];
  return (
    <section className="bg-card flex flex-col gap-3 rounded-2xl border p-5">
      <h2 className="font-medium">{t("listing.sections.nearby")}</h2>
      {state.status === "loading" ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-7 rounded-md" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">{n("unavailable")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => {
            const Icon = ICONS[row.kind];
            return (
              <li key={row.kind} className="flex items-center gap-3">
                <Icon aria-hidden className="text-muted-foreground size-5 shrink-0" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-sm">{n(`nearest.${row.kind}`)}</span>
                  <span className="text-muted-foreground truncate text-xs" title={row.name}>
                    {row.name}
                  </span>
                </span>
                <span className="figures text-xl font-semibold">
                  {formatDistance(row.distanceM)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-muted-foreground mt-auto text-xs">{n("tileNote")}</p>
    </section>
  );
}
