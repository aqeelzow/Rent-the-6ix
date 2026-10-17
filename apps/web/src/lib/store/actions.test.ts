import { baseIntent, detailFixture, searchFixture } from "@rentthe6ix/shared/fixtures";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchListingDetail,
  parseAndSearch,
  redactIntent,
  resolveDestination,
  runSearch,
} from "./actions";
import { createAppStore } from "./store";

const token = "a".repeat(43);
const pending = {
  status: "pending",
  jobToken: token,
  pollUrl: `/api/listings/search/jobs/${token}`,
  expiresAt: "2026-10-17T12:03:00Z",
};
const parsed = {
  intent: { ...baseIntent, rawPrompt: "2 bed under $2,800" },
  destinations: [],
  parser: "fallback",
  notice: "Used basic search; review the interpreted filters.",
};

type Reply = { status?: number; body: unknown };

/** A fake fetch that answers each call in order and records what was asked. */
function fakeFetch(...replies: Reply[]) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const reply = replies.shift();
    if (!reply) throw new Error("unexpected request");
    return Response.json(reply.body, { status: reply.status ?? 200 });
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

let store: ReturnType<typeof createAppStore>;
const options = (fetchFn: typeof globalThis.fetch) => ({
  store,
  fetch: fetchFn,
  sleep: async () => {},
  now: () => Date.parse("2026-10-17T12:00:00Z"),
});

beforeEach(() => {
  store = createAppStore();
});

describe("parseAndSearch", () => {
  it("parses the prompt, then searches with the parsed intent", async () => {
    const { fetch, calls } = fakeFetch({ body: parsed }, { body: searchFixture });
    await parseAndSearch("2 bed under $2,800", options(fetch));

    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "POST /api/search/parse",
      "POST /api/listings/search",
    ]);
    expect(calls[0]?.body).toEqual({ prompt: "2 bed under $2,800" });
    expect(calls[1]?.body).toEqual({ intent: parsed.intent, hideUnconfirmed: false });

    const state = store.getState();
    expect(state.status).toBe("ready");
    expect(state.intent?.rawPrompt).toBe("2 bed under $2,800");
    expect(state.parser).toBe("fallback");
    expect(state.parseNotice).toBe(parsed.notice);
    expect(state.results).toHaveLength(searchFixture.status === "completed" ? 8 : 0);
    expect(state.eligibleCount).toBe(50);
  });

  it("doesn't send the same prompt twice while it's being read", async () => {
    const { fetch, calls } = fakeFetch({ body: parsed }, { body: searchFixture });
    await Promise.all([
      parseAndSearch("2 bed under $2,800", options(fetch)),
      parseAndSearch("2 bed under $2,800", options(fetch)),
    ]);
    expect(calls.map((c) => c.url)).toEqual(["/api/search/parse", "/api/listings/search"]);
    expect(store.getState().status).toBe("ready");
  });

  it("stops with B's error when parsing fails", async () => {
    const { fetch, calls } = fakeFetch({
      status: 429,
      body: { error: { code: "rate_limited", message: "Too many requests", retryAfterSeconds: 5 } },
    });
    await parseAndSearch("anything", options(fetch));

    expect(calls).toHaveLength(1);
    expect(store.getState().status).toBe("error");
    expect(store.getState().error).toMatchObject({ code: "rate_limited", retryAfterSeconds: 5 });
  });

  it("treats a response that breaks the contract as an error", async () => {
    const { fetch } = fakeFetch({ body: { intent: { nope: true } } });
    await parseAndSearch("anything", options(fetch));
    expect(store.getState().error?.code).toBe("unexpected_response");
    expect(store.getState().intent).toBeNull();
  });
});

describe("runSearch", () => {
  beforeEach(() => store.getState().setIntent(parsed.intent));

  it("polls a pending search until it completes", async () => {
    const { fetch, calls } = fakeFetch(
      { body: pending },
      { body: pending },
      { body: searchFixture },
    );
    await runSearch(options(fetch));

    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "POST /api/listings/search",
      `GET ${pending.pollUrl}`,
      `GET ${pending.pollUrl}`,
    ]);
    expect(store.getState().status).toBe("ready");
  });

  it("reports an unavailable search with its reason", async () => {
    const { fetch } = fakeFetch({
      body: { status: "unavailable", reason: "capacity", message: "Search capacity reached" },
    });
    await runSearch(options(fetch));
    expect(store.getState().error).toEqual({
      code: "search_capacity",
      message: "Search capacity reached",
    });
  });

  it("gives up on a pending search once it has expired", async () => {
    const { fetch, calls } = fakeFetch({ body: pending });
    await runSearch({ ...options(fetch), now: () => Date.parse("2026-10-17T12:05:00Z") });
    expect(calls).toHaveLength(1);
    expect(store.getState().error?.code).toBe("search_job_expired");
  });

  it("reports a network failure", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError("offline");
    }) as unknown as typeof globalThis.fetch;
    await runSearch(options(fetch));
    expect(store.getState().error?.code).toBe("network_error");
  });

  it("sends the hide-unconfirmed toggle", async () => {
    store.getState().setHideUnconfirmed(true);
    const { fetch, calls } = fakeFetch({ body: searchFixture });
    await runSearch(options(fetch));
    expect(calls[0]?.body).toMatchObject({ hideUnconfirmed: true });
  });

  it("stops polling when a newer search starts", async () => {
    const { fetch, calls } = fakeFetch({ body: pending });
    await runSearch({
      ...options(fetch),
      // A chip edit starts another search while this one waits to poll.
      sleep: async () => {
        store.getState().startSearch();
      },
    });
    expect(calls).toHaveLength(1);
    expect(store.getState().status).toBe("searching");
  });

  it("cancels a search that's still in flight when a newer one starts", async () => {
    const signals: AbortSignal[] = [];
    let release: (value: Response) => void = () => {};
    const fetch = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          signals.push(init!.signal!);
          if (signals.length === 1) {
            init!.signal!.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError")),
            );
          } else release = resolve;
        }),
    ) as unknown as typeof globalThis.fetch;

    const first = runSearch(options(fetch));
    const second = runSearch(options(fetch));
    release(Response.json(searchFixture));
    await Promise.all([first, second]);

    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
    expect(store.getState().status).toBe("ready");
    expect(store.getState().error).toBeNull();
  });

  it("does nothing without an intent", async () => {
    store.getState().setIntent(null);
    const { fetch, calls } = fakeFetch();
    await runSearch(options(fetch));
    expect(calls).toHaveLength(0);
    expect(store.getState().status).toBe("idle");
  });
});

describe("resolveDestination", () => {
  it("returns the resolver's answer, URL-encoding the query", async () => {
    const ambiguous = {
      status: "ambiguous",
      query: "University of Toronto",
      choices: [
        {
          id: "stg",
          label: "St. George",
          resolved: { lng: -79.39, lat: 43.66, source: "known_place" },
        },
        {
          id: "utsc",
          label: "Scarborough",
          resolved: { lng: -79.18, lat: 43.78, source: "known_place" },
        },
      ],
    };
    const { fetch, calls } = fakeFetch({ body: ambiguous });
    const result = await resolveDestination("University of Toronto", { fetch });
    expect(calls[0]?.url).toBe("/api/geo/resolve?q=University%20of%20Toronto");
    expect(result).toEqual({ ok: true, resolution: ambiguous });
  });

  it("reports errors", async () => {
    const { fetch } = fakeFetch({
      status: 503,
      body: { error: { code: "service_unavailable", message: "x" } },
    });
    expect(await resolveDestination("x", { fetch })).toMatchObject({
      ok: false,
      error: { code: "service_unavailable" },
    });
  });
});

describe("fetchListingDetail", () => {
  it("sends a redacted intent and returns the validated detail", async () => {
    const { fetch, calls } = fakeFetch({ body: detailFixture });
    const id = detailFixture.listing.id;
    const result = await fetchListingDetail(id, parsed.intent as never, { fetch });

    expect(result).toEqual({ ok: true, detail: detailFixture });
    const url = new URL(calls[0]!.url, "http://x");
    expect(url.pathname).toBe(`/api/listings/${id}`);
    const sent = JSON.parse(url.searchParams.get("intent")!);
    expect(sent).toMatchObject({ rawPrompt: "", fieldSources: {}, droppedRequests: [] });
  });

  it("uses an empty search when there's no intent, and reports errors", async () => {
    const { fetch, calls } = fakeFetch({
      status: 404,
      body: { error: { code: "listing_not_found", message: "Listing not found" } },
    });
    const result = await fetchListingDetail("x", null, { fetch });
    expect(result).toEqual({
      ok: false,
      error: { code: "listing_not_found", message: "Listing not found" },
    });
    expect(
      JSON.parse(new URL(calls[0]!.url, "http://x").searchParams.get("intent")!).criteria,
    ).toEqual({});
  });

  it("redacts the renter's words but keeps the criteria", () => {
    const redacted = redactIntent({
      ...baseIntent,
      rawPrompt: "secret",
      droppedRequests: [{ phrase: "x", reason: "y" }],
    });
    expect(redacted.rawPrompt).toBe("");
    expect(redacted.droppedRequests).toEqual([]);
    expect(redacted.criteria).toEqual(baseIntent.criteria);
  });
});
