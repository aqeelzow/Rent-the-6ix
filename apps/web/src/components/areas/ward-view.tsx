import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { DetailSection } from "@/components/listing/detail-sections";
import { t, type MessageKey } from "@/lib/format/messages";
import { ElectionBox } from "./election-box";

const w = (key: string, params?: Record<string, string | number>) =>
  t(`areas.ward.${key}` as MessageKey, params);

/**
 * `/areas/ward/[n]` (SPEC 9.3): "Housing in your ward", the figures it was written from, and the
 * election info box. The briefing waits for B's briefing route (P3.3) and the figures for D's ward
 * indicators; until then each section says so plainly.
 */
export function WardView({ n }: { n: number }) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8">
      <div className="flex flex-col gap-2">
        <Link
          href="/areas"
          className="text-primary inline-flex items-center gap-1 self-start text-sm font-medium underline-offset-4 hover:underline"
        >
          <ArrowLeft aria-hidden className="size-4" />
          {t("layout.nav.areas")}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{w("title", { n })}</h1>
        <p className="text-muted-foreground max-w-prose">{w("intro")}</p>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {/* The election box comes first on phones (it's short and time-sensitive) and sits
            beside the briefing on wide screens. */}
        <div className="lg:sticky lg:top-20 lg:order-last">
          <ElectionBox />
        </div>
        <div className="flex flex-col gap-6">
          <DetailSection id="briefing" title={w("briefingTitle")}>
            <p className="text-muted-foreground text-sm">{w("briefingPending")}</p>
          </DetailSection>
          <DetailSection id="figures" title={w("figuresTitle")}>
            <p className="text-muted-foreground text-sm">{w("figuresPending")}</p>
          </DetailSection>
        </div>
      </div>
    </div>
  );
}
