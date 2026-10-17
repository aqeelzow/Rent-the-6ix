import type { StateCreator } from "zustand";
import type {
  ApiError,
  Listing,
  ParseResponse,
  SearchIntent,
  SearchResponse,
  SearchResultItem,
} from "./types";

export type SearchStatus = "idle" | "parsing" | "searching" | "ready" | "error";

type CompletedSearch = Extract<SearchResponse, { status: "completed" }>;

/**
 * How the list on screen is ordered. "server" keeps B's ranking (the intent's own sort); the other
 * two reorder the results already loaded, so switching them never costs another search.
 */
export type ResultOrder = "server" | "carbon" | "distance";

/**
 * What the shortlist shows for a saved listing until it's opened again: the figures as they were
 * when it was saved. Kept separate from `Listing` so saved shortlists survive schema changes.
 */
export type SavedListing = Pick<
  Listing,
  "title" | "monthlyRentCad" | "rentIsPerRoom" | "bedrooms" | "bathrooms" | "sqft" | "source"
> & {
  /** The source's thumbnail link, so the shortlist can show it; absent on older saves. */
  imageUrl?: Listing["imageUrl"];
};

/** Shortlisted listings live only in the browser (SPEC 15); pasted ones keep the whole listing. */
export type ShortlistEntry =
  | { kind: "listing"; id: string; addedAt: string; saved: SavedListing }
  | { kind: "pasted"; id: string; listing: Listing; addedAt: string };

export function savedListing(listing: Listing): SavedListing {
  const { title, monthlyRentCad, rentIsPerRoom, bedrooms, bathrooms, sqft, source, imageUrl } =
    listing;
  return { title, monthlyRentCad, rentIsPerRoom, bedrooms, bathrooms, sqft, source, imageUrl };
}

export interface SearchSlice {
  /** The current search: from the parser or the URL, then edited by chips and the filters panel. */
  intent: SearchIntent | null;
  /** How the last prompt was read (`gemini` or `fallback`), with B's notice when AI wasn't used. */
  parser: ParseResponse["parser"] | null;
  parseNotice: string | null;
  /** The prompt being read right now, so the same prompt isn't sent twice. */
  parsingPrompt: string | null;
  /** Place lookups from the parser; `ambiguous` ones need the renter to pick a choice. */
  destinations: ParseResponse["destinations"];
  results: SearchResultItem[];
  /** Listings that passed the filters; `results` may be a ranked subset of them. */
  eligibleCount: number;
  notices: string[];
  /** "Hide listings that don't confirm my must-haves" (SPEC 7.1). */
  hideUnconfirmed: boolean;
  /** The order shown in the results header; "server" is B's ranking for the intent's sort. */
  resultOrder: ResultOrder;
  status: SearchStatus;
  /** When the current parse or search started (ms), for the "taking a while" message. */
  busySince: number | null;
  error: ApiError | null;
  /** Goes up by one on every parse or search; responses to older requests are dropped. */
  searchRequestId: number;

  shortlist: ShortlistEntry[];
  /** True once the shortlist has been read from browser storage (see `persist.ts`). */
  shortlistLoaded: boolean;

  /**
   * Selection contract (TEAM.md 3.8), read and set by the results list, the map and the detail view.
   * Hover: a card highlights its pin and a pin highlights its card. Select: a pin scrolls the list
   * to its card (bottom sheet on mobile). Ids are `result.listing.id`.
   */
  hoveredListingId: string | null;
  selectedListingId: string | null;
  /** Where the selection came from: a map pin scrolls the list to its card; a card doesn't. */
  selectedFrom: "map" | "list" | null;

  setIntent: (intent: SearchIntent | null) => void;
  /** For chip and filter edits. Callers re-run search afterwards; editing never calls Gemini. */
  updateIntent: (update: (intent: SearchIntent) => SearchIntent) => void;
  setHideUnconfirmed: (hide: boolean) => void;
  setResultOrder: (order: ResultOrder) => void;
  /** Opens a saved or shared search as it was edited; nothing from an earlier parse is kept. */
  loadSearch: (intent: SearchIntent, hideUnconfirmed: boolean) => void;
  /** Marks a prompt as being read and returns its request id, to pass to `receiveParse`. */
  startParse: (prompt: string) => number;
  /** Stores the parsed intent. Returns false when a newer request has started. */
  receiveParse: (requestId: number, response: ParseResponse) => boolean;
  /** Marks a search as running and returns its request id, to pass to `receive*`. */
  startSearch: () => number;
  receiveResults: (requestId: number, response: CompletedSearch) => void;
  receiveError: (requestId: number, error: ApiError) => void;

  toggleShortlist: (listing: Listing) => void;
  addPastedListing: (listing: Listing) => void;
  removeFromShortlist: (id: string) => void;
  /** Fills in the photo link of a listing saved before shortlists kept it (null: none). */
  setSavedImage: (id: string, imageUrl: string | null) => void;
  clearShortlist: () => void;

  setHoveredListingId: (id: string | null) => void;
  setSelectedListingId: (id: string | null, from?: "map" | "list") => void;
}

export const createSearchSlice: StateCreator<SearchSlice, [], [], SearchSlice> = (set, get) => ({
  intent: null,
  parser: null,
  parseNotice: null,
  parsingPrompt: null,
  destinations: [],
  results: [],
  eligibleCount: 0,
  notices: [],
  hideUnconfirmed: false,
  resultOrder: "server",
  status: "idle",
  busySince: null,
  error: null,
  searchRequestId: 0,
  shortlist: [],
  shortlistLoaded: false,
  hoveredListingId: null,
  selectedListingId: null,
  selectedFrom: null,

  setIntent: (intent) => set({ intent }),

  updateIntent: (update) => {
    const { intent } = get();
    if (intent) set({ intent: update(intent) });
  },

  setHideUnconfirmed: (hideUnconfirmed) => set({ hideUnconfirmed }),

  setResultOrder: (resultOrder) => set({ resultOrder }),

  loadSearch: (intent, hideUnconfirmed) =>
    set({
      intent,
      hideUnconfirmed,
      parser: null,
      parseNotice: null,
      parsingPrompt: null,
      destinations: [],
    }),

  startParse: (prompt) => {
    const requestId = get().searchRequestId + 1;
    set({
      searchRequestId: requestId,
      status: "parsing",
      parsingPrompt: prompt,
      busySince: Date.now(),
      error: null,
    });
    return requestId;
  },

  receiveParse: (requestId, response) => {
    if (requestId !== get().searchRequestId) return false;
    set({
      parsingPrompt: null,
      intent: response.intent,
      parser: response.parser,
      parseNotice: response.notice ?? null,
      destinations: response.destinations,
    });
    return true;
  },

  startSearch: () => {
    const requestId = get().searchRequestId + 1;
    set({ searchRequestId: requestId, status: "searching", busySince: Date.now(), error: null });
    return requestId;
  },

  receiveResults: (requestId, response) => {
    if (requestId !== get().searchRequestId) return;
    const ids = new Set(response.results.map((result) => result.listing.id));
    const { hoveredListingId, selectedListingId } = get();
    set({
      results: response.results,
      eligibleCount: response.eligibleCount,
      notices: response.notices,
      status: "ready",
      busySince: null,
      error: null,
      // A listing that dropped out of the results can't stay highlighted.
      hoveredListingId: hoveredListingId && ids.has(hoveredListingId) ? hoveredListingId : null,
      selectedListingId: selectedListingId && ids.has(selectedListingId) ? selectedListingId : null,
    });
  },

  receiveError: (requestId, error) => {
    if (requestId !== get().searchRequestId) return;
    // Keep the previous results on screen; the UI shows the error next to them.
    set({ status: "error", error, parsingPrompt: null, busySince: null });
  },

  toggleShortlist: (listing) => {
    const { shortlist } = get();
    const { id } = listing;
    set({
      shortlist: shortlist.some((entry) => entry.id === id)
        ? shortlist.filter((entry) => entry.id !== id)
        : [
            ...shortlist,
            {
              kind: "listing",
              id,
              addedAt: new Date().toISOString(),
              saved: savedListing(listing),
            },
          ],
    });
  },

  addPastedListing: (listing) => {
    const rest = get().shortlist.filter((entry) => entry.id !== listing.id);
    set({
      shortlist: [
        ...rest,
        { kind: "pasted", id: listing.id, listing, addedAt: new Date().toISOString() },
      ],
    });
  },

  removeFromShortlist: (id) =>
    set({ shortlist: get().shortlist.filter((entry) => entry.id !== id) }),

  setSavedImage: (id, imageUrl) =>
    set({
      shortlist: get().shortlist.map((entry) =>
        entry.kind === "listing" && entry.id === id
          ? { ...entry, saved: { ...entry.saved, imageUrl } }
          : entry,
      ),
    }),

  clearShortlist: () => set({ shortlist: [] }),

  setHoveredListingId: (id) => set({ hoveredListingId: id }),
  setSelectedListingId: (id, from = "map") =>
    set({ selectedListingId: id, selectedFrom: id === null ? null : from }),
});

export const selectIsShortlisted = (id: string) => (state: SearchSlice) =>
  state.shortlist.some((entry) => entry.id === id);
