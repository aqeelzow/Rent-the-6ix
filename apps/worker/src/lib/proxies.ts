// Proxy configuration for the fetch layer (#32). A source uses PROXY_URLS_<SOURCE> (e.g.
// PROXY_URLS_KIJIJI) when set, else PROXY_URLS: comma- or newline-separated proxy URLs such as
// http://user:pass@gate.example.com:7000. "none" turns proxies off for that source. With no list,
// requests go out directly, as before.

/** The proxy URLs a source should rotate through (empty = direct). */
export function proxiesFor(source: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const specific = env[`PROXY_URLS_${source.toUpperCase()}`];
  const raw = specific ?? env.PROXY_URLS ?? "";
  if (raw.trim().toLowerCase() === "none") return [];
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** host:port only, so logs never carry proxy credentials. */
export function redactProxy(url: string): string {
  try {
    const u = new URL(url.includes("://") ? url : `http://${url}`);
    return `${u.hostname}${u.port ? `:${u.port}` : ""}`;
  } catch {
    return "proxy";
  }
}

/**
 * Round-robin over the list, starting at a random entry so parallel runs spread out.
 * `null` in the list stands for "direct" when there are no proxies.
 */
export class ProxyPool {
  private readonly urls: (string | null)[];
  private index: number;

  constructor(urls: string[], start = Math.floor(Math.random() * Math.max(urls.length, 1))) {
    this.urls = urls.length ? urls : [null];
    this.index = start % this.urls.length;
  }

  get size(): number {
    return this.urls.length;
  }

  /** True when there is more than one way out, so rotating can help. */
  get canRotate(): boolean {
    return this.urls.length > 1;
  }

  current(): string | null {
    return this.urls[this.index];
  }

  next(): string | null {
    this.index = (this.index + 1) % this.urls.length;
    return this.current();
  }
}
