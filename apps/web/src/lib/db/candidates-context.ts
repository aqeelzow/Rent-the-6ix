import { getClient } from '../db';
import { MemoryCache, inputHash } from '../parse/cache';
import type { ScoreContext } from '../../../../../packages/shared/engine/score';
import { listingContext } from './valuation';
import { CaveatSchema, ValuationSchema } from '../../../../../packages/shared/schemas/index';
import { SearchUnavailable, type SearchDependencies } from './candidates';
import { sqlCandidateLoader, sqlListingLoader } from './candidates-sql';

// shortcut: bound unfinished owner reads to eight; use cancellable connections for higher production load.
let enrichmentsInFlight = 0;
export function sqlSearchDependencies(client: typeof getClient = getClient): SearchDependencies {
  // shortcut: public owner context can lag observations/building updates by 60 seconds; invalidate on owner events when available.
  const cache = new MemoryCache<ScoreContext>(1000, 60_000);
  return {
    listings: [],
    loadListing: sqlListingLoader(client),
    loadCandidates: sqlCandidateLoader(client),
    enrich: async (listing, _intent, signal) => {
      let abort: (() => void) | undefined;
      try {
        if (signal?.aborted) throw new SearchUnavailable('Listing context is unavailable');
        const key = inputHash(JSON.stringify(listing));
        const cached = cache.get(key);
        if (cached) return cached;
        if (enrichmentsInFlight >= 8) throw new SearchUnavailable('Listing context is unavailable');
        const sql = client();
        if (!sql) throw new SearchUnavailable('Database is unavailable');
        enrichmentsInFlight++;
        const operation = listingContext(sql, listing).finally(() => { enrichmentsInFlight--; });
        const cancelled = new Promise<never>((_resolve, reject) => {
          abort = () => reject(new SearchUnavailable('Listing context cancelled'));
          signal?.addEventListener('abort', abort, { once: true });
        });
        const owner = await Promise.race([operation, cancelled]);
        if (signal?.aborted) throw new SearchUnavailable('Listing context cancelled');
        const context: ScoreContext = { valuation: ValuationSchema.parse(owner.valuation), caveats: owner.caveats.map(c => CaveatSchema.parse(c)), travel: [], safety: null };
        cache.set(key, context);
        return context;
      } catch { throw new SearchUnavailable('Listing context is unavailable'); }
      finally { if (abort) signal?.removeEventListener('abort', abort); }
    },
  };
}
