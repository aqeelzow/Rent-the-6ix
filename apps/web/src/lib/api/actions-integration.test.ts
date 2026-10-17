import { expect, test } from 'vitest';
import { baseIntent, sampleListings, travelIntent } from '@rentthe6ix/shared/fixtures';
import { DetailResponseSchema } from '@rentthe6ix/shared/schemas';
import { parseAndSearch, resolveDestination, runSearch } from '../store/actions';
import { createAppStore } from '../store/store';
import { createRuntime, fixtureDependencies } from './runtime';

function bridge(api: ReturnType<typeof createRuntime>) {
  const paths: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(new URL(String(input), 'http://localhost'), init);
    const path = new URL(request.url).pathname;
    paths.push(path);
    if (path === '/api/search/parse') return api.parse(request, undefined);
    if (path === '/api/geo/resolve') return api.resolve(request, undefined);
    if (path === '/api/listings/search') return api.search(request, undefined);
    const token = path.split('/').at(-1)!;
    return api.poll(request, { params: Promise.resolve({ token }) });
  };
  return { fetch: fetcher, paths };
}

test('actual A actions consume B responses and retain nested listing selection and destination choices', async () => {
  const api = createRuntime({ env: { SEARCH_FIXTURES: '1', AI_PROVIDER: 'none' } });
  const store = createAppStore();
  const transport = bridge(api);
  try {
    const choice = await resolveDestination('University of Toronto', transport);
    expect(choice.ok).toBe(true);
    if (!choice.ok || choice.resolution.status !== 'ambiguous') throw Error('Expected campus choices');
    expect(choice.resolution.choices.length).toBeGreaterThan(1);
    await parseAndSearch('near University of Toronto', { store, ...transport });
    expect(store.getState().destinations[0].resolution.status).toBe('ambiguous');
    const selected = choice.resolution.choices[0];
    store.getState().updateIntent(intent => ({ ...intent, travelTargets: intent.travelTargets.map(target => ({ ...target, resolved: selected.resolved, label: selected.label })) }));
    await runSearch({ store, ...transport });
    expect(store.getState().status).toBe('ready');
    const result = store.getState().results[0];
    expect(result.listing.id).toBeDefined();
    expect(result).not.toHaveProperty('id');
    store.getState().setSelectedListingId(result.listing.id);
    store.getState().setHoveredListingId(result.listing.id);
    await runSearch({ store, ...transport });
    expect(store.getState().selectedListingId).toBe(result.listing.id);
    expect(store.getState().hoveredListingId).toBe(result.listing.id);
    const intent = { ...baseIntent, rawPrompt: '', fieldSources: {}, droppedRequests: [] };
    const detail = DetailResponseSchema.parse(await (await api.detail(new Request('http://localhost/api/listings/x?intent=' + encodeURIComponent(JSON.stringify(intent))), { params: Promise.resolve({ id: result.listing.id }) })).json());
    expect(detail.listing.id).toBe(store.getState().selectedListingId);
  } finally { api.jobs.dispose(); }
});

test('actual A polling consumes a real B exact-travel job and keeps its nested selection', async () => {
  const api = createRuntime({ env: {}, dependencies: { ...fixtureDependencies,
    routeTimes: async (origins, targets, mode) => origins.flatMap(listing => targets.map(target => ({ listingId: listing.id, targetId: target.id, mode, minutes: 5, distanceM: 100, method: 'otp', poiId: null, computedAt: listing.lastSeenAt }))),
  } });
  const transport = bridge(api);
  const store = createAppStore();
  store.getState().setIntent({ ...travelIntent, numericExtreme: { field: 'travel', targetId: travelIntent.travelTargets[0].id, direction: 'min', percentage: 10, minimumCount: 10 } });
  store.getState().setSelectedListingId(sampleListings[0].id);
  try {
    await runSearch({ store, ...transport, sleep: () => new Promise(resolve => setTimeout(resolve, 0)) });
    expect(transport.paths.some(path => path.startsWith('/api/listings/search/jobs/'))).toBe(true);
    expect(store.getState().status).toBe('ready');
    expect(store.getState().results.length).toBeGreaterThan(0);
    expect(store.getState().selectedListingId).toBe(sampleListings[0].id);
    expect(store.getState().results.every(result => !('id' in result))).toBe(true);
  } finally { api.jobs.dispose(); }
});
