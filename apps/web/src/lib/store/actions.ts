import {
  DestinationResolutionSchema,
  ErrorResponseSchema,
  ParseResponseSchema,
  SearchResponseSchema,
} from "@rentthe6ix/shared/schemas";
import { appStore, type createAppStore } from "./store";
import type { ApiError, DestinationResolution } from "./types";

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
} as const;

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
  return {
    ok: false,
    error: parsed.success
      ? parsed.data.error
      : { code: clientErrorCodes.unexpected, message: `HTTP ${response.status}` },
  };
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

  const { intent, hideUnconfirmed } = store.getState();
  if (!intent) return;
  const requestId = store.getState().startSearch();
  const isCurrent = () => store.getState().searchRequestId === requestId;
  inFlight?.abort();
  const controller = new AbortController();
  inFlight = controller;
  const { signal } = controller;

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
