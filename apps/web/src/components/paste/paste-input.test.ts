import { describe, expect, it } from "vitest";
import { isHttpLink } from "./paste-input";

describe("isHttpLink", () => {
  it("accepts full public http(s) links", () => {
    expect(isHttpLink("https://www.kijiji.ca/v-apartments-condos/city-of-toronto/123")).toBe(true);
    expect(isHttpLink("  http://example.com/listing  ")).toBe(true);
  });

  it("rejects other schemes, bare words and hosts without a domain", () => {
    expect(isHttpLink("javascript:alert(1)")).toBe(false);
    expect(isHttpLink("ftp://example.com/a")).toBe(false);
    expect(isHttpLink("kijiji.ca/listing")).toBe(false);
    expect(isHttpLink("http://localhost:3000")).toBe(false);
    expect(isHttpLink("")).toBe(false);
  });
});
