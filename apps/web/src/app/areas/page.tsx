import type { Metadata } from "next";
import { t } from "@/lib/format/messages";

export const metadata: Metadata = { title: t("layout.nav.areas") };

/** The neighbourhood explorer (P3.20) is still to come. */
export default function AreasPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t("layout.nav.areas")}</h1>
        <p className="text-muted-foreground">{t("areas.mapPending")}</p>
      </div>
    </div>
  );
}
