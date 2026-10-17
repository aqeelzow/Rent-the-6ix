import { getClient } from '../db';
import { listingContext } from './valuation';
import { CaveatSchema, ValuationSchema } from '../../../../../packages/shared/schemas/index';
import { SearchUnavailable, type SearchDependencies } from './candidates';
import { sqlCandidateLoader } from './candidates-sql';

// shortcut: C's shared-client queries cannot be cancelled; allow only one unfinished enrichment until C exposes cancellation.
let enrichmentInFlight = false;
export function sqlSearchDependencies(client: typeof getClient = getClient): SearchDependencies {
  return {
    listings: [],
    loadCandidates: sqlCandidateLoader(client),
    enrich: async (listing, _intent, signal) => {
      let abort: (() => void) | undefined;
      try {
        if (signal?.aborted || enrichmentInFlight) throw new SearchUnavailable('Listing context is unavailable');
        const sql = client();
        if (!sql) throw new SearchUnavailable('Database is unavailable');
        enrichmentInFlight = true;
        const operation = listingContext(sql, listing).finally(() => { enrichmentInFlight = false; });
        const cancelled = new Promise<never>((_resolve, reject) => {
          abort = () => reject(new SearchUnavailable('Listing context cancelled'));
          signal?.addEventListener('abort', abort, { once: true });
        });
        const owner = await Promise.race([operation, cancelled]);
        if (signal?.aborted) throw new SearchUnavailable('Listing context cancelled');
        return { valuation: ValuationSchema.parse(owner.valuation), caveats: owner.caveats.map(c => CaveatSchema.parse(c)), travel: [], safety: null };
      } catch { throw new SearchUnavailable('Listing context is unavailable'); }
      finally { if (abort) signal?.removeEventListener('abort', abort); }
    },
  };
}
