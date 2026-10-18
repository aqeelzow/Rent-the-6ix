import type { AreaFacts } from "@rentthe6ix/shared/schemas";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { DetailSection } from "@/components/listing/detail-sections";
import { t, type MessageKey } from "@/lib/format/messages";
import type { WardCrime } from "@/lib/db/ward-crime";
import { AreaFactsList } from "./area-facts-list";
import { ElectionBox } from "./election-box";
import { WardCrimeSection } from "./ward-crime";

const w = (key: string, params?: Record<string, string | number>) =>
  t(`areas.ward.${key}` as MessageKey, params);

/**
 * `/areas/ward/[n]` (SPEC 9.3): the ward's figures beside Toronto's (D's area facts) and the election
 * info box. Without the database the figures section says so.
 */
export function WardView({
  n,
  facts,
  crime,
}: {
  n: number;
  facts: AreaFacts | null;
  crime: WardCrime | null;
}) {
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
        <h1 className="text-2xl font-semibold tracking-tight">
          {facts ? w("titleNamed", { n, name: facts.area.name }) : w("title", { n })}
        </h1>
        <p className="text-muted-foreground max-w-prose">{w("intro")}</p>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {/* The election box comes first on phones (it's short and time-sensitive) and sits
            beside the figures on wide screens. */}
        <div className="lg:sticky lg:top-20 lg:order-last">
          <ElectionBox />
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <DetailSection id="figures" title={w("figuresTitle")}>
            {facts && facts.facts.length > 0 ? (
              <AreaFactsList facts={facts} />
            ) : (
              <p className="text-muted-foreground text-sm">{w("figuresPending")}</p>
            )}
          </DetailSection>
          {crime && crime.neighbourhoods.length > 0 && <WardCrimeSection crime={crime} />}
        </div>
      </div>
    </div>
  );
}
