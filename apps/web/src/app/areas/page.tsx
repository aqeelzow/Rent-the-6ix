import type { Metadata } from "next";
import Link from "next/link";
import { t } from "@/lib/format/messages";

export const metadata: Metadata = { title: t("layout.nav.areas") };

const wards = Array.from({ length: 25 }, (_, i) => i + 1);

/** The explorer map (P3.20) is still to come; meanwhile each ward's page is one tap away. */
export default function AreasPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t("layout.nav.areas")}</h1>
        <p className="text-muted-foreground">{t("areas.mapPending")}</p>
      </div>
      <section aria-labelledby="wards-title" className="flex flex-col gap-3">
        <h2 id="wards-title" className="text-lg font-semibold tracking-tight">
          {t("areas.wardsTitle")}
        </h2>
        <p className="text-muted-foreground text-sm">{t("areas.wardsIntro")}</p>
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {wards.map((n) => (
            <li key={n}>
              <Link
                href={`/areas/ward/${n}`}
                className="bg-card hover:bg-accent focus-visible:ring-ring/50 figures block rounded-lg border px-3 py-2 text-center text-sm font-medium outline-none focus-visible:ring-3"
              >
                {t("areas.ward.title", { n })}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
