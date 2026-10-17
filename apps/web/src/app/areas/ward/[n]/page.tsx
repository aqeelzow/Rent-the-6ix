import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { WardView } from "@/components/areas/ward-view";
import { getClient } from "@/lib/db";
import { loadAreaFacts } from "@/lib/db/area-facts";
import { t } from "@/lib/format/messages";

/** Toronto has 25 city wards; `/areas/ward/10` (and `/areas/ward/010` redirects there). */
const WARD_COUNT = 25;

function wardNumber(param: string): number | null {
  if (!/^\d{1,3}$/.test(param)) return null;
  const n = Number(param);
  return n >= 1 && n <= WARD_COUNT ? n : null;
}

export async function generateMetadata({
  params,
}: PageProps<"/areas/ward/[n]">): Promise<Metadata> {
  const n = wardNumber((await params).n);
  return { title: n === null ? t("layout.nav.areas") : t("areas.ward.title", { n }) };
}

export default async function WardPage({ params }: PageProps<"/areas/ward/[n]">) {
  const { n: param } = await params;
  const n = wardNumber(param);
  if (n === null) notFound();
  if (param !== String(n)) redirect(`/areas/ward/${n}`);
  // The election box switches to official results after election day, so render per request.
  await connection();
  // D's facts give the header and the "at a glance" table.
  const sql = getClient();
  const facts = sql
    ? await loadAreaFacts(sql, "ward", String(n).padStart(2, "0")).catch(() => null)
    : null;
  return <WardView n={n} facts={facts} />;
}
