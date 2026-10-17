import { baseIntent, listings, searchFixture } from "@rentthe6ix/shared/fixtures";
import { beforeEach, describe, expect, it } from "vitest";
import { selectIsShortlisted } from "./searchSlice";
import { createAppStore } from "./store";

const intent = { ...baseIntent, rawPrompt: "2 bed near UofT under $2,800" };
const fixtureResults = searchFixture.status === "completed" ? searchFixture.results : [];
const [a, b, c] = fixtureResults.map((r) => r.listing.id);
/** A completed search response holding the fixture results with these listing ids. */
const completed = (...ids: (string | undefined)[]) => ({
  status: "completed" as const,
  results: fixtureResults.filter((r) => ids.includes(r.listing.id)),
  eligibleCount: 50,
  notices: [],
});
const ids = () => store.getState().results.map((r) => r.listing.id);

let store: ReturnType<typeof createAppStore>;

beforeEach(() => {
  store = createAppStore();
});

describe("intent", () => {
  it("starts empty and idle", () => {
    const state = store.getState();
    expect(state.intent).toBeNull();
    expect(state.results).toEqual([]);
    expect(state.status).toBe("idle");
    expect(state.hoveredListingId).toBeNull();
    expect(state.selectedListingId).toBeNull();
  });

  it("updates an intent and ignores updates when there is none", () => {
    store.getState().updateIntent((current) => ({ ...current, rawPrompt: "changed" }));
    expect(store.getState().intent).toBeNull();

    store.getState().setIntent(intent);
    store.getState().updateIntent((current) => ({ ...current, sortBy: "lowest_rent" }));
    expect(store.getState().intent).toEqual({ ...intent, sortBy: "lowest_rent" });
  });

  it("stores a parsed prompt, unless a newer request has started", () => {
    const parsed = {
      intent,
      destinations: [],
      parser: "fallback" as const,
      notice: "Used basic search.",
    };
    const old = store.getState().startParse("first");
    expect(store.getState().status).toBe("parsing");
    expect(store.getState().parsingPrompt).toBe("first");
    store.getState().startParse("second");
    expect(store.getState().receiveParse(old, parsed)).toBe(false);
    expect(store.getState().intent).toBeNull();

    expect(store.getState().receiveParse(store.getState().searchRequestId, parsed)).toBe(true);
    expect(store.getState().intent).toEqual(intent);
    expect(store.getState().parser).toBe("fallback");
    expect(store.getState().parseNotice).toBe("Used basic search.");
    expect(store.getState().parsingPrompt).toBeNull();
  });
});

describe("search requests", () => {
  it("stores results for the latest request", () => {
    const id = store.getState().startSearch();
    expect(store.getState().status).toBe("searching");

    store.getState().receiveResults(id, completed(a, b));
    expect(store.getState().status).toBe("ready");
    expect(ids()).toEqual([a, b]);
    expect(store.getState().eligibleCount).toBe(50);
  });

  it("drops responses from older requests", () => {
    const first = store.getState().startSearch();
    const second = store.getState().startSearch();

    store.getState().receiveResults(second, completed(a));
    store.getState().receiveResults(first, completed(b));
    store.getState().receiveError(first, { code: "timeout", message: "late" });

    expect(ids()).toEqual([a]);
    expect(store.getState().status).toBe("ready");
    expect(store.getState().error).toBeNull();
  });

  it("keeps previous results when a search fails", () => {
    store.getState().receiveResults(store.getState().startSearch(), completed(a));
    const id = store.getState().startSearch();
    store
      .getState()
      .receiveError(id, { code: "rate_limited", message: "Slow down", retryAfterSeconds: 5 });

    expect(store.getState().status).toBe("error");
    expect(store.getState().error?.retryAfterSeconds).toBe(5);
    expect(ids()).toEqual([a]);
  });
});

describe("selection contract", () => {
  it("sets hovered and selected listings independently", () => {
    store.getState().setHoveredListingId("a");
    store.getState().setSelectedListingId("b");
    expect(store.getState().hoveredListingId).toBe("a");
    expect(store.getState().selectedListingId).toBe("b");

    store.getState().setHoveredListingId(null);
    expect(store.getState().hoveredListingId).toBeNull();
    expect(store.getState().selectedListingId).toBe("b");
  });

  it("clears a selection that drops out of new results and keeps one that stays", () => {
    store.getState().receiveResults(store.getState().startSearch(), completed(a, b));
    store.getState().setHoveredListingId(a!);
    store.getState().setSelectedListingId(b!);

    store.getState().receiveResults(store.getState().startSearch(), completed(b, c));
    expect(store.getState().hoveredListingId).toBeNull();
    expect(store.getState().selectedListingId).toBe(b);
  });
});

describe("shortlist", () => {
  it("toggles listings in and out", () => {
    store.getState().toggleShortlist("a");
    expect(selectIsShortlisted("a")(store.getState())).toBe(true);
    expect(store.getState().shortlist[0]).toMatchObject({ kind: "listing", id: "a" });

    store.getState().toggleShortlist("a");
    expect(selectIsShortlisted("a")(store.getState())).toBe(false);
  });

  it("keeps pasted listings whole and replaces a re-pasted one", () => {
    const pasted = { ...listings[0]!, source: "pasted" as const };
    store.getState().addPastedListing({ ...pasted, monthlyRentCad: 1900 });
    store.getState().addPastedListing({ ...pasted, monthlyRentCad: 1850 });

    const { shortlist } = store.getState();
    expect(shortlist).toHaveLength(1);
    expect(shortlist[0]).toMatchObject({ kind: "pasted", listing: { monthlyRentCad: 1850 } });
  });

  it("removes one entry or clears everything", () => {
    store.getState().toggleShortlist("a");
    store.getState().toggleShortlist("b");
    store.getState().removeFromShortlist("a");
    expect(store.getState().shortlist.map((e) => e.id)).toEqual(["b"]);

    store.getState().clearShortlist();
    expect(store.getState().shortlist).toEqual([]);
  });
});
