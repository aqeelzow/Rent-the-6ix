import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getClient } from "@/lib/db";
import {
  loadBuilding,
  RENT_HISTORY_DAYS,
  type BuildingPage,
  type UnitGroup,
} from "@/lib/db/building";
import { formatDate } from "@/lib/format/date";
import { t, type MessageKey } from "@/lib/format/messages";
import { formatCad } from "@/lib/format/number";

export const dynamic = "force-dynamic";

const b = (key: string, params?: Record<string, string | number>) =>
  t(`building.${key}` as MessageKey, params);

async function load(slug: string): Promise<BuildingPage | null | "unavailable"> {
  try {
    const sql = getClient();
    return sql ? await loadBuilding(sql, slug) : "unavailable";
  } catch {
    return "unavailable";
  }
}

export async function generateMetadata({
  params,
}: PageProps<"/building/[slug]">): Promise<Metadata> {
  const building = await load((await params).slug);
  return { title: building && building !== "unavailable" ? building.name : b("title") };
}

const unitLabel = (group: UnitGroup) =>
  group === "room"
    ? b("units.room")
    : group === 0
      ? b("units.studio")
      : b("units.beds", { n: group === 4 ? "4+" : group });

/** A catalogue building (#30): its addresses, listings in it now and past asking rents. */
export default async function BuildingRoute({ params }: PageProps<"/building/[slug]">) {
  const building = await load((await params).slug);
  if (building === null) notFound();
  if (building === "unavailable")
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10">
        <p className="text-muted-foreground">{b("unavailable")}</p>
      </div>
    );

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 py-10">
      <header className="flex flex-col gap-2">
        {building.kind && (
          <p className="text-muted-foreground text-sm font-medium">{b(`kind.${building.kind}`)}</p>
        )}
        <h1 className="text-3xl font-semibold tracking-tight">{building.name}</h1>
        <p className="text-muted-foreground">{building.addresses.join(" · ")}, Waterloo</p>
      </header>

      <section aria-labelledby="now-title" className="flex flex-col gap-3">
        <h2 id="now-title" className="text-xl font-semibold tracking-tight">
          {b("now.title", { n: building.listings.length })}
        </h2>
        {building.listings.length === 0 ? (
          <p className="text-muted-foreground text-sm">{b("now.none")}</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-xl border">
            {building.listings.map((listing) => (
              <li key={listing.id}>
                <Link
                  href={`/listing/${listing.id}`}
                  className="hover:bg-accent focus-visible:ring-ring/50 flex items-center justify-between gap-4 p-4 outline-none focus-visible:ring-3"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-medium">{listing.title}</span>
                    <span className="text-muted-foreground text-sm">
                      {listing.rentIsPerRoom || listing.unitType === "room"
                        ? b("units.room")
                        : listing.bedrooms === null
                          ? b("units.unknown")
                          : listing.bedrooms === 0
                            ? b("units.studio")
                            : b("units.beds", { n: listing.bedrooms })}
                    </span>
                  </span>
                  <span className="figures shrink-0 font-semibold">
                    {b("perMonth", { amount: formatCad(listing.monthlyRentCad) })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="rents-title" className="flex flex-col gap-3">
        <h2 id="rents-title" className="text-xl font-semibold tracking-tight">
          {b("rents.title")}
        </h2>
        <p className="text-muted-foreground text-sm">
          {b("rents.intro", { days: RENT_HISTORY_DAYS })}
        </p>
        {building.rents.length === 0 ? (
          <p className="text-muted-foreground text-sm">{b("rents.none")}</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border">
            <table className="figures w-full text-sm">
              <thead className="text-muted-foreground text-left">
                <tr>
                  <th className="p-3 font-medium">{b("rents.unit")}</th>
                  <th className="p-3 font-medium">{b("rents.median")}</th>
                  <th className="p-3 font-medium">{b("rents.range")}</th>
                  <th className="p-3 font-medium">{b("rents.listings")}</th>
                  <th className="p-3 font-medium">{b("rents.seen")}</th>
                </tr>
              </thead>
              <tbody>
                {building.rents.map((r) => (
                  <tr key={String(r.group)} className="border-t">
                    <td className="p-3 font-medium">{unitLabel(r.group)}</td>
                    <td className="p-3">{formatCad(r.median)}</td>
                    <td className="p-3">
                      {r.low === r.high
                        ? formatCad(r.low)
                        : `${formatCad(r.low)}–${formatCad(r.high)}`}
                    </td>
                    <td className="p-3">{r.listings}</td>
                    <td className="p-3 whitespace-nowrap">
                      {r.from === r.to
                        ? formatDate(r.from)
                        : `${formatDate(r.from)} – ${formatDate(r.to)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-muted-foreground text-xs">{b("rents.note")}</p>
      </section>
    </div>
  );
}
