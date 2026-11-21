// Shared fetch layer for every source (SPEC 8.4): one CloakBrowser (stealth Chromium driven through
// Playwright) page per source, a fixed delay between requests, retries on network errors and 5xx.
//
// Getting past blocks (#32), in order:
// 1. A Cloudflare "Just a moment…" interstitial often clears by itself in a stealth browser:
//    wait up to CHALLENGE_WAIT_MS for it.
// 2. A Turnstile CAPTCHA is solved through CAPTCHA_PROVIDER / CAPTCHA_API_KEY when configured.
// 3. Otherwise the session moves to the next proxy (PROXY_URLS) and tries the page again, once
//    per proxy.
// Only when all of that fails is the source blocked: the run marks it unhealthy and moves on.
//
// A crashed tab (heavy map pages, after hundreds of visits) is replaced and the page retried, and
// the tab is recycled every RECYCLE_EVERY visits so memory doesn't build up.
import { launch, launchPersistentContext } from "cloakbrowser";
import type { Browser, BrowserContext, Page, Response } from "playwright-core";
import {
  applyTurnstileToken,
  captchaSolverFromEnv,
  findTurnstile,
  type CaptchaSolver,
} from "./captcha.ts";
import { ProxyPool, redactProxy } from "./proxies.ts";

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

/** What the session had to do to get its pages, for the run log and /status. */
export interface SessionStats {
  visits: number;
  /** Block pages seen (before any workaround). */
  blocks: number;
  /** Interstitials that cleared on their own. */
  challengesPassed: number;
  captchasSolved: number;
  captchasFailed: number;
  /** Proxy switches after a block. */
  rotations: number;
  /** Tabs that crashed and were replaced. */
  crashes: number;
}

export interface Session {
  visit(url: string, options?: VisitOptions): Promise<VisitResult>;
  stats(): SessionStats;
  close(): Promise<void>;
}

const BLOCK_STATUSES = new Set([401, 403, 429]);
const BLOCK_TITLE =
  /just a moment|attention required|access .*denied|you have been blocked|captcha|are you a robot|verify you are human/i;
/** Interstitials that can clear by themselves (Cloudflare's managed challenge). */
const CHALLENGE_TITLE = /just a moment|checking your browser|verify you are human/i;
const CRASHED =
  /page crashed|target (page, context or browser )?(has been )?closed|browser has been closed/i;
const MAX_ATTEMPTS = 3;

export interface SessionOptions {
  userAgent?: string;
  delayMs?: number;
  headless?: boolean;
  /**
   * A saved browser profile (cookies, local storage) to run in, e.g. a logged-in Facebook
   * session. Without one, every session starts clean.
   */
  profileDir?: string;
  /** Proxy URLs to rotate through on blocks (see proxies.ts); empty or absent = direct. */
  proxies?: string[];
  /** CAPTCHA solver; defaults to the one configured in the environment, if any. */
  captcha?: CaptchaSolver | null;
  /** How long to wait for an interstitial to clear by itself. */
  challengeWaitMs?: number;
  /** Replace the tab after this many visits. */
  recycleEvery?: number;
  /** Label for log lines. */
  label?: string;
}

export function isBlockPage(status: number, title: string): boolean {
  return BLOCK_STATUSES.has(status) || BLOCK_TITLE.test(title);
}

const PROXY_FAILED = /ERR_PROXY|ERR_TUNNEL|ERR_SOCKS|proxy.*(refused|failed|auth)/i;

export function isProxyFailure(error: unknown): boolean {
  return error instanceof Error && PROXY_FAILED.test(error.message);
}

export function isCrash(error: unknown): boolean {
  return error instanceof Error && CRASHED.test(error.message);
}

export async function openSession(options: SessionOptions = {}): Promise<Session> {
  const userAgent = options.userAgent ?? process.env.USER_AGENT;
  const delayMs = options.delayMs ?? Number(process.env.INGEST_REQUEST_DELAY_MS ?? 4000);
  const challengeWaitMs =
    options.challengeWaitMs ?? Number(process.env.CHALLENGE_WAIT_MS ?? 20_000);
  const recycleEvery = options.recycleEvery ?? Number(process.env.RECYCLE_EVERY ?? 100);
  const captcha = options.captcha === undefined ? captchaSolverFromEnv() : options.captcha;
  const pool = new ProxyPool(options.proxies ?? []);
  const label = options.label ?? "fetch";
  const stats: SessionStats = {
    visits: 0,
    blocks: 0,
    challengesPassed: 0,
    captchasSolved: 0,
    captchasFailed: 0,
    rotations: 0,
    crashes: 0,
  };

  let browser: Browser | null = null;
  let context!: BrowserContext;
  let page!: Page;
  let pageVisits = 0;

  async function start(proxy: string | null): Promise<void> {
    // Locale and timezone go through CloakBrowser's binary flags, not context emulation.
    const launchOptions = {
      headless: options.headless ?? true,
      locale: "en-CA",
      timezone: "America/Toronto",
      ...(proxy ? { proxy } : {}),
    };
    if (options.profileDir) {
      browser = null;
      context = await launchPersistentContext({
        ...launchOptions,
        userDataDir: options.profileDir,
        ...(userAgent ? { userAgent } : {}),
      });
    } else {
      browser = await launch(launchOptions);
      context = await browser.newContext(userAgent ? { userAgent } : {});
    }
    // Listing photos are never stored, so don't download them either.
    await context.route("**/*", (route) =>
      ["image", "media", "font"].includes(route.request().resourceType())
        ? route.abort()
        : route.continue(),
    );
    page = await context.newPage();
    pageVisits = 0;
    if (proxy) console.log(`${label}: via proxy ${redactProxy(proxy)}`);
  }

  async function stop(): Promise<void> {
    // A persistent context owns its browser: closing it closes both.
    await (browser ?? context)?.close().catch(() => {});
  }

  /** A fresh tab in the same browser; the whole browser if the context died with it. */
  async function replacePage(): Promise<void> {
    await page.close().catch(() => {});
    try {
      page = await context.newPage();
      pageVisits = 0;
    } catch {
      await stop();
      await start(pool.current());
    }
  }

  /** Try to get past a block page in place. True when the real page is now showing. */
  async function getPast(title: string): Promise<boolean> {
    if (CHALLENGE_TITLE.test(title)) {
      const deadline = Date.now() + challengeWaitMs;
      while (Date.now() < deadline) {
        await page.waitForTimeout(1000);
        const now = await page.title().catch(() => title);
        if (!BLOCK_TITLE.test(now)) {
          stats.challengesPassed++;
          return true;
        }
      }
    }
    if (!captcha) return false;
    const task = await findTurnstile(page).catch(() => null);
    if (!task) return false;
    try {
      const token = await captcha.solveTurnstile(task);
      await applyTurnstileToken(page, token);
      await page.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(3000);
      if (!BLOCK_TITLE.test(await page.title().catch(() => ""))) {
        stats.captchasSolved++;
        return true;
      }
    } catch (error) {
      console.warn(`${label}: ${captcha.name} failed: ${(error as Error).message}`);
    }
    stats.captchasFailed++;
    return false;
  }

  let lastVisit = 0;

  async function visitOnce(url: string, opts: VisitOptions): Promise<VisitResult> {
    const wait = lastVisit + delayMs - Date.now();
    if (wait > 0) await sleep(wait);
    lastVisit = Date.now();
    if (pageVisits >= recycleEvery) await replacePage();
    pageVisits++;
    stats.visits++;

    const pending: Promise<unknown>[] = [];
    const onResponse = (response: Response) => {
      const type = response.headers()["content-type"] ?? "";
      if (opts.captureJson?.(response.url()) && type.includes("json")) {
        pending.push(response.json().catch(() => null));
      }
    };
    const current = page;
    current.on("response", onResponse);
    try {
      // A URL that differs only by #hash is a same-page navigation: no load, no new requests.
      // Leave the page first so the site loads (and fetches its results) again.
      if (withoutHash(current.url()) === withoutHash(url)) await current.goto("about:blank");
      const response = await current.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      let status = response?.status() ?? 0;
      const title = await current.title();
      if (isBlockPage(status, title)) {
        stats.blocks++;
        if (!(await getPast(title))) throw new SourceBlockedError(url, `HTTP ${status} "${title}"`);
        status = 200;
      }
      if (status >= 500) throw new Error(`HTTP ${status} at ${url}`);
      if (opts.settleMs) await current.waitForTimeout(opts.settleMs);
      const json = (await Promise.all(pending)).filter((body) => body !== null);
      return { status, url: current.url(), html: await current.content(), json };
    } finally {
      current.off("response", onResponse);
    }
  }

  await start(pool.current());

  return {
    async visit(url, opts = {}) {
      // Each proxy gets one go at a blocked page; network errors and crashes get MAX_ATTEMPTS.
      let rotationsLeft = pool.size - 1;
      for (let attempt = 1; ; attempt++) {
        try {
          return await visitOnce(url, opts);
        } catch (error) {
          if (error instanceof SourceBlockedError) {
            if (rotationsLeft-- <= 0) throw error;
            stats.rotations++;
            console.warn(`${label}: ${error.reason}; switching proxy`);
            await stop();
            await start(pool.next());
            attempt--;
            continue;
          }
          // A proxy that refuses or drops the connection: move on to the next one.
          if (isProxyFailure(error) && rotationsLeft-- > 0) {
            stats.rotations++;
            console.warn(
              `${label}: proxy failed (${(error as Error).message.split("\n")[0]}); switching`,
            );
            await stop();
            await start(pool.next());
            attempt--;
            continue;
          }
          if (isCrash(error)) {
            stats.crashes++;
            console.warn(`${label}: tab crashed at ${url}; replacing it`);
            await replacePage();
          }
          if (attempt >= MAX_ATTEMPTS) throw error;
          await sleep(delayMs * attempt);
        }
      }
    },
    stats: () => ({ ...stats }),
    close: stop,
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withoutHash(url: string) {
  return url.split("#")[0];
}
