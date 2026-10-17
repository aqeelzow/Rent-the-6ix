import {
  DestinationResolutionSchema,
  DetailResponseSchema,
  ErrorResponseSchema,
  ParseResponseSchema,
  SearchResponseSchema,
  SearchResultSchema,
} from "@rentthe6ix/shared/schemas";
import { z } from "zod";
import { appStore, type createAppStore } from "./store";
import type {
  ApiError,
  DestinationResolution,
  DetailResponse,
  SearchIntent,
  SearchResultItem,
} from "./types";

// Browser-side calls to B's routes (SPEC 13). Responses are validated with B's schemas before they
// reach the store; a response that doesn't match is treated as an error, never shown half-parsed.

type Store = ReturnType<typeof createAppStore>;

export type ActionOptions = {
  store?: Store;
  fetch?: typeof fetch;
  /** How often to poll a pending search (B's travel-percentile jobs). */
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

/** Client-side error codes; the UI maps every code to a message in en.json. */
export const clientErrorCodes = {
  network: "network_error",
  unexpected: "unexpected_response",
  expired: "search_job_expired",
  /** The route isn't built yet (a bare 404/405/501 without B's error body). */
  notAvailable: "not_available",
} as const;

const NOT_BUILT = new Set([404, 405, 501]);

type Result = { ok: true; json: unknown } | { ok: false; error: ApiError };

async function request(
  fetchFn: typeof fetch,
  url: string,
  init: { method: "GET" | "POST"; body?: unknown; signal?: AbortSignal },
): Promise<Result> {
  let response: Response;
  try {
    response = await fetchFn(url, {
      method: init.method,
      headers: init.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: init.signal,
    });
  } catch {
    return {
      ok: false,
      error: { code: clientErrorCodes.network, message: "Network request failed" },
    };
  }
  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    // Non-JSON body; handled below.
  }
  if (response.ok) return { ok: true, json };
  const parsed = ErrorResponseSchema.safeParse(json);
  if (parsed.success) return { ok: false, error: parsed.data.error };
  const code = NOT_BUILT.has(response.status)
    ? clientErrorCodes.notAvailable
    : clientErrorCodes.unexpected;
  return { ok: false, error: { code, message: `HTTP ${response.status}` } };
}

const unexpected: ApiError = {
  code: clientErrorCodes.unexpected,
  message: "Response did not match the API contract",
};

/** Reads a prompt with B's parser (Gemini or its fallback), then searches with the result. */
export async function parseAndSearch(prompt: string, options: ActionOptions = {}): Promise<void> {
  const store = options.store ?? appStore;
  const fetchFn = options.fetch ?? fetch;
  const { status, parsingPrompt } = store.getState();
  // Already reading this prompt (React runs effects twice in development).
  if (status === "parsing" && parsingPrompt === prompt) return;
  const requestId = store.getState().startParse(prompt);

  const response = await request(fetchFn, "/api/search/parse", {
    method: "POST",
    body: { prompt },
  });
  if (!response.ok) return store.getState().receiveError(requestId, response.error);
  const parsed = ParseResponseSchema.safeParse(response.json);
  if (!parsed.success) return store.getState().receiveError(requestId, unexpected);
  if (!store.getState().receiveParse(requestId, parsed.data)) return;

  await runSearch(options);
}

// The search in flight; a newer search cancels it so slow live searches don't pile up.
let inFlight: AbortController | null = null;

/** Searches with the current intent, without calling the parser (chip and filter edits). */
export async function runSearch(options: ActionOptions = {}): Promise<void> {
  const store = options.store ?? appStore;
  const fetchFn = options.fetch ?? fetch;
  const pollIntervalMs = options.pollIntervalMs ?? 1000;
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;

  let { intent } = store.getState();
  const { hideUnconfirmed } = store.getState();
  if (!intent) return;
  const requestId = store.getState().startSearch();
  const isCurrent = () => store.getState().searchRequestId === requestId;
  inFlight?.abort();
  const controller = new AbortController();
  inFlight = controller;
  const { signal } = controller;

  // Saved/shared searches can contain unresolved places from an earlier lookup failure.
  const unresolved = intent.travelTargets.filter(target => target.kind === "place" && target.query && !target.resolved);
  if (unresolved.length) {
    const locations = await Promise.all(unresolved.map(async target => {
      const response = await request(fetchFn, `/api/geo/resolve?q=${encodeURIComponent(target.query!)}`, { method: "GET", signal });
      if (!response.ok) return null;
      const resolution = DestinationResolutionSchema.safeParse(response.json);
      return resolution.success ? { targetId: target.id, resolution: resolution.data } : null;
    }));
    if (!isCurrent()) return;
    const destinations = locations.filter(location => location !== null);
    if (destinations.length) {
      intent = { ...intent, travelTargets: intent.travelTargets.map(target => {
        const resolution = destinations.find(destination => destination.targetId === target.id)?.resolution;
        return resolution?.status === "resolved" ? { ...target, label: resolution.destination.label, resolved: resolution.destination.resolved } : target;
      }) };
      store.setState({ intent, destinations: [...store.getState().destinations.filter(destination => !destinations.some(current => current.targetId === destination.targetId)), ...destinations] });
    }
  }

  let response = await request(fetchFn, "/api/listings/search", {
    method: "POST",
    body: { intent, hideUnconfirmed },
    signal,
  });

  for (;;) {
    if (!isCurrent()) return;
    if (!response.ok) return store.getState().receiveError(requestId, response.error);
    const parsed = SearchResponseSchema.safeParse(response.json);
    if (!parsed.success) return store.getState().receiveError(requestId, unexpected);

    const result = parsed.data;
    if (result.status === "completed") return store.getState().receiveResults(requestId, result);
    if (result.status === "unavailable") {
      return store.getState().receiveError(requestId, {
        code: `search_${result.reason}`,
        message: result.message,
      });
    }

    // Pending: B runs exact travel searches as a job; poll until it finishes or expires.
    if (now() >= Date.parse(result.expiresAt)) {
      return store.getState().receiveError(requestId, {
        code: clientErrorCodes.expired,
        message: "Search job expired",
      });
    }
    await sleep(pollIntervalMs);
    if (!isCurrent()) return;
    response = await request(fetchFn, result.pollUrl, { method: "GET", signal });
  }
}

/**
 * Opens a search from a shared link or this browser's last search, as it was edited, and runs it.
 * The parser isn't called, so the filters are exactly the ones that were saved.
 */
export async function restoreSearch(
  search: { intent: SearchIntent; hideUnconfirmed: boolean },
  options: ActionOptions = {},
): Promise<void> {
  const store = options.store ?? appStore;
  store.getState().loadSearch(search.intent, search.hideUnconfirmed);
  await runSearch(options);
}

/** Looks up a place with B's resolver: resolved, ambiguous (choices) or unavailable. */
export async function resolveDestination(
  query: string,
  options: Pick<ActionOptions, "fetch"> = {},
): Promise<{ ok: true; resolution: DestinationResolution } | { ok: false; error: ApiError }> {
  const response = await request(
    options.fetch ?? fetch,
    `/api/geo/resolve?q=${encodeURIComponent(query)}`,
    { method: "GET" },
  );
  if (!response.ok) return response;
  const parsed = DestinationResolutionSchema.safeParse(response.json);
  return parsed.success ? { ok: true, resolution: parsed.data } : { ok: false, error: unexpected };
}

/** An empty search, for opening a listing without one (a shared link). */
export const EMPTY_INTENT: SearchIntent = {
  schemaVersion: 1,
  rawPrompt: "",
  areas: [],
  criteria: {},
  travelTargets: [],
  safety: { enabled: false, hard: false },
  sortBy: "best_match",
  fieldSources: {},
  droppedRequests: [],
};

/**
 * The intent sent with a detail request. B's route scores the listing against it but must not
 * receive the renter's own words, so the prompt, phrases and dropped requests are removed.
 */
export function redactIntent(intent: SearchIntent): SearchIntent {
  return { ...intent, rawPrompt: "", fieldSources: {}, droppedRequests: [] };
}

/**
 * Draft of B's P3.2 response (SPEC 10.3), to confirm with B: the pasted listing, geocoded and
 * scored against the renter's search like any other result. Extra fields are allowed.
 */
const ImportResponseDraftSchema = z.object({ result: SearchResultSchema });

/**
 * Sends pasted listing text or a public link to B's import route. The intent is redacted like a
 * detail request; nothing pasted is stored on the server (SPEC 10.3).
 */
export async function importPastedListing(
  input: { text: string } | { url: string },
  intent: SearchIntent | null,
  options: Pick<ActionOptions, "fetch"> = {},
): Promise<{ ok: true; result: SearchResultItem } | { ok: false; error: ApiError }> {
  const response = await request(options.fetch ?? fetch, "/api/listings/import", {
    method: "POST",
    body: { ...input, intent: redactIntent(intent ?? EMPTY_INTENT) },
  });
  if (!response.ok) return response;
  const parsed = ImportResponseDraftSchema.safeParse(response.json);
  return parsed.success
    ? { ok: true, result: parsed.data.result }
    : { ok: false, error: unexpected };
}

/** Loads one listing with B's detail route: valuation, travel, areas, indicators, duplicates. */
export async function fetchListingDetail(
  id: string,
  intent: SearchIntent | null,
  options: Pick<ActionOptions, "fetch"> & { signal?: AbortSignal } = {},
): Promise<{ ok: true; detail: DetailResponse } | { ok: false; error: ApiError }> {
  const query = encodeURIComponent(JSON.stringify(redactIntent(intent ?? EMPTY_INTENT)));
  const response = await request(
    options.fetch ?? fetch,
    `/api/listings/${encodeURIComponent(id)}?intent=${query}`,
    { method: "GET", signal: options.signal },
  );
  if (!response.ok) return response;
  const parsed = DetailResponseSchema.safeParse(response.json);
  return parsed.success ? { ok: true, detail: parsed.data } : { ok: false, error: unexpected };
}
