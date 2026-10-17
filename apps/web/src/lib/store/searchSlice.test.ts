import { beforeEach, describe, expect, it } from "vitest";
import { selectIsShortlisted } from "./searchSlice";
import { createAppStore } from "./store";

const intent = { rawPrompt: "2 bed near UofT under $2,800", criteria: {} };
const result = (id: string) => ({ id, monthlyRentCad: 2650 });

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
});

describe("search requests", () => {
  it("stores results for the latest request", () => {
    const id = store.getState().startSearch();
    expect(store.getState().status).toBe("searching");

    store.getState().receiveResults(id, [result("a"), result("b")]);
    expect(store.getState().status).toBe("ready");
    expect(store.getState().results.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("drops responses from older requests", () => {
    const first = store.getState().startSearch();
    const second = store.getState().startSearch();

    store.getState().receiveResults(second, [result("new")]);
    store.getState().receiveResults(first, [result("old")]);
    store.getState().receiveError(first, { code: "timeout", message: "late" });

    expect(store.getState().results.map((r) => r.id)).toEqual(["new"]);
    expect(store.getState().status).toBe("ready");
    expect(store.getState().error).toBeNull();
  });

  it("keeps previous results when a search fails", () => {
    store.getState().receiveResults(store.getState().startSearch(), [result("a")]);
    const id = store.getState().startSearch();
    store
      .getState()
      .receiveError(id, { code: "rate_limited", message: "Slow down", retryAfterSeconds: 5 });

    expect(store.getState().status).toBe("error");
    expect(store.getState().error?.retryAfterSeconds).toBe(5);
    expect(store.getState().results.map((r) => r.id)).toEqual(["a"]);
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
    store.getState().receiveResults(store.getState().startSearch(), [result("a"), result("b")]);
    store.getState().setHoveredListingId("a");
    store.getState().setSelectedListingId("b");

    store.getState().receiveResults(store.getState().startSearch(), [result("b"), result("c")]);
    expect(store.getState().hoveredListingId).toBeNull();
    expect(store.getState().selectedListingId).toBe("b");
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
    store.getState().addPastedListing({ id: "p1", monthlyRentCad: 1900 });
    store.getState().addPastedListing({ id: "p1", monthlyRentCad: 1850 });

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
