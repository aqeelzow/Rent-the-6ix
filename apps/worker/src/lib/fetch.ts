// Shared fetch layer for every source (SPEC 8.4): one CloakBrowser (stealth Chromium driven through
// Playwright) page per source, a fixed delay between requests, retries on network errors and 5xx, and a hard stop when a site blocks us.
// A blocked source is never retried around: the run marks it unhealthy and moves on.
import { launch } from "cloakbrowser";
import type { Browser, BrowserContext, Page, Response } from "playwright-core";

export class SourceBlockedError extends Error {
  readonly url: string;
  readonly reason: string;

  constructor(url: string, reason: string) {
    super(`blocked at ${url}: ${reason}`);
    this.name = "SourceBlockedError";
    this.url = url;
    this.reason = reason;
  }
}

export interface VisitOptions {
  /** Keep JSON response bodies whose URL matches (e.g. a site's GraphQL endpoint). */
  captureJson?: (url: string) => boolean;
  /** Extra wait after DOM load so client-side requests can finish. */
  settleMs?: number;
}

export interface VisitResult {
  status: number;
  url: string;
  html: string;
  json: unknown[];
}

export interface Session {
  visit(url: string, options?: VisitOptions): Promise<VisitResult>;
  close(): Promise<void>;
}

const BLOCK_STATUSES = new Set([401, 403, 429]);
const BLOCK_TITLE =
  /just a moment|attention required|access .*denied|you have been blocked|captcha|are you a robot|verify you are human/i;
const MAX_ATTEMPTS = 3;

export interface SessionOptions {
  userAgent?: string;
  delayMs?: number;
  headless?: boolean;
}

export async function openSession(options: SessionOptions = {}): Promise<Session> {
  const userAgent = options.userAgent ?? process.env.USER_AGENT;
  const delayMs = options.delayMs ?? Number(process.env.INGEST_REQUEST_DELAY_MS ?? 4000);
  // Locale and timezone go through CloakBrowser's binary flags, not context emulation.
  const browser: Browser = await launch({
    headless: options.headless ?? true,
    locale: "en-CA",
    timezone: "America/Toronto",
  });
  const context: BrowserContext = await browser.newContext(userAgent ? { userAgent } : {});
  // Listing photos are never stored, so don't download them either.
  await context.route("**/*", (route) =>
    ["image", "media", "font"].includes(route.request().resourceType())
      ? route.abort()
      : route.continue(),
  );
  const page: Page = await context.newPage();
  let lastVisit = 0;

  async function visitOnce(url: string, opts: VisitOptions): Promise<VisitResult> {
    const wait = lastVisit + delayMs - Date.now();
    if (wait > 0) await sleep(wait);
    lastVisit = Date.now();

    const pending: Promise<unknown>[] = [];
    const onResponse = (response: Response) => {
      const type = response.headers()["content-type"] ?? "";
      if (opts.captureJson?.(response.url()) && type.includes("json")) {
        pending.push(response.json().catch(() => null));
      }
    };
    page.on("response", onResponse);
    try {
      const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      const status = response?.status() ?? 0;
      const title = await page.title();
      if (BLOCK_STATUSES.has(status) || BLOCK_TITLE.test(title)) {
        throw new SourceBlockedError(url, `HTTP ${status} "${title}"`);
      }
      if (status >= 500) throw new Error(`HTTP ${status} at ${url}`);
      if (opts.settleMs) await page.waitForTimeout(opts.settleMs);
      const json = (await Promise.all(pending)).filter((body) => body !== null);
      return { status, url: page.url(), html: await page.content(), json };
    } finally {
      page.off("response", onResponse);
    }
  }

  return {
    async visit(url, opts = {}) {
      for (let attempt = 1; ; attempt++) {
        try {
          return await visitOnce(url, opts);
        } catch (error) {
          if (error instanceof SourceBlockedError || attempt >= MAX_ATTEMPTS) throw error;
          await sleep(delayMs * attempt);
        }
      }
    },
    async close() {
      await browser.close();
    },
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
