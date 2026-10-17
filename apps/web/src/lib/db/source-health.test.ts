import { describe, expect, it, vi } from "vitest";
import { loadSourceHealth, sourceHealth, type SourceRunRow } from "./source-health";

const NOW = new Date("2026-10-17T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const row = (extra: Partial<SourceRunRow> = {}): SourceRunRow => ({
  source: "kijiji",
  status: "ok",
  finished_at: hoursAgo(2),
  listings: 400,
  stored: 398,
  message: null,
  last_ok_at: hoursAgo(2),
  active: 5000,
  stale: 300,
  newest_seen_at: hoursAgo(2),
  ...extra,
});

describe("sourceHealth", () => {
  it("is ok after a recent run that collected listings", () => {
    expect(sourceHealth(row(), NOW)).toMatchObject({
      state: "ok",
      lastRunAt: hoursAgo(2).toISOString(),
      lastRunListings: 400,
      lastRunStored: 398,
    });
  });

  it("names a blocked or failed last run first, with the worker's message", () => {
    const blocked = sourceHealth(
      row({ status: "unhealthy", message: 'blocked at https://x: HTTP 403 "Just a moment"' }),
      NOW,
    );
    expect(blocked).toMatchObject({ state: "blocked", message: expect.stringContaining("403") });
    // Even when the data is also old: the block is the reason.
    const failed = sourceHealth(row({ status: "error", newest_seen_at: hoursAgo(80) }), NOW);
    expect(failed.state).toBe("failed");
  });

  it("flags a run that found nothing, data older than 24 h, and no runs yet", () => {
    expect(sourceHealth(row({ listings: 0, stored: 0 }), NOW).state).toBe("empty");
    expect(sourceHealth(row({ newest_seen_at: hoursAgo(25) }), NOW).state).toBe("stale");
    expect(sourceHealth(row({ newest_seen_at: hoursAgo(23) }), NOW).state).toBe("ok");
    const none = {
      status: null,
      finished_at: null,
      listings: null,
      stored: null,
      last_ok_at: null,
    };
    expect(sourceHealth(row(none), NOW).state).toBe("no_runs");
    expect(sourceHealth(row({ ...none, newest_seen_at: hoursAgo(30) }), NOW).state).toBe("stale");
  });

  it("shortens long messages", () => {
    const long = sourceHealth(row({ status: "error", message: "x".repeat(500) }), NOW);
    expect(long.message).toHaveLength(160);
    expect(long.message!.endsWith("…")).toBe(true);
  });
});

describe("loadSourceHealth", () => {
  function fakeSql(hasRuns: boolean, rows: SourceRunRow[]) {
    const texts: string[] = [];
    const sql = vi.fn((strings: TemplateStringsArray) => {
      const text = strings.join("?");
      texts.push(text);
      if (text.includes("to_regclass")) return Promise.resolve([{ runs: hasRuns }]);
      if (text.includes("WITH seen")) return Promise.resolve(rows);
      return { fragment: text };
    });
    return { sql: sql as unknown as Parameters<typeof loadSourceHealth>[0], texts };
  }

  it("lists problems first and reads ingest_runs only when it exists", async () => {
    const rows = [
      row({ source: "zillow" }),
      row({ source: "realtor_ca", status: "unhealthy" }),
      row({ source: "kijiji", newest_seen_at: hoursAgo(48) }),
    ];
    const withRuns = fakeSql(true, rows);
    const health = await loadSourceHealth(withRuns.sql, NOW);
    expect(health.map((h) => [h.source, h.state])).toEqual([
      ["realtor_ca", "blocked"],
      ["kijiji", "stale"],
      ["zillow", "ok"],
    ]);
    expect(withRuns.texts.some((text) => text.includes("FROM ingest_runs"))).toBe(true);
    const without = fakeSql(false, []);
    await loadSourceHealth(without.sql, NOW);
    expect(without.texts.some((text) => text.includes("FROM ingest_runs"))).toBe(false);
  });
});
