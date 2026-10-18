import { describe, expect, it, vi } from "vitest";
import { loadDataPage } from "./data-sources";

function fakeSql(sources: object[], sites: object[]) {
  const sql = vi.fn((strings: TemplateStringsArray) =>
    Promise.resolve(strings.join("?").includes("FROM sources") ? sources : sites),
  );
  return sql as unknown as Parameters<typeof loadDataPage>[0];
}

describe("loadDataPage", () => {
  it("maps datasets and per-site counts for /data", async () => {
    const page = await loadDataPage(
      fakeSql(
        [
          {
            id: "statcan-46100092",
            title: "Asking rent",
            url: "https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=4610009201",
            licence: "Statistics Canada Open Licence",
            period: "2026 Q2",
            retrieved_at: new Date("2026-10-17T00:00:00Z"),
          },
        ],
        [{ source: "kijiji", shown: 5672, newest: new Date("2026-10-17T19:04:36Z") }],
      ),
    );
    expect(page.sources).toEqual([
      {
        id: "statcan-46100092",
        title: "Asking rent",
        url: "https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=4610009201",
        licence: "Statistics Canada Open Licence",
        period: "2026 Q2",
        retrievedAt: "2026-10-17",
      },
    ]);
    expect(page.sites).toEqual([
      { source: "kijiji", shown: 5672, newestSeenAt: "2026-10-17T19:04:36.000Z" },
    ]);
  });
});
