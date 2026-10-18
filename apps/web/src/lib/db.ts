import "server-only";
import postgres, { type Sql } from "postgres";

export type DatabaseStatus = {
  configured: boolean;
  connected: boolean;
  database: string | null;
  migrations: number | null;
  extensions: string[] | null;
  tables: {
    listings: number;
    listingObservations: number;
    sources: number;
    neighbourhoods: number;
    wards: number;
  } | null;
  error: "missing_config" | "connection_failed" | null;
};

let client: Sql | undefined;

export function getClient(): Sql | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("DATABASE_URL is not a valid PostgreSQL URL");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use postgres:// or postgresql://");
  }
  if (parsed.searchParams.get("sslmode") !== "require") {
    throw new Error("DATABASE_URL must include sslmode=require");
  }
  client ??= postgres(url, {
    max: 2,
    // A paused or cold TigerData instance needs longer than 5 s to accept a connection; failing
    // the whole search in that window turned a slow first search into a 503.
    connect_timeout: 10,
    // Keep the two connections for a few minutes: a demo searches every few seconds, and a 20 s
    // idle close meant most searches paid the TLS handshake again.
    idle_timeout: 300,
    onnotice: () => {},
  });
  return client;
}

/** Safe, read-only status probe. Never returns the connection string or error details. */
export async function getDatabaseStatus(): Promise<DatabaseStatus> {
  let sql: Sql | null;
  try {
    sql = getClient();
  } catch {
    return {
      configured: Boolean(process.env.DATABASE_URL),
      connected: false,
      database: null,
      migrations: null,
      extensions: null,
      tables: null,
      error: "missing_config",
    };
  }

  if (!sql) {
    return {
      configured: false,
      connected: false,
      database: null,
      migrations: null,
      extensions: null,
      tables: null,
      error: "missing_config",
    };
  }

  try {
    const [result] = await sql`
      SELECT
        current_database() AS database,
        (SELECT count(*)::int FROM schema_migrations) AS migrations,
        (SELECT array_agg(extname ORDER BY extname)
         FROM pg_extension
         WHERE extname IN ('postgis', 'timescaledb', 'pg_trgm')) AS extensions,
        (SELECT count(*)::int FROM listings) AS listings,
        (SELECT count(*)::int FROM listing_observations) AS listing_observations,
        (SELECT count(*)::int FROM sources) AS sources,
        (SELECT count(*)::int FROM neighbourhoods) AS neighbourhoods,
        (SELECT count(*)::int FROM wards) AS wards
    `;

    return {
      configured: true,
      connected: true,
      database: result.database,
      migrations: result.migrations,
      extensions: result.extensions ?? [],
      tables: {
        listings: result.listings,
        listingObservations: result.listing_observations,
        sources: result.sources,
        neighbourhoods: result.neighbourhoods,
        wards: result.wards,
      },
      error: null,
    };
  } catch {
    return {
      configured: true,
      connected: false,
      database: null,
      migrations: null,
      extensions: null,
      tables: null,
      error: "connection_failed",
    };
  }
}
