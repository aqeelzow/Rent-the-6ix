import { createHash } from 'node:crypto';
export const inputHash = (input: string) => createHash('sha256').update(input).digest('hex');
export interface Cache<T> { get(key: string): T | undefined; set(key: string, value: T): void; }
// shortcut: temporary process-local draft cache, replace with D's ai_cache contract before production.
export class MemoryCache<T> implements Cache<T> {
  private entries = new Map<string, { expires: number; value: T }>();
  constructor(private capacity = 128, private ttlMs = 300000, private now = Date.now) {}
  get(key: string): T | undefined { const entry = this.entries.get(key); if (!entry || entry.expires <= this.now()) { this.entries.delete(key); return; } return structuredClone(entry.value); }
  set(key: string, value: T) { if (this.capacity < 1) return; this.entries.delete(key); if (this.entries.size >= this.capacity) this.entries.delete(this.entries.keys().next().value!); this.entries.set(key, { expires: this.now() + this.ttlMs, value: structuredClone(value) }); }
}
export class RateLimitError extends Error { readonly status = 429; constructor(public retryAfterSeconds: number) { super('Too many interpretation requests'); } }
export class IpLimiter {
  private entries = new Map<string, { count: number; expires: number }>();
  constructor(private limit = 20, private windowMs = 60000, private capacity = 1024, private now = Date.now) {}
  check(ip: string) {
    const now = this.now();
    for (const [key, value] of this.entries) if (value.expires <= now) this.entries.delete(key);
    const key = inputHash(ip); const entry = this.entries.get(key);
    if (!entry && this.entries.size >= this.capacity) throw new RateLimitError(Math.max(1, Math.ceil(this.windowMs / 1000)));
    if (entry && entry.count >= this.limit) throw new RateLimitError(Math.max(1, Math.ceil((entry.expires - now) / 1000)));
    this.entries.set(key, { count: (entry?.count ?? 0) + 1, expires: entry?.expires ?? now + this.windowMs });
  }
}
