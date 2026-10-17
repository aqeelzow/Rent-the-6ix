import { afterEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("postgres", () => ({ default: () => query }));

import { getDatabaseStatus } from "@/lib/db";

afterEach(() => {
  delete process.env.DATABASE_URL;
  query.mockReset();
});

describe("getDatabaseStatus", () => {
  it("reports missing configuration without attempting a connection", async () => {
    await expect(getDatabaseStatus()).resolves.toMatchObject({
      configured: false,
      connected: false,
      error: "missing_config",
    });
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects non-PostgreSQL or non-TLS database URLs safely", async () => {
    process.env.DATABASE_URL = "https://user:secret@example.test/db";

    await expect(getDatabaseStatus()).resolves.toMatchObject({
      configured: true,
      connected: false,
      error: "missing_config",
    });
    expect(query).not.toHaveBeenCalled();
  });

  it("returns real status metrics without exposing the connection URL", async () => {
    process.env.DATABASE_URL = "postgresql://user:secret@example.test/db?sslmode=require";
    query.mockResolvedValueOnce([
      {
        database: "tsdb",
        migrations: 3,
        extensions: ["pg_trgm", "postgis", "timescaledb"],
        listings: 12,
        listing_observations: 24,
        sources: 5,
        neighbourhoods: 158,
        wards: 25,
      },
    ]);

    const result = await getDatabaseStatus();

    expect(result).toEqual({
      configured: true,
      connected: true,
      database: "tsdb",
      migrations: 3,
      extensions: ["pg_trgm", "postgis", "timescaledb"],
      tables: {
        listings: 12,
        listingObservations: 24,
        sources: 5,
        neighbourhoods: 158,
        wards: 25,
      },
      error: null,
    });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("hides connection errors rather than leaking driver details", async () => {
    process.env.DATABASE_URL = "postgresql://user:secret@example.test/db?sslmode=require";
    query.mockRejectedValueOnce(new Error("secret password rejected"));

    const result = await getDatabaseStatus();

    expect(result).toMatchObject({
      configured: true,
      connected: false,
      error: "connection_failed",
    });
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});
