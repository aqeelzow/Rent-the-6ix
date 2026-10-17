"use client";

import { useEffect, useState } from "react";
import { fetchListingDetail } from "@/lib/store/actions";
import { appStore, useAppStore } from "@/lib/store/store";
import type { ApiError, DetailResponse, SearchResultItem } from "@/lib/store/types";

type DetailState =
  | { status: "loading" }
  | { status: "ok"; detail: DetailResponse }
  | { status: "error"; error: ApiError };

/**
 * One listing for the detail page. Coming from search, the result already in the store shows at
 * once; B's detail route then adds areas, indicators, duplicates and travel rows. A shared link
 * (no search) waits for the detail route.
 */
export function useListingDetail(id: string): {
  data: SearchResultItem | DetailResponse | undefined;
  extras: DetailResponse | null;
  loading: boolean;
  error: ApiError | null;
  retry: () => void;
} {
  const fromSearch = useAppStore((s) => s.results.find((r) => r.listing.id === id));
  const [state, setState] = useState<DetailState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    // The search's intent, read once: later chip edits don't refetch an open listing.
    void fetchListingDetail(id, appStore.getState().intent, { signal: controller.signal }).then(
      (result) => {
        if (controller.signal.aborted) return;
        setState(
          result.ok
            ? { status: "ok", detail: result.detail }
            : { status: "error", error: result.error },
        );
      },
    );
    return () => controller.abort();
  }, [id, attempt]);

  const extras = state.status === "ok" ? state.detail : null;
  return {
    data: extras ?? fromSearch,
    extras,
    loading: state.status === "loading",
    error: state.status === "error" ? state.error : null,
    retry: () => {
      setState({ status: "loading" });
      setAttempt((n) => n + 1);
    },
  };
}
