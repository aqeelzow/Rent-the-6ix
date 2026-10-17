import type { StateCreator } from "zustand";
import type { ApiError, Listing, SearchIntent, SearchResultItem } from "./types";

export type SearchStatus = "idle" | "searching" | "ready" | "error";

/** Shortlisted listings live only in the browser (SPEC 15); pasted ones keep the whole listing. */
export type ShortlistEntry =
  | { kind: "listing"; id: string; addedAt: string }
  | { kind: "pasted"; id: string; listing: Listing; addedAt: string };

export interface SearchSlice {
  /** The current search: from the parser or the URL, then edited by chips and the filters panel. */
  intent: SearchIntent | null;
  results: SearchResultItem[];
  status: SearchStatus;
  error: ApiError | null;
  /** Goes up by one on every search; responses to older requests are dropped. */
  searchRequestId: number;

  shortlist: ShortlistEntry[];

  /**
   * Selection contract (TEAM.md 3.8), read and set by the results list, the map and the detail view.
   * Hover: a card highlights its pin and a pin highlights its card. Select: a pin scrolls the list
   * to its card (bottom sheet on mobile).
   */
  hoveredListingId: string | null;
  selectedListingId: string | null;

  setIntent: (intent: SearchIntent | null) => void;
  /** For chip and filter edits. Callers re-run search afterwards; editing never calls Gemini. */
  updateIntent: (update: (intent: SearchIntent) => SearchIntent) => void;
  /** Marks a search as running and returns its request id, to pass to `receive*`. */
  startSearch: () => number;
  receiveResults: (requestId: number, results: SearchResultItem[]) => void;
  receiveError: (requestId: number, error: ApiError) => void;

  toggleShortlist: (id: string) => void;
  addPastedListing: (listing: Listing) => void;
  removeFromShortlist: (id: string) => void;
  clearShortlist: () => void;

  setHoveredListingId: (id: string | null) => void;
  setSelectedListingId: (id: string | null) => void;
}

export const createSearchSlice: StateCreator<SearchSlice, [], [], SearchSlice> = (set, get) => ({
  intent: null,
  results: [],
  status: "idle",
  error: null,
  searchRequestId: 0,
  shortlist: [],
  hoveredListingId: null,
  selectedListingId: null,

  setIntent: (intent) => set({ intent }),

  updateIntent: (update) => {
    const { intent } = get();
    if (intent) set({ intent: update(intent) });
  },

  startSearch: () => {
    const requestId = get().searchRequestId + 1;
    set({ searchRequestId: requestId, status: "searching", error: null });
    return requestId;
  },

  receiveResults: (requestId, results) => {
    if (requestId !== get().searchRequestId) return;
    const ids = new Set(results.map((result) => result.id));
    const { hoveredListingId, selectedListingId } = get();
    set({
      results,
      status: "ready",
      error: null,
      // A listing that dropped out of the results can't stay highlighted.
      hoveredListingId: hoveredListingId && ids.has(hoveredListingId) ? hoveredListingId : null,
      selectedListingId: selectedListingId && ids.has(selectedListingId) ? selectedListingId : null,
    });
  },

  receiveError: (requestId, error) => {
    if (requestId !== get().searchRequestId) return;
    // Keep the previous results on screen; the UI shows the error next to them.
    set({ status: "error", error });
  },

  toggleShortlist: (id) => {
    const { shortlist } = get();
    set({
      shortlist: shortlist.some((entry) => entry.id === id)
        ? shortlist.filter((entry) => entry.id !== id)
        : [...shortlist, { kind: "listing", id, addedAt: new Date().toISOString() }],
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

  clearShortlist: () => set({ shortlist: [] }),

  setHoveredListingId: (id) => set({ hoveredListingId: id }),
  setSelectedListingId: (id) => set({ selectedListingId: id }),
});

export const selectIsShortlisted = (id: string) => (state: SearchSlice) =>
  state.shortlist.some((entry) => entry.id === id);
