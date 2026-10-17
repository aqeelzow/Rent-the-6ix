"use client";

import { useEffect, useState } from "react";
import { fetchNearby } from "@/lib/store/actions";
import type { NearbyResponse } from "@/lib/store/types";

export type NearbyState =
  { status: "loading" } | { status: "ok"; nearby: NearbyResponse } | { status: "error" };

/** D's nearby places for one listing; read once by the page for both the tile and the section. */
export function useNearby(id: string): NearbyState {
  const [state, setState] = useState<{ id: string; value: NearbyState }>({
    id,
    value: { status: "loading" },
  });
  useEffect(() => {
    const controller = new AbortController();
    void fetchNearby(id, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      setState({
        id,
        value: result.ok ? { status: "ok", nearby: result.nearby } : { status: "error" },
      });
    });
    return () => controller.abort();
  }, [id]);
  // A different listing starts from loading, not the previous listing's places.
  return state.id === id ? state.value : { status: "loading" };
}
