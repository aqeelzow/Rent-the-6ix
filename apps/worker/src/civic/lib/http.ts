// Plain HTTP for the civic loaders. Unlike src/lib/fetch.ts (a stealth browser for listing sites),
// the City's CKAN and the TPS catalogue are open APIs: fetch() with retries is enough, and it
// keeps the loaders runnable in CI and on a small box.
const USER_AGENT = "RentThe6ix-civic-loader/0.1 (+https://github.com/aqeelzow/Rent-the-6ix)";
const RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const TIMEOUT_MS = 180_000;
// CKAN raises transient 502s; a full `data:civic all` run must not die on one, so keep retrying
// for roughly 15 seconds before giving up (1s + 2s + 4s + 8s).
const ATTEMPTS = 5;
const backoffMs = (attempt: number) => Math.min(1000 * 2 ** (attempt - 1), 8000);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** GET a URL as text. Retries network errors and 408/429/5xx with exponential backoff. */
export async function fetchText(url: string, attempts = ATTEMPTS): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { "user-agent": USER_AGENT, accept: "*/*" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: "follow",
      });
      if (RETRY_STATUSES.has(response.status)) {
        lastError = new Error(`HTTP ${response.status} at ${url}`);
      } else if (!response.ok) {
        // A 404 here is a real mistake (wrong slug or resource name): retrying cannot help.
        throw new Error(`HTTP ${response.status} at ${url}`);
      } else {
        return await response.text();
      }
    } catch (error) {
      if (error instanceof Error && /^HTTP 4\d\d/.test(error.message)) throw error;
      lastError = error;
    }
    if (attempt < attempts) await sleep(backoffMs(attempt));
  }
  throw lastError instanceof Error ? lastError : new Error(`failed to fetch ${url}`);
}

/** GET a binary body (ZIP archives). */
export async function fetchBuffer(url: string, attempts = ATTEMPTS): Promise<Buffer> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { "user-agent": USER_AGENT, accept: "*/*" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (response.ok) return Buffer.from(await response.arrayBuffer());
      lastError = new Error(`HTTP ${response.status} at ${url}`);
      if (!RETRY_STATUSES.has(response.status)) throw lastError;
    } catch (error) {
      if (error instanceof Error && /^HTTP 4\d\d/.test(error.message)) throw error;
      lastError = error;
    }
    if (attempt < attempts) await sleep(backoffMs(attempt));
  }
  throw lastError instanceof Error ? lastError : new Error(`failed to fetch ${url}`);
}

/** GET and parse JSON. */
export async function fetchJson<T>(url: string): Promise<T> {
  return JSON.parse(await fetchText(url)) as T;
}

/** POST a form body and parse JSON. Overpass rejects requests without a real user agent. */
export async function postFormJson<T>(url: string, body: string, attempts = ATTEMPTS): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "user-agent": USER_AGENT,
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded",
        },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (response.ok) return (await response.json()) as T;
      lastError = new Error(`HTTP ${response.status} at ${url}`);
      if (!RETRY_STATUSES.has(response.status)) throw lastError;
    } catch (error) {
      if (error instanceof Error && /^HTTP 4\d\d/.test(error.message)) throw error;
      lastError = error;
    }
    if (attempt < attempts) await sleep(backoffMs(attempt));
  }
  throw lastError instanceof Error ? lastError : new Error(`failed to POST ${url}`);
}
