import { getClient } from '../db';
import { MemoryCache, inputHash } from '../parse/cache';
import type { ScoreContext } from '../../../../../packages/shared/engine/score';
import { listingContext, listingContexts } from './valuation';
import { CaveatSchema, ValuationSchema, type Listing, type SearchIntent } from '../../../../../packages/shared/schemas/index';
import { SearchUnavailable, type SearchDependencies } from './candidates';
import { sqlDetailLoader } from './candidates-detail';
import { sqlCandidateLoader, sqlListingLoader } from './candidates-sql';
import { crimeTableSource, safetyForListing, type CrimeTable } from './safety';

// shortcut: bound unfinished owner reads to four eight-context requests; use cancellable connections for higher production load.
let enrichmentsInFlight = 0;
export function sqlSearchDependencies(client: typeof getClient = getClient, crimeTable: () => Promise<CrimeTable | null> = crimeTableSource(client)): SearchDependencies {
  // shortcut: public owner context can lag observations/building updates by 60 seconds; invalidate on owner events when available.
  const cache = new MemoryCache<ScoreContext>(1000, 60_000);
  // D's safety (SPEC 7.6) is opt-in: only an enabled search reads it, and a missing crime table leaves it unknown instead of failing the search.
  const withSafety = async (context: ScoreContext, listing: Listing, intent: SearchIntent): Promise<ScoreContext> => {
    if (!intent.safety.enabled) return context;
    return { ...context, ...safetyForListing(await crimeTable().catch(() => null), listing.neighbourhoodId) };
  };
  return {
    listings: [],
    loadListing: sqlListingLoader(client),
    loadDetail: sqlDetailLoader(client),
    loadCandidates: sqlCandidateLoader(client),
    // No stored travel adapter is published yet; both stages explicitly expose unknown time.
    filterContext: async (listing, intent) => ({ travel: [], safety: intent.safety.enabled ? safetyForListing(await crimeTable().catch(() => null), listing.neighbourhoodId).safety : null }),
    // Ordinary search: value every candidate from one comparable read and two fact reads.
    enrichMany: async (listings, intent, signal) => {
      if (signal?.aborted) throw new SearchUnavailable('Listing context is unavailable');
      try {
        const sql = client();
        if (!sql) throw new SearchUnavailable('Database is unavailable');
        const owners = await listingContexts(sql, listings);
        if (signal?.aborted) throw new SearchUnavailable('Listing context cancelled');
        const contexts = new Map<string, ScoreContext>();
        for (const listing of listings) {
          const owner = owners.get(listing.id);
          if (!owner) throw new SearchUnavailable('Listing context is unavailable');
          // Same schema check as the single-listing path: malformed owner rows fail the search
          // privately instead of reaching a card.
          contexts.set(listing.id, await withSafety({
            valuation: ValuationSchema.parse(owner.valuation),
            caveats: owner.caveats.map(caveat => CaveatSchema.parse(caveat)),
            travel: [], safety: null,
          }, listing, intent));
        }
        return contexts;
      } catch (error) {
        if (error instanceof SearchUnavailable) throw error;
        throw new SearchUnavailable('Listing context is unavailable');
      }
    },
    enrich: async (listing, intent, signal) => {
      let abort: (() => void) | undefined;
      try {
        if (signal?.aborted) throw new SearchUnavailable('Listing context is unavailable');
        const key = inputHash(JSON.stringify(listing));
        const cached = cache.get(key);
        if (cached) return withSafety(cached, listing, intent);
        if (enrichmentsInFlight >= 32) throw new SearchUnavailable('Listing context is unavailable');
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
        return withSafety(context, listing, intent);
      } catch { throw new SearchUnavailable('Listing context is unavailable'); }
      finally { if (abort) signal?.removeEventListener('abort', abort); }
    },
  };
}
