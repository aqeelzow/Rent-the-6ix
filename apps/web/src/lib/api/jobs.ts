import { randomBytes } from 'node:crypto';
import { SearchResponseSchema, type SearchResponse } from '../../../../../packages/shared/schemas/index';
import { ApiError } from './json-route';
type Job = { pending: SearchResponse; result?: SearchResponse; controller: AbortController; expiry: ReturnType<typeof setTimeout>; deadline: ReturnType<typeof setTimeout> };
export class SearchJobs {
  private jobs = new Map<string, Job>();
  constructor(private options: { capacity?: number; executionMs?: number; ttlMs?: number } = {}) {}
  start(work: (signal: AbortSignal, deadline: number) => Promise<SearchResponse>): SearchResponse {
    if (this.jobs.size >= (this.options.capacity ?? 16)) return { status: 'unavailable', reason: 'capacity', message: 'Search capacity reached; try again shortly' };
    const token = randomBytes(32).toString('base64url');
    const budget = Math.min(120000, Math.max(1, this.options.executionMs ?? 120000));
    const ttl = Math.max(budget, this.options.ttlMs ?? 180000);
    const deadline = Date.now() + budget;
    const pending = SearchResponseSchema.parse({ status: 'pending', jobToken: token, pollUrl: `/api/listings/search/jobs/${token}`, expiresAt: new Date(Date.now() + ttl).toISOString() });
    const controller = new AbortController();
    const complete = (result: SearchResponse) => { const job = this.jobs.get(token); if (!job || job.result) return; job.result = result; clearTimeout(job.deadline); controller.abort(); };
    const job: Job = { pending, controller, expiry: setTimeout(() => this.remove(token), ttl), deadline: setTimeout(() => complete({ status: 'unavailable', reason: 'timeout', message: 'Exact travel percentile timed out' }), budget) };
    job.expiry.unref?.(); job.deadline.unref?.();
    this.jobs.set(token, job);
    void Promise.resolve().then(() => work(controller.signal, deadline)).then(result => {
      const parsed = SearchResponseSchema.parse(result);
      if (parsed.status === 'pending') throw new Error('Execution must terminate');
      complete(parsed);
    }).catch(() => complete({ status: 'unavailable', reason: 'routing_incomplete', message: 'Complete routed times unavailable; no partial percentile returned' }));
    return pending;
  }
  poll(token: string): SearchResponse {
    const job = this.jobs.get(token);
    if (!job) throw new ApiError(410, 'search_job_expired', 'Search job expired, was consumed, or the server restarted');
    if (!job.result) return job.pending;
    const result = job.result; this.remove(token); return result;
  }
  private remove(token: string) { const job = this.jobs.get(token); if (!job) return; clearTimeout(job.expiry); clearTimeout(job.deadline); job.controller.abort(); this.jobs.delete(token); }
  dispose() { for (const token of this.jobs.keys()) this.remove(token); }
}
