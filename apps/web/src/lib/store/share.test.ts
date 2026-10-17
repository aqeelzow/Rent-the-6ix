import { baseIntent } from "@rentthe6ix/shared/fixtures";
import { describe, expect, it } from "vitest";
import { decodeSharedSearch, encodeSharedSearch, sharedSearchPath } from "./share";

const prompt = "2 bed near UofT under $2,800, café nearby — 0.8× crime";
const intent = {
  ...baseIntent,
  rawPrompt: prompt,
  safety: { enabled: true, hard: true, maxRelativeRate: 0.8 },
};

describe("shared search links", () => {
  it("round-trips the edited filters, with the prompt carried as q", () => {
    const encoded = encodeSharedSearch({ intent, hideUnconfirmed: true });
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeSharedSearch(encoded, prompt)).toEqual({ intent, hideUnconfirmed: true });
  });

  it("keeps the prompt out of the encoded filters", () => {
    const encoded = encodeSharedSearch({ intent, hideUnconfirmed: false });
    const other = decodeSharedSearch(encoded, "a different prompt");
    expect(other?.intent.rawPrompt).toBe("a different prompt");
    expect(other?.intent.safety).toEqual(intent.safety);
  });

  it("builds a /search link with q and s", () => {
    const path = sharedSearchPath({ intent, hideUnconfirmed: false });
    const url = new URL(path, "https://example.test");
    expect(url.pathname).toBe("/search");
    expect(url.searchParams.get("q")).toBe(prompt);
    expect(decodeSharedSearch(url.searchParams.get("s")!, prompt)?.intent).toEqual(intent);
    expect(path.length).toBeLessThan(4000);
  });

  it("ignores links that are damaged, too long or not a valid search", () => {
    const valid = encodeSharedSearch({ intent, hideUnconfirmed: false });
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    expect(decodeSharedSearch("", prompt)).toBeNull();
    expect(decodeSharedSearch("not base64!", prompt)).toBeNull();
    expect(decodeSharedSearch(valid.slice(0, -7), prompt)).toBeNull();
    expect(decodeSharedSearch("A".repeat(20_000), prompt)).toBeNull();
    expect(decodeSharedSearch(encode({ v: 2, intent }), prompt)).toBeNull();
    expect(decodeSharedSearch(encode({ v: 1, intent: "x" }), prompt)).toBeNull();
    // Schema rules still apply: a must-have safety limit needs safety turned on.
    const badSafety = { ...intent, safety: { enabled: false, hard: true } };
    expect(decodeSharedSearch(encode({ v: 1, intent: badSafety }), prompt)).toBeNull();
  });
});
