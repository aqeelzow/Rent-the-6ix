import { ListingSchema, SearchIntentSchema } from "@rentthe6ix/shared/schemas";
import { z } from "zod";
import type { ShortlistEntry } from "./searchSlice";
import { appStore } from "./store";
import type { SearchIntent } from "./types";
import { namedParkMentions } from "../parse/named-parks";
import { safetyPreference } from "../parse/safety-preference";

// Browser storage (SPEC 15): the shortlist and the last search live only in this browser, never on
// the server. Storage can be missing, full or blocked (private windows, previews), so every read
// and write is wrapped and the app works the same without it. What comes back is validated:
// anything that doesn't match is dropped, one shortlist entry at a time.

export const SHORTLIST_KEY = "rentthe6ix.shortlist.v1";
export const LAST_SEARCH_KEY = "rentthe6ix.lastSearch.v1";
/** Enough for any real shortlist; bounds what a tampered value can make us parse. */
const MAX_ENTRIES = 200;

const SavedListingSchema = z.object({
  title: z.string().min(1).max(500),
  monthlyRentCad: z.number().positive().finite(),
  rentIsPerRoom: z.boolean(),
  bedrooms: z.number().int().nonnegative().nullable(),
  bathrooms: z.number().nonnegative().nullable(),
  sqft: z.number().positive().nullable(),
  source: ListingSchema.shape.source,
  // Added later: shortlists saved before it have no image and still load.
  imageUrl: ListingSchema.shape.imageUrl.optional(),
});

const ShortlistEntrySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("listing"),
    id: z.uuid(),
    addedAt: z.iso.datetime(),
    saved: SavedListingSchema,
  }),
  z.object({
    kind: z.literal("pasted"),
    id: z.uuid(),
    listing: ListingSchema,
    addedAt: z.iso.datetime(),
  }),
]);

const LastSearchSchema = z.object({
  intent: SearchIntentSchema,
  hideUnconfirmed: z.boolean(),
  savedAt: z.iso.datetime(),
});

export type LastSearch = z.infer<typeof LastSearchSchema>;

/** Failed basic interpretations must not bypass parser fixes on later visits. Preserve renter edits. */
export function needsReinterpretation(intent: SearchIntent): boolean {
  if (Object.values(intent.fieldSources).some(source => source.source === 'user')) return false;
  const safety = safetyPreference(intent.rawPrompt);
  return !!safety && (safety.enabled !== intent.safety.enabled || safety.hard !== intent.safety.hard) ||
    intent.droppedRequests.some(request => request.phrase === intent.rawPrompt && request.reason === 'Basic parser could not identify supported constraints; edit filters or clarify.') ||
    intent.travelTargets.some(target => target.kind === 'amenity' && target.category === 'park') &&
    namedParkMentions(intent.rawPrompt).some(park => !intent.travelTargets.some(target => target.kind === 'place' && target.query?.toLowerCase().includes(park.phrase.toLowerCase())));
}

/** `localStorage`, or null where the browser blocks it. */
export function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readJson(storage: Storage | null, key: string): unknown {
  try {
    const raw = storage?.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Writes only when the value changed, so other tabs aren't told about a no-op. */
function writeJson(storage: Storage | null, key: string, value: unknown): void {
  try {
    const json = JSON.stringify(value);
    if (storage && storage.getItem(key) !== json) storage.setItem(key, json);
  } catch {
    // Full or blocked: the shortlist still works for this visit.
  }
}

export function readShortlist(storage = browserStorage()): ShortlistEntry[] {
  const value = readJson(storage, SHORTLIST_KEY);
  if (!Array.isArray(value)) return [];
  const entries: ShortlistEntry[] = [];
  const seen = new Set<string>();
  for (const item of value.slice(0, MAX_ENTRIES)) {
    const parsed = ShortlistEntrySchema.safeParse(item);
    if (parsed.success && !seen.has(parsed.data.id)) {
      seen.add(parsed.data.id);
      entries.push(parsed.data);
    }
  }
  return entries;
}

export function writeShortlist(entries: ShortlistEntry[], storage = browserStorage()): void {
  writeJson(storage, SHORTLIST_KEY, entries.slice(-MAX_ENTRIES));
}

export function readLastSearch(storage = browserStorage()): LastSearch | null {
  const parsed = LastSearchSchema.safeParse(readJson(storage, LAST_SEARCH_KEY));
  return parsed.success ? parsed.data : null;
}

/** The last search from its stored JSON text (for `useSyncExternalStore`, which needs a string). */
export function parseLastSearch(raw: string | null): LastSearch | null {
  try {
    const parsed = LastSearchSchema.safeParse(raw ? JSON.parse(raw) : null);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function writeLastSearch(
  search: { intent: SearchIntent; hideUnconfirmed: boolean },
  storage = browserStorage(),
): void {
  if (!search.intent.rawPrompt || needsReinterpretation(search.intent)) return;
  writeJson(storage, LAST_SEARCH_KEY, { ...search, savedAt: new Date().toISOString() });
}

/** "Clear my data": removes everything this app keeps in the browser. */
export function clearStoredData(storage = browserStorage()): void {
  try {
    if (!storage) return;
    const ours = Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter(
      (key): key is string => key?.startsWith("rentthe6ix.") ?? false,
    );
    for (const key of ours) storage.removeItem(key);
  } catch {
    // Nothing more we can do; the in-memory copy is cleared by the caller.
  }
}

/** "Clear my data" on the shortlist: storage and the in-memory shortlist. */
export function clearMyData(store = appStore, storage = browserStorage()): void {
  // Shortlist first: emptying it writes `[]`, which the storage clear then removes.
  store.getState().clearShortlist();
  clearStoredData(storage);
}

/** Entries saved in another tab or before this page loaded come first; nothing is lost. */
function mergeShortlists(stored: ShortlistEntry[], current: ShortlistEntry[]): ShortlistEntry[] {
  const ids = new Set(stored.map((entry) => entry.id));
  return [...stored, ...current.filter((entry) => !ids.has(entry.id))];
}

/**
 * Loads the saved shortlist into the store, then keeps storage in step: shortlist changes are
 * written at once, and the search is saved whenever its results arrive. Changes made in another
 * tab show up here too. Returns a function that stops it.
 */
export function startPersistence(store = appStore, storage = browserStorage()): () => void {
  store.setState({
    shortlist: mergeShortlists(readShortlist(storage), store.getState().shortlist),
    shortlistLoaded: true,
  });

  const unsubscribe = store.subscribe((state, previous) => {
    if (state.shortlist !== previous.shortlist) writeShortlist(state.shortlist, storage);
    const searchDone =
      state.status === "ready" &&
      (previous.status !== "ready" ||
        state.intent !== previous.intent ||
        state.hideUnconfirmed !== previous.hideUnconfirmed);
    if (searchDone && state.intent) {
      writeLastSearch({ intent: state.intent, hideUnconfirmed: state.hideUnconfirmed }, storage);
    }
  });

  const onStorage = (event: StorageEvent) => {
    // `key` is null when another tab cleared storage ("Clear my data").
    if (event.key !== SHORTLIST_KEY && event.key !== null) return;
    const shortlist = readShortlist(storage);
    if (JSON.stringify(shortlist) !== JSON.stringify(store.getState().shortlist)) {
      store.setState({ shortlist });
    }
  };
  window.addEventListener("storage", onStorage);

  return () => {
    unsubscribe();
    window.removeEventListener("storage", onStorage);
  };
}
