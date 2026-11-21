import { describe, expect, it } from "vitest";
import { describeStats } from "../pipeline/run-ingest.ts";
import { captchaSolverFromEnv, twoCaptcha } from "./captcha.ts";
import { isBlockPage, isCrash, isProxyFailure } from "./fetch.ts";
import { ProxyPool, proxiesFor, redactProxy } from "./proxies.ts";

describe("proxies", () => {
  it("reads a source's own list first, then the shared one, and 'none' turns them off", () => {
    const env = {
      PROXY_URLS: "http://u:p@a.example:1, http://u:p@b.example:2",
      PROXY_URLS_KIJIJI: "http://u:p@k.example:3\nhttp://u:p@k.example:4",
      PROXY_URLS_ZILLOW: "none",
    };
    expect(proxiesFor("kijiji", env)).toEqual(["http://u:p@k.example:3", "http://u:p@k.example:4"]);
    expect(proxiesFor("rentals_ca", env)).toEqual([
      "http://u:p@a.example:1",
      "http://u:p@b.example:2",
    ]);
    expect(proxiesFor("zillow", env)).toEqual([]);
    expect(proxiesFor("kijiji", {})).toEqual([]);
  });

  it("never logs credentials", () => {
    expect(redactProxy("http://user:secret@gate.example.com:7000")).toBe("gate.example.com:7000");
    expect(redactProxy("user:secret@gate.example.com:7000")).toBe("gate.example.com:7000");
  });

  it("rotates round-robin, and direct is the only way out without proxies", () => {
    const pool = new ProxyPool(["a", "b", "c"], 1);
    expect([pool.current(), pool.next(), pool.next(), pool.next()]).toEqual(["b", "c", "a", "b"]);
    expect(pool.canRotate).toBe(true);
    const direct = new ProxyPool([]);
    expect([direct.current(), direct.canRotate, direct.size]).toEqual([null, false, 1]);
  });
});

describe("block pages", () => {
  it("tells block pages and crashes apart from ordinary failures", () => {
    expect(isBlockPage(200, "Just a moment...")).toBe(true);
    expect(isBlockPage(429, "Rentals.ca")).toBe(true);
    expect(isBlockPage(200, "Rentals.ca Waterloo Apartments")).toBe(false);
    expect(isCrash(new Error("page.goto: Page crashed"))).toBe(true);
    expect(isCrash(new Error("Target page, context or browser has been closed"))).toBe(true);
    expect(isCrash(new Error("net::ERR_TIMED_OUT"))).toBe(false);
    expect(isProxyFailure(new Error("page.goto: net::ERR_PROXY_CONNECTION_FAILED at x"))).toBe(
      true,
    );
    expect(isProxyFailure(new Error("page.goto: net::ERR_TUNNEL_CONNECTION_FAILED"))).toBe(true);
    expect(isProxyFailure(new Error("net::ERR_TIMED_OUT"))).toBe(false);
  });
});

describe("2captcha", () => {
  it("submits the Turnstile task and polls until the token is ready", async () => {
    const calls: string[] = [];
    let polls = 0;
    const http = (async (url: string, init?: RequestInit) => {
      calls.push(url);
      if (url.endsWith("/in.php")) {
        const body = init?.body as URLSearchParams;
        expect(body.get("method")).toBe("turnstile");
        expect(body.get("sitekey")).toBe("0x4AAAAAAAexample");
        expect(body.get("action")).toBe("managed");
        return Response.json({ status: 1, request: "task-1" });
      }
      polls++;
      return Response.json(
        polls < 2 ? { status: 0, request: "CAPCHA_NOT_READY" } : { status: 1, request: "tok" },
      );
    }) as typeof fetch;
    const solver = twoCaptcha("key", http, 1, 1000);
    await expect(
      solver.solveTurnstile({
        sitekey: "0x4AAAAAAAexample",
        pageurl: "https://rentals.ca/waterloo",
        action: "managed",
      }),
    ).resolves.toBe("tok");
    expect(calls.filter((u) => u.includes("res.php"))).toHaveLength(2);
  });

  it("fails on an error answer instead of waiting it out", async () => {
    const http = (async (url: string) =>
      Response.json(
        url.endsWith("/in.php")
          ? { status: 1, request: "task-1" }
          : { status: 0, request: "ERROR_CAPTCHA_UNSOLVABLE" },
      )) as typeof fetch;
    await expect(
      twoCaptcha("key", http, 1, 1000).solveTurnstile({ sitekey: "x", pageurl: "y" }),
    ).rejects.toThrow(/UNSOLVABLE/);
  });

  it("is only configured with a provider and a key", () => {
    expect(captchaSolverFromEnv({})).toBeNull();
    expect(captchaSolverFromEnv({ CAPTCHA_PROVIDER: "2captcha", CAPTCHA_API_KEY: "k" })?.name).toBe(
      "2captcha",
    );
    expect(() =>
      captchaSolverFromEnv({ CAPTCHA_PROVIDER: "other", CAPTCHA_API_KEY: "k" }),
    ).toThrow();
  });
});

describe("run log", () => {
  const base = {
    visits: 40,
    blocks: 0,
    challengesPassed: 0,
    captchasSolved: 0,
    captchasFailed: 0,
    rotations: 0,
    crashes: 0,
  };
  it("says nothing when nothing got in the way", () => {
    expect(describeStats(base)).toBe("");
  });
  it("summarises what the session had to get past", () => {
    expect(describeStats({ ...base, blocks: 3, challengesPassed: 2, rotations: 1 })).toBe(
      "3 blocks in 40 pages: 2 challenges passed, 1 proxy switch",
    );
    expect(describeStats({ ...base, crashes: 2 })).toBe("0 blocks in 40 pages: 2 tab crashes");
  });
});
