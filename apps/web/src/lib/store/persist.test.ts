import { baseIntent, listings, searchFixture } from "@rentthe6ix/shared/fixtures";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LAST_SEARCH_KEY,
  SHORTLIST_KEY,
  clearMyData,
  clearStoredData,
  parseLastSearch,
  readLastSearch,
  readShortlist,
  startPersistence,
  writeLastSearch,
  writeShortlist,
} from "./persist";
import { savedListing, type ShortlistEntry } from "./searchSlice";
import { createAppStore } from "./store";

/** A `localStorage` stand-in that counts writes. */
class MemoryStorage implements Storage {
  private items = new Map<string, string>();
  writes = 0;
  get length() {
    return this.items.size;
  }
  key(index: number) {
    return [...this.items.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.writes += 1;
    this.items.set(key, value);
  }
  removeItem(key: string) {
    this.items.delete(key);
  }
  clear() {
    this.items.clear();
  }
}

/** Storage the browser has blocked: every call throws. */
const blocked = new Proxy({} as Storage, {
  get: () => () => {
    throw new DOMException("blocked", "SecurityError");
  },
});

const [first, second] = listings;
const entry = (listing = first!): Extract<ShortlistEntry, { kind: "listing" }> => ({
  kind: "listing",
  id: listing.id,
  addedAt: "2026-10-17T12:00:00.000Z",
  saved: savedListing(listing),
});
const intent = { ...baseIntent, rawPrompt: "2 bed near UofT under $2,800" };
const completed = searchFixture.status === "completed" ? searchFixture : null;

let storage: MemoryStorage;
beforeEach(() => {
  storage = new MemoryStorage();
});

describe("shortlist storage", () => {
  it("round-trips saved and pasted listings", () => {
    const pasted: ShortlistEntry = {
      kind: "pasted",
      id: second!.id,
      listing: { ...second!, source: "pasted" },
      addedAt: "2026-10-17T12:00:00.000Z",
    };
    writeShortlist([entry(), pasted], storage);
    expect(readShortlist(storage)).toEqual([entry(), pasted]);
  });

  it("drops damaged entries one at a time, and duplicates", () => {
    storage.setItem(
      SHORTLIST_KEY,
      JSON.stringify([
        entry(),
        { kind: "listing", id: "not-a-uuid", addedAt: "x", saved: {} },
        { ...entry(), saved: { ...entry().saved, monthlyRentCad: -5 } },
        entry(),
        entry(second),
      ]),
    );
    expect(readShortlist(storage).map((e) => e.id)).toEqual([first!.id, second!.id]);
  });

  it("is empty for missing, malformed or blocked storage, and never throws", () => {
    expect(readShortlist(storage)).toEqual([]);
    storage.setItem(SHORTLIST_KEY, "{not json");
    expect(readShortlist(storage)).toEqual([]);
    storage.setItem(SHORTLIST_KEY, JSON.stringify({ entries: [] }));
    expect(readShortlist(storage)).toEqual([]);
    expect(readShortlist(null)).toEqual([]);
    expect(readShortlist(blocked)).toEqual([]);
    expect(() => writeShortlist([entry()], blocked)).not.toThrow();
  });

  it("skips writes that wouldn't change anything", () => {
    writeShortlist([entry()], storage);
    writeShortlist([entry()], storage);
    expect(storage.writes).toBe(1);
  });
});

describe("last search storage", () => {
  it("round-trips the edited intent and the hide-unconfirmed choice", () => {
    writeLastSearch({ intent, hideUnconfirmed: true }, storage);
    expect(readLastSearch(storage)).toMatchObject({ intent, hideUnconfirmed: true });
    expect(parseLastSearch(storage.getItem(LAST_SEARCH_KEY))).toEqual(readLastSearch(storage));
  });

  it("doesn't save a search without words, and rejects stored values that aren't a search", () => {
    writeLastSearch({ intent: baseIntent, hideUnconfirmed: false }, storage);
    expect(storage.getItem(LAST_SEARCH_KEY)).toBeNull();
    storage.setItem(LAST_SEARCH_KEY, JSON.stringify({ intent: { rawPrompt: "x" } }));
    expect(readLastSearch(storage)).toBeNull();
    expect(parseLastSearch("{")).toBeNull();
    expect(parseLastSearch(null)).toBeNull();
  });
});

describe("clearing", () => {
  it("removes only this app's keys", () => {
    writeShortlist([entry()], storage);
    writeLastSearch({ intent, hideUnconfirmed: false }, storage);
    storage.setItem("someone-else", "keep");
    clearStoredData(storage);
    expect(storage.length).toBe(1);
    expect(storage.getItem("someone-else")).toBe("keep");
    expect(() => clearStoredData(blocked)).not.toThrow();
  });
});

describe("startPersistence", () => {
  const listeners = new EventTarget();
  beforeEach(() => vi.stubGlobal("window", listeners));
  afterEach(() => vi.unstubAllGlobals());

  it("loads the saved shortlist, keeping anything added before it loaded", () => {
    writeShortlist([entry()], storage);
    const store = createAppStore();
    store.getState().toggleShortlist(second!);
    const stop = startPersistence(store, storage);
    expect(store.getState().shortlistLoaded).toBe(true);
    expect(store.getState().shortlist.map((e) => e.id)).toEqual([first!.id, second!.id]);
    stop();
  });

  it("saves shortlist changes and each finished search", () => {
    const store = createAppStore();
    const stop = startPersistence(store, storage);
    store.getState().toggleShortlist(first!);
    expect(readShortlist(storage).map((e) => e.id)).toEqual([first!.id]);

    store.getState().setIntent(intent);
    const id = store.getState().startSearch();
    expect(readLastSearch(storage)).toBeNull(); // not until results arrive
    store.getState().receiveResults(id, completed!);
    expect(readLastSearch(storage)?.intent).toEqual(intent);

    stop();
    store.getState().toggleShortlist(second!);
    expect(readShortlist(storage)).toHaveLength(1);
  });

  it("picks up changes made in another tab", () => {
    const store = createAppStore();
    const stop = startPersistence(store, storage);
    writeShortlist([entry(second)], storage);
    listeners.dispatchEvent(Object.assign(new Event("storage"), { key: SHORTLIST_KEY }));
    expect(store.getState().shortlist.map((e) => e.id)).toEqual([second!.id]);

    // Another tab's "Clear my data" (key null) empties it here too.
    storage.clear();
    listeners.dispatchEvent(Object.assign(new Event("storage"), { key: null }));
    expect(store.getState().shortlist).toEqual([]);
    stop();
  });

  it("clear my data empties the shortlist and leaves nothing stored", () => {
    const store = createAppStore();
    const stop = startPersistence(store, storage);
    store.getState().toggleShortlist(first!);
    writeLastSearch({ intent, hideUnconfirmed: false }, storage);
    clearMyData(store, storage);
    expect(store.getState().shortlist).toEqual([]);
    expect(storage.length).toBe(0);
    stop();
  });
});
