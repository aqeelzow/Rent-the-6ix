import { Badge } from "@/components/ui/badge";
import { STALE_HOURS, type SourceHealth, type SourceState } from "@/lib/db/source-health";
import { t, type MessageKey } from "@/lib/format/messages";
import { formatCount } from "@/lib/format/number";

// Listing sources on /status (P5.5c), owner C: one row per site with its last run, and a plain
// explanation whenever a site is blocked, failing, empty or behind.

const when = new Intl.DateTimeFormat("en-CA", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/Toronto",
  timeZoneName: "short",
});
const at = (iso: string | null) =>
  iso ? when.format(new Date(iso)) : t("status.listingSources.never");

const BADGE: Record<SourceState, "secondary" | "destructive" | "outline"> = {
  ok: "secondary",
  no_runs: "outline",
  stale: "outline",
  empty: "destructive",
  blocked: "secondary",
  failed: "destructive",
};

/** Colour overrides: healthy is green (the same tokens as "Underpriced"), ongoing is grey. */
const BADGE_CLASS: Partial<Record<SourceState, string>> = {
  // `!` so they win over the variant's own colours (cn doesn't merge Tailwind classes).
  ok: "bg-price-underpriced! text-price-underpriced-foreground!",
  blocked: "bg-muted! text-muted-foreground!",
};

function sourceName(source: string): string {
  const key = `results.sources.${source}` as MessageKey;
  const name = t(key);
  return name === key ? source : name;
}

export function SourceHealthSection({ sources }: { sources: SourceHealth[] | null }) {
  return (
    <section aria-labelledby="source-health-heading" className="bg-card rounded-xl border p-5">
      <h2 id="source-health-heading" className="mb-2 text-lg font-semibold">
        {t("status.listingSources.title")}
      </h2>
      <p className="text-muted-foreground text-sm">{t("status.listingSources.intro")}</p>
      {sources === null ? (
        <p className="text-destructive mt-4 text-sm">{t("status.listingSources.loadFailed")}</p>
      ) : sources.length === 0 ? (
        <p className="text-muted-foreground mt-4 text-sm">{t("status.listingSources.none")}</p>
      ) : (
        <ul className="mt-4 flex flex-col">
          {sources.map((source) => (
            <li key={source.source} className="border-b py-3 last:border-b-0">
              <div className="flex items-center justify-between gap-4">
                <span className="font-medium">{sourceName(source.source)}</span>
                <Badge variant={BADGE[source.state]} className={BADGE_CLASS[source.state]}>
                  {t(`status.listingSources.state.${source.state}`)}
                </Badge>
              </div>
              {source.state !== "ok" && (
                <p className="mt-1 text-sm">
                  {t(`status.listingSources.explain.${source.state}`, { hours: STALE_HOURS })}
                </p>
              )}
              {source.message && source.state !== "ok" && (
                <p className="text-muted-foreground mt-1 font-mono text-xs break-words">
                  {source.message}
                </p>
              )}
              <dl className="text-muted-foreground mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
                <div className="flex justify-between gap-2">
                  <dt>{t("status.listingSources.lastRun")}</dt>
                  <dd className="tabular-nums">{at(source.lastRunAt)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>{t("status.listingSources.lastOk")}</dt>
                  <dd className="tabular-nums">{at(source.lastOkAt)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>{t("status.listingSources.newestSeen")}</dt>
                  <dd className="tabular-nums">{at(source.newestSeenAt)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>{t("status.listingSources.listings")}</dt>
                  <dd className="tabular-nums">
                    {t("status.listingSources.activeStale", {
                      active: formatCount(source.active),
                      stale: formatCount(source.stale),
                    })}
                  </dd>
                </div>
                {source.lastRunListings !== null && (
                  <div className="flex justify-between gap-2 sm:col-span-2">
                    <dt>{t("status.listingSources.lastRunCounts")}</dt>
                    <dd className="tabular-nums">
                      {t("status.listingSources.collectedStored", {
                        collected: formatCount(source.lastRunListings),
                        stored: formatCount(source.lastRunStored ?? 0),
                      })}
                    </dd>
                  </div>
                )}
              </dl>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
