import assert from 'node:assert/strict';
import { test } from 'vitest';
import { PlaceCatalogue, placeCatalogue } from './place-catalogue';
import { ParseService, DestinationResolver, fallbackParse } from './index';
import { AIUnavailable } from '../ai';
import generated from './known_places.generated.json';
import { normalizePlace } from './place-name';

const point = (id: string, label: string, lng = -79.4, aliases: string[] = []) => ({ id, label, aliases, lng, lat: 43.7 });

test('source records replace conflicting curated coordinates and retain aliases and provenance', () => {
  const catalogue = new PlaceCatalogue([point('old', 'Sample Market representative point', -79.5, ['the market'])], [point('osm:node/1', 'Sample Market'), point('osm:node/2', 'Sample Market', -79.4001)]);
  const match = catalogue.lookup('the market')!;
  assert.equal(match.places.length, 1);
  assert.equal(match.places[0].lng, -79.4);
  assert.deepEqual(match.places[0].sourceIds, ['osm:node/1', 'osm:node/2']);
  assert.equal(catalogue.conflicts[0].curatedId, 'old');
});

test('intersection aliases share identities across ordering, punctuation and street types', () => {
  const catalogue = new PlaceCatalogue([], [point('toronto-intersection:1', 'Jane St & Finch Ave W intersection'), point('osm:node/1', 'Jane and Finch', -79.4001)]);
  for (const query of ['Jane and Finch', 'Finch / Jane', 'Jane Street & Finch Avenue West', 'Finch Ave W and Jane St']) {
    const match = catalogue.lookup(query)!;
    assert.equal(match.places.length, 1, query);
    assert.equal(match.places[0].id, 'toronto-intersection:1', query);
    assert.ok(match.places[0].sourceIds.includes('osm:node/1'));
  }
});

test('tokenization and lookup agree on punctuation and accented names', () => {
  const catalogue = new PlaceCatalogue([], [point('initials', 'J.J. Park'), point('accent', 'Café Montréal')]);
  assert.equal(catalogue.mentions('near J.J. Park')[0].query, 'J.J. Park');
  assert.equal(catalogue.mentions('near Cafe Montreal')[0].query, 'Cafe Montreal');
  assert.equal(catalogue.mentions('near Cafe\u0301 Montre\u0301al')[0].query, 'Cafe\u0301 Montre\u0301al');
  const cues = new PlaceCatalogue([], [point('descriptor', 'near dam'), point('park', 'Dan Iannuzi Park')]);
  assert.deepEqual(cues.mentions('near Dan Iannuzi Park').map(m => m.query), ['Dan Iannuzi Park']);
  assert.deepEqual(cues.mentions('near "Dan Iannuzi Park"').map(m => m.query), ['Dan Iannuzi Park']);
});

test('directions and distant branches remain distinct; nearby chains do not merge transitively', () => {
  const catalogue = new PlaceCatalogue([], [point('toronto-intersection:west', 'Jane St & Finch Ave W intersection'), point('toronto-intersection:east', 'Jane St & Finch Ave E intersection', -79.5)]);
  assert.equal(catalogue.lookup('Jane and Finch')!.places.length, 2);
  assert.equal(catalogue.lookup('Jane and Finch East')!.places[0].id, 'toronto-intersection:east');
  const chain = new PlaceCatalogue([], [point('a', 'Shared Park', -79.4), point('b', 'Shared Park', -79.402), point('c', 'Shared Park', -79.404)]);
  assert.equal(chain.lookup('Shared Park')!.places.length, 2);
  const aliasChain = new PlaceCatalogue([], [point('a', 'Shared Park', -79.4), point('b', 'Shared Park', -79.402), point('c', 'Other Park', -79.398, ['Shared Park'])]);
  assert.equal(aliasChain.lookup('Shared Park')!.places.length, 2);
});

test('one-edit typos resolve only with a unique identity and preserve original evidence', async () => {
  assert.equal(new PlaceCatalogue([], [point('bank', 'TD')]).lookup('TD'), undefined);
  const ambiguous = new PlaceCatalogue([], [point('a', 'Alpha Park'), point('b', 'Alphi Park', -79.5)]);
  assert.equal(ambiguous.lookup('Alphx Park')!.places.length, 2);
  assert.deepEqual(ambiguous.mentions('room near Alphx Park'), [{ start: 10, end: 20, query: 'Alphx Park' }]);
  for (const query of ['kensignton market', 'kensington makret']) {
    const result = await new ParseService().parse({ prompt: `room near ${query}` }, 'typo-regression');
    assert.equal(result.intent.travelTargets.length, 1);
    assert.equal(result.intent.travelTargets[0].query, query);
    assert.equal(result.intent.fieldSources['travelTargets.target-1'].phrase, query);
    assert.equal(result.intent.travelTargets[0].normalizedQuery, 'kensington market');
    assert.equal(result.destinations[0].resolution.status, 'resolved');
  }
});

test('busy AI preserves locally resolved places and independent travel bounds', async () => {
  const service = new ParseService({ provider: { generateStructured: async () => { throw new AIUnavailable('busy', 503); }, generateText: async () => '' } });
  const result = await service.parse({ prompt: '10 min walk to Kensington Market and 20 min bike to Union Station' }, 'offline-trips');
  assert.equal(result.parser, 'fallback');
  assert.deepEqual(result.intent.travelTargets.map(t => [t.query, t.maxMinutes, t.mode, t.hard]), [['Kensington Market', 10, 'walk', true], ['Union Station', 20, 'bike', true]]);
  assert.ok(result.destinations.every(d => d.resolution.status === 'resolved'));
  assert.deepEqual(fallbackParse('room near the university of toronto').travelTargets.map(t => t.query), ['university of toronto']);
  assert.deepEqual(fallbackParse('near Moss Park').travelTargets.map(t => t.kind), ['place']);
  assert.equal((await new DestinationResolver().resolve('Eglinton')).status, 'ambiguous');
  assert.ok(placeCatalogue.lookup('Jane-Finch')!.places[0].sourceIds.includes('osm:node/13190016241'));
});

test('every eligible generated name and alias remains locally reachable with source provenance', () => {
  for (const record of generated) {
    for (const name of [record.label, ...record.aliases]) {
      if (normalizePlace(name).replace(/\s/g, '').length < 3) continue;
      const match = placeCatalogue.lookup(name, false);
      assert.ok(match, `${record.id}: ${name}`);
      // A university's bare name intentionally selects its campuses rather than a namesake station.
      if (match.group === record.label) continue;
      assert.ok(match.places.some(place => place.sourceIds.includes(record.id)), `${record.id}: ${name}`);
    }
    if (normalizePlace(record.label).replace(/\s/g, '').length < 3) continue;
    assert.ok(placeCatalogue.mentions(`near ${record.label}`).some(mention => normalizePlace(mention.query) === normalizePlace(record.label)), record.label);
  }
});
