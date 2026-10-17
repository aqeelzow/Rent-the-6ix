import { useMemo, useSyncExternalStore } from "react";
import { LAST_SEARCH_KEY, parseLastSearch, type LastSearch } from "./persist";

function subscribeToStorage(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

// The stored text, a string, so `useSyncExternalStore` sees no change between identical reads.
function storedLastSearch(): string | null {
  try {
    return window.localStorage.getItem(LAST_SEARCH_KEY);
  } catch {
    return null;
  }
}

/** This browser's last search, or null (always null on the server and before hydration). */
export function useLastSearch(): LastSearch | null {
  const raw = useSyncExternalStore(subscribeToStorage, storedLastSearch, () => null);
  return useMemo(() => parseLastSearch(raw), [raw]);
}
