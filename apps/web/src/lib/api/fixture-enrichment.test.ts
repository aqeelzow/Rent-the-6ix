import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createRuntime, fixtureDependencies } from './runtime';
import { baseIntent, sampleListings, fixtureTimestamp } from '../../../../../packages/shared/fixtures/index';
import { SearchResponseSchema } from '../../../../../packages/shared/schemas/index';
import { valuate } from '../../../../../packages/shared/engine/valuation';
import { caveats } from '../../../../../packages/shared/engine/caveats';
import { distanceM } from '../../../../../packages/shared/engine/travel';
const request = (path: string, body: unknown) => new Request(`http://localhost/api/${path}`, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });

test('fixture enrichment executes C valuation and caveats with the small sample', async () => {
  for (const listing of sampleListings) {
    const owner = await fixtureDependencies.enrich(listing, baseIntent);
    const now = new Date(fixtureTimestamp);
    const comparables = sampleListings.map(candidate => ({ ...candidate, distanceM: distanceM(listing.location, candidate.location), buildingKey: candidate.buildingId ?? candidate.addressPointId }));
    assert.deepEqual(owner.valuation, valuate(listing, comparables, null, now));
    assert.deepEqual(owner.caveats, caveats(listing, { valuation: owner.valuation, building: null, sameTextElsewhere: 0, now }));
    assert.equal(owner.valuation.status, 'insufficient_data');
    assert.equal(owner.valuation.benchmark, null);
  }
  const api = createRuntime({ env: { SEARCH_FIXTURES: '1' } });
  const response = await api.search(request('listings/search', { intent: baseIntent, hideUnconfirmed: false }), undefined);
  assert.equal(response.status, 200);
  const search = SearchResponseSchema.parse(await response.json());
  assert.equal(search.status, 'completed');
});
