import { expect, test } from 'vitest';
import { baseIntent, sampleListings, travelIntent } from '@rentthe6ix/shared/fixtures';
import { DetailResponseSchema } from '@rentthe6ix/shared/schemas';
import { parseAndSearch, resolveDestination, restoreSearch, runSearch } from '../store/actions';
import { placePins } from '../../components/map/map-data';
import { travelSummaries } from '../../components/results/card-data';
import { createAppStore } from '../store/store';
import { createRuntime, fixtureDependencies } from './runtime';
import { DestinationResolver, ParseService } from '../parse';

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

test('a saved unresolved UofT search regains its pin and time estimates without reparsing edited filters', async () => {
  const api = createRuntime({ env: {}, dependencies: fixtureDependencies });
  const store = createAppStore();
  const transport = bridge(api);
  const intent = { ...baseIntent, rawPrompt: 'near uoft', criteria: { rent: { value: { max: 5000 }, hard: true } }, travelTargets: [{ id: 'campus', kind: 'place' as const, label: 'UofT St. George campus', query: 'uoft', mode: 'walk' as const, maxMinutes: 60, hard: true }] };
  try {
    await restoreSearch({ intent, hideUnconfirmed: false }, { store, ...transport });
    expect(transport.paths).toEqual(['/api/geo/resolve', '/api/listings/search']);
    const state = store.getState();
    expect(state.status).toBe('ready');
    expect(state.intent?.criteria).toEqual(intent.criteria);
    expect(state.intent?.travelTargets[0].resolved).toMatchObject({ lng: -79.3957, lat: 43.6629, source: 'known_place' });
    expect(placePins(state.intent!.travelTargets)).toHaveLength(1);
    expect(state.results.length).toBeGreaterThan(0);
    expect(travelSummaries(state.results[0], state.intent!.travelTargets)[0].kind).toBe('estimated');
    expect(state.results.every(result => !result.matchScore.hardFilterNotes.some(note => note.startsWith('Location for ')))).toBe(true);
  } finally { api.jobs.dispose(); }
});

test('within ten minutes of an arbitrary place is a strict walking cutoff even without Gemini', async () => {
  const destination = { lng: -79.3743315, lat: 43.6618956 };
  const listings = sampleListings.slice(0, 4).map((listing, index) => ({ ...listing, location: { lng: destination.lng, lat: destination.lat + [0, 640, 641, 5000][index] / 6371000 * 180 / Math.PI } }));
  const resolver = new DestinationResolver({ maptilerKey: 'mock', fetch: async () => Response.json({ features: [{ id: 'allan-gardens', place_name: 'Allan Gardens', relevance: 1, center: [destination.lng, destination.lat] }] }) });
  const api = createRuntime({ env: {}, parser: new ParseService({ resolver }), dependencies: { ...fixtureDependencies, listings } });
  const store = createAppStore();
  try {
    await parseAndSearch('within 10 minutes of allan gardens', { store, ...bridge(api) });
    const state = store.getState();
    expect(state.status).toBe('ready');
    expect(state.intent?.travelTargets[0]).toMatchObject({ query: 'allan gardens', mode: 'walk', maxMinutes: 10, hard: true });
    expect(state.results.map(result => result.listing.id).sort()).toEqual(listings.slice(0, 2).map(listing => listing.id).sort());
    expect(state.results.every(result => {
      const summary = travelSummaries(result, state.intent!.travelTargets)[0];
      return summary.kind === 'estimated' && summary.minutes <= 10;
    })).toBe(true);
  } finally { api.jobs.dispose(); }
});

test('actual A actions consume B responses and retain nested listing selection and destination choices', async () => {
  // This test covers the campus-choice flow, so it opts out of the default "main campus" answer.
  const api = createRuntime({ env: { SEARCH_FIXTURES: '1', AI_PROVIDER: 'none' }, resolver: new DestinationResolver({ preferPrimaryCampus: false }) });
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

test('actual polling consumes an estimated-travel job and keeps its nested selection', async () => {
  const api = createRuntime({ env: {}, dependencies: fixtureDependencies });
  const transport = bridge(api);
  const store = createAppStore();
  store.getState().setIntent({ ...travelIntent, travelTargets: travelIntent.travelTargets.map(target => ({ ...target, hard: false })), numericExtreme: { field: 'travel', targetId: travelIntent.travelTargets[0].id, direction: 'min', percentage: 10, minimumCount: 10 } });
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
