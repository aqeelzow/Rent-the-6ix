import { afterEach, expect, it, vi } from "vitest";
import { GET } from "./route";

afterEach(() => vi.unstubAllGlobals());

it("returns the newest reporting period and only aggregate counts for the listing area", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        facets: {
          reportingPeriods: [
            { id: 2, start: "2026-11-01", end: "2026-11-10" },
            { id: 1, start: "2026-11-10", end: "2026-11-20" },
          ],
        },
      }),
    )
    .mockResolvedValueOnce(
      Response.json({
        total: 8,
        byCategory: [{ category: "ALARM", count: 8 }],
        items: [{ occurrenceNumber: "private-detail" }],
      }),
    );
  vi.stubGlobal("fetch", fetch);
  const response = await GET(
    new Request("http://localhost/api/police-activity?lat=43.474&lng=-80.544"),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    start: "2026-11-10",
    end: "2026-11-20",
    total: 8,
    categories: [{ category: "ALARM", count: 8 }],
  });
  const url: URL = fetch.mock.calls[1][0];
  expect(url.searchParams.get("reportingPeriodId")).toBe("1");
  expect(url.searchParams.get("bbox")).toBe("-80.5500,43.4695,-80.5380,43.4785");
});

it("rejects out-of-market coordinates and reports a provider outage", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
  vi.stubGlobal("fetch", fetch);
  const route = "http://localhost/api/police-activity";
  expect((await GET(new Request(route + "?lat=43.650&lng=-79.380"))).status).toBe(400);
  expect(fetch).not.toHaveBeenCalled();
  expect((await GET(new Request(route + "?lat=43.474&lng=-80.544"))).status).toBe(503);
});
