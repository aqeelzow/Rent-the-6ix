import type { Metadata } from "next";
import { getDatabaseStatus } from "@/lib/db";
import { t } from "@/lib/format/messages";

export const metadata: Metadata = { title: t("layout.footer.status") };

export const dynamic = "force-dynamic";

function StatusRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b py-3 last:border-b-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium tabular-nums">{value}</dd>
    </div>
  );
}

export default async function StatusPage() {
  const status = await getDatabaseStatus();
  const state = !status.configured
    ? t("status.notConfigured")
    : status.connected
      ? t("status.connected")
      : t("status.connectionFailed");

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">{t("status.title")}</h1>
      <section aria-labelledby="database-status-heading" className="bg-card rounded-xl border p-5">
        <h2 id="database-status-heading" className="mb-2 text-lg font-semibold">
          {t("status.database")}
        </h2>
        <p
          className={status.connected ? "text-sm text-green-700" : "text-muted-foreground text-sm"}
        >
          {state}
        </p>
        {status.error === "missing_config" && status.configured && (
          <p className="text-muted-foreground mt-2 text-sm">
            DATABASE_URL must be a PostgreSQL URL with sslmode=require.
          </p>
        )}
        {status.error === "connection_failed" && (
          <p className="text-muted-foreground mt-2 text-sm">
            The database could not be reached or its migrations are missing. Check the server logs
            and run the migration command if needed.
          </p>
        )}
        {status.connected && status.tables && (
          <dl className="mt-4">
            <StatusRow label={t("status.databaseName")} value={status.database ?? "—"} />
            <StatusRow label={t("status.migrations")} value={status.migrations ?? 0} />
            <StatusRow
              label={t("status.extensions")}
              value={status.extensions?.join(", ") || "—"}
            />
            <StatusRow label={t("status.listingCount")} value={status.tables.listings} />
            <StatusRow label={t("status.observations")} value={status.tables.listingObservations} />
            <StatusRow label={t("status.sources")} value={status.tables.sources} />
            <StatusRow label={t("status.neighbourhoods")} value={status.tables.neighbourhoods} />
            <StatusRow label={t("status.wards")} value={status.tables.wards} />
          </dl>
        )}
      </section>
      <p className="text-muted-foreground text-sm">{t("status.comingSoon")}</p>
    </div>
  );
}
