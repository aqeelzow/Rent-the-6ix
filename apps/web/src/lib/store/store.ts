import { createStore, useStore } from "zustand";
import { createSearchSlice, type SearchSlice } from "./searchSlice";

// Combines the slices; nothing else lives here (TEAM.md section 2).
export type AppState = SearchSlice;

export const createAppStore = () =>
  createStore<AppState>()((...args) => ({
    ...createSearchSlice(...args),
  }));

/** The browser's single store. Use from client components only; never set state on the server. */
export const appStore = createAppStore();

/**
 * Read state with a selector, e.g. `useAppStore((s) => s.hoveredListingId)`.
 * Selectors must return existing values or primitives, not new objects or arrays.
 */
export function useAppStore<T>(selector: (state: AppState) => T): T {
  return useStore(appStore, selector);
}
