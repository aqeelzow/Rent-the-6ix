// CAPTCHA solving for the fetch layer (#32). Cloudflare Turnstile is the widget our sources show
// (Rentals.ca's "Just a moment…" page); 2Captcha solves it from the widget's sitekey and the
// page URL and returns a token the page accepts in place of a click.
//
// Configured by CAPTCHA_PROVIDER=2captcha and CAPTCHA_API_KEY. Without them no solver exists and
// a CAPTCHA page counts as a block, as before.
import type { Page } from "playwright-core";

export interface TurnstileTask {
  sitekey: string;
  pageurl: string;
  /** `data-action` and `data-cdata` on Cloudflare challenge pages; optional on plain widgets. */
  action?: string;
  data?: string;
}

export interface CaptchaSolver {
  name: string;
  solveTurnstile(task: TurnstileTask): Promise<string>;
}

type Fetch = typeof fetch;

const TWO_CAPTCHA = "https://2captcha.com";
const POLL_MS = 5_000;
const TIMEOUT_MS = 180_000;

/** 2Captcha's in.php / res.php API (method=turnstile). */
export function twoCaptcha(
  apiKey: string,
  http: Fetch = fetch,
  pollMs = POLL_MS,
  timeoutMs = TIMEOUT_MS,
): CaptchaSolver {
  return {
    name: "2captcha",
    async solveTurnstile(task) {
      const form = new URLSearchParams({
        key: apiKey,
        method: "turnstile",
        sitekey: task.sitekey,
        pageurl: task.pageurl,
        json: "1",
      });
      if (task.action) form.set("action", task.action);
      if (task.data) form.set("data", task.data);
      const submitted = (await (
        await http(`${TWO_CAPTCHA}/in.php`, { method: "POST", body: form })
      ).json()) as { status: number; request: string };
      if (submitted.status !== 1) throw new Error(`2captcha: ${submitted.request}`);

      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, pollMs));
        const params = new URLSearchParams({
          key: apiKey,
          action: "get",
          id: submitted.request,
          json: "1",
        });
        const result = (await (await http(`${TWO_CAPTCHA}/res.php?${params}`)).json()) as {
          status: number;
          request: string;
        };
        if (result.status === 1) return result.request;
        if (result.request !== "CAPCHA_NOT_READY") throw new Error(`2captcha: ${result.request}`);
      }
      throw new Error("2captcha: no answer in time");
    },
  };
}

/** The configured solver, or null (no solving). */
export function captchaSolverFromEnv(env = process.env): CaptchaSolver | null {
  const provider = env.CAPTCHA_PROVIDER?.toLowerCase();
  const key = env.CAPTCHA_API_KEY;
  if (!provider || !key) return null;
  if (provider === "2captcha") return twoCaptcha(key);
  throw new Error(`CAPTCHA_PROVIDER "${env.CAPTCHA_PROVIDER}" is not supported (use 2captcha)`);
}

// Runs inside the page; kept as source text because the worker isn't compiled with DOM types.
const FIND_TURNSTILE = `(() => {
  const el = document.querySelector(".cf-turnstile[data-sitekey], [data-sitekey]");
  if (el && el.dataset.sitekey) {
    return { sitekey: el.dataset.sitekey, action: el.dataset.action, data: el.dataset.cdata };
  }
  // Challenge pages render the widget in an iframe whose URL carries the sitekey.
  for (const frame of document.querySelectorAll("iframe")) {
    const m = frame.src.match(/\\/(0x[0-9A-Za-z_-]{10,})\\//);
    if (m && frame.src.includes("challenges.cloudflare.com")) return { sitekey: m[1] };
  }
  return null;
})()`;

const APPLY_TOKEN = `((value) => {
  for (const input of document.querySelectorAll(
    'input[name="cf-turnstile-response"], input[name="g-recaptcha-response"]',
  )) {
    input.value = value;
  }
  const el = document.querySelector("[data-sitekey]");
  const callback = el && el.dataset.callback;
  const fn = callback ? window[callback] : null;
  if (typeof fn === "function") fn(value);
  else if (el && el.closest("form")) el.closest("form").submit();
})`;

/** The Turnstile widget on the page, if there is one. */
export async function findTurnstile(page: Page): Promise<TurnstileTask | null> {
  const found = (await page.evaluate(FIND_TURNSTILE)) as Omit<TurnstileTask, "pageurl"> | null;
  return found ? { ...found, pageurl: page.url() } : null;
}

/**
 * Put a solved token where Turnstile would: the hidden response input(s), then the widget's
 * callback if it names one, else submit the enclosing form.
 */
export async function applyTurnstileToken(page: Page, token: string): Promise<void> {
  await page.evaluate(`${APPLY_TOKEN}(${JSON.stringify(token)})`);
}
