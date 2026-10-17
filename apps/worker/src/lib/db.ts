// TigerData connection for the worker. Same rules as apps/web/src/lib/db.ts: DATABASE_URL is
// postgres:// with sslmode=require, read from the repo-root .env.local, never logged.
import postgres, { type Sql } from "postgres";

/** null when DATABASE_URL isn't set: the worker then writes JSON only. */
export function openDb(): Sql | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("DATABASE_URL is not a valid PostgreSQL URL");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:")
    throw new Error("DATABASE_URL must use postgres:// or postgresql://");
  if (parsed.searchParams.get("sslmode") !== "require")
    throw new Error("DATABASE_URL must include sslmode=require");
  return postgres(url, { max: 4, connect_timeout: 10, idle_timeout: 20, onnotice: () => {} });
}
