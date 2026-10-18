import { z } from 'zod';
import curated from './known_places.json';
import generated from './known_places.generated.json';
import { distanceM } from '../../../../../packages/shared/engine/travel';
import { normalizePlace } from './place-name';
import { inputHash } from './cache';

const recordSchema = z.object({ id: z.string().min(1), label: z.string().min(1), aliases: z.array(z.string()), group: z.string().optional(), primary: z.boolean().optional(), lng: z.number().finite().min(-180).max(180), lat: z.number().finite().min(-90).max(90) });
type PlaceRecord = z.infer<typeof recordSchema>;
export type PlaceEntity = PlaceRecord & { sourceIds: string[] };
type Match = { places: PlaceEntity[]; canonical: string; match: 'exact' | 'fuzzy'; group?: string };
export type PlaceMention = { start: number; end: number; query: string; normalizedQuery?: string };
const baseName = (label: string) => label.replace(/ representative point$/, '');
const sourceRank = (p: PlaceRecord) => p.id.startsWith('toronto-intersection:') ? 0 : p.id.startsWith('osm:') ? 1 : 2;
const compareSources = (a: PlaceRecord, b: PlaceRecord) => sourceRank(a) - sourceRank(b) || a.id.localeCompare(b.id);
const streetWords: Record<string, string> = { street: 'st', avenue: 'ave', road: 'rd', boulevard: 'blvd', drive: 'dr', crescent: 'cres', court: 'ct', place: 'pl', highway: 'hwy', lane: 'ln', trail: 'trl', terrace: 'ter', north: 'n', south: 's', east: 'e', west: 'w' };
const street = (name: string) => normalizePlace(name).split(' ').map(word => streetWords[word] ?? word).join(' ');

function intersectionNames(label: string): string[] {
  if (!label.endsWith(' intersection')) return [];
  const roads = baseName(label).replace(/ intersection$/, '').split(/\s+(?:&|\/|and)\s+/i).map(street);
  if (roads.length !== 2) return [];
  const variants = roads.map(road => {
    const short = road.replace(/\b(?:st|ave|rd|blvd|dr|cres|ct|pl|hwy|ln|trl|ter)(?=\s+[nsew]$|$)/, '').replace(/\s+/g, ' ').trim();
    return [...new Set([road, short, road.replace(/\s+[nsew]$/, ''), short.replace(/\s+[nsew]$/, '')])];
  });
  // Omitted directions broaden the candidates; explicit directions always stay in their own key.
  return variants[0].flatMap(a => variants[1].flatMap(b => [ `${a} and ${b}`, `${b} and ${a}` ]));
}

// Complete-link clusters avoid merging a chain of entrances spanning several distinct branches.
function clusters<T extends { lng: number; lat: number }>(items: T[]): T[][] {
  const groups: T[][] = [];
  for (const item of items) {
    const group = groups.find(group => group.every(member => distanceM(item, member) <= 250));
    if (group) group.push(item); else groups.push([item]);
  }
  return groups;
}

function oneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < Math.min(a.length, b.length) && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1) || a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

export class PlaceCatalogue {
  private names = new Map<string, PlaceEntity[]>();
  private fuzzyEdges = new Map<string, Set<string>>();
  private groups = new Map<string, PlaceEntity[]>();
  private maxWords = 1;
  readonly conflicts: { name: string; curatedId: string; sourcedIds: string[] }[] = [];

  constructor(curatedInput: unknown, generatedInput: unknown) {
    const curatedRecords = recordSchema.array().parse(curatedInput);
    const sourcedRecords = recordSchema.array().parse(generatedInput);
    const sourcedIds = new Set(sourcedRecords.map(p => p.id));
    const byLabel = new Map<string, PlaceRecord[]>();
    const coordinates = new Map<PlaceEntity, PlaceRecord[]>();
    for (const record of [...curatedRecords, ...sourcedRecords]) {
      const name = normalizePlace(baseName(record.label));
      const records = byLabel.get(name) ?? [];
      records.push(record); byLabel.set(name, records);
    }
    for (const [name, records] of byLabel) {
      const sourced = records.filter(p => sourcedIds.has(p.id));
      const old = records.filter(p => !sourcedIds.has(p.id));
      for (const record of old) if (sourced.length && sourced.every(p => distanceM(p, record) > 250)) this.conflicts.push({ name, curatedId: record.id, sourcedIds: sourced.map(p => p.id) });
      for (const cluster of clusters([...(sourced.length ? sourced : records)].sort(compareSources))) {
        const metadata = old.find(p => p.group);
        const entity: PlaceEntity = { ...(metadata ? { group: metadata.group, primary: metadata.primary } : {}), ...cluster[0], sourceIds: cluster.map(p => p.id) };
        coordinates.set(entity, cluster);
        const aliases = new Set([...cluster, ...old].flatMap(p => [p.label, baseName(p.label), ...p.aliases, ...intersectionNames(p.label)]));
        entity.aliases = [...aliases];
        for (const alias of aliases) this.addName(normalizePlace(alias), entity);
        if (entity.group) this.groups.set(entity.group, [...this.groups.get(entity.group) ?? [], entity]);
      }
    }
    this.mergeEntities(coordinates);
    for (const [group, aliases] of [['University of Toronto', ['university of toronto', 'uoft', 'u of t']], ['York University', ['york', 'york university']]] as const) {
      for (const alias of aliases) if (this.groups.has(group)) this.names.set(alias, this.groups.get(group)!);
    }
    for (const [name, places] of this.names) {
      const words = name.split(' '); this.maxWords = Math.max(this.maxWords, words.length);
      if (words.length < 2 || name.length < 8 || places.some(p => p.id.startsWith('toronto-intersection:'))) continue;
      for (const edge of [words[0], words.at(-1)!]) {
        const names = this.fuzzyEdges.get(edge) ?? new Set<string>(); names.add(name); this.fuzzyEdges.set(edge, names);
      }
    }
  }

  private addName(name: string, entity: PlaceEntity) {
    // Two-letter labels such as bank brands do not identify a destination reliably.
    if (name.replace(/\s/g, '').length < 3) return;
    const places = this.names.get(name) ?? [];
    if (!places.includes(entity)) places.push(entity);
    this.names.set(name, places);
  }

  private mergeEntities(coordinates: Map<PlaceEntity, PlaceRecord[]>) {
    const entities = new Set([...this.names.values()].flat());
    const owner = new Map([...entities].map(p => [p, p]));
    const members = new Map([...entities].map(p => [p, [p]]));
    const root = (p: PlaceEntity): PlaceEntity => {
      const parent = owner.get(p)!;
      if (parent === p) return p;
      const result = root(parent); owner.set(p, result); return result;
    };
    for (const candidates of this.names.values()) {
      if (candidates.length < 2) continue;
      for (let i = 0; i < candidates.length; i++) for (let j = i + 1; j < candidates.length; j++) {
        let a = root(candidates[i]), b = root(candidates[j]);
        if (a === b || a.group !== b.group) continue;
        if (!coordinates.get(a)!.every(left => coordinates.get(b)!.every(right => distanceM(left, right) <= 250))) continue;
        if (compareSources(a, b) > 0) [a, b] = [b, a];
        owner.set(b, a); members.set(a, [...members.get(a)!, ...members.get(b)!]);
        coordinates.set(a, [...coordinates.get(a)!, ...coordinates.get(b)!]);
      }
    }
    for (const entity of entities) if (root(entity) === entity) {
      entity.sourceIds = [...new Set(members.get(entity)!.flatMap(p => p.sourceIds))];
      entity.aliases = [...new Set(members.get(entity)!.flatMap(p => p.aliases))];
    }
    for (const [name, candidates] of this.names) this.names.set(name, [...new Set(candidates.map(root))]);
    for (const [name, candidates] of this.groups) this.groups.set(name, [...new Set(candidates.map(root))]);
  }

  lookup(query: string, fuzzy = true): Match | undefined {
    const key = normalizePlace(query);
    const exact = this.names.get(key);
    if (exact) return this.result(key, exact, 'exact');
    const roads = key.split(' and ');
    if (roads.length === 2) {
      const intersection = this.names.get(roads.map(street).join(' and '));
      if (intersection) return this.result(key, intersection, 'exact');
    }
    const words = key.split(' ');
    if (!fuzzy || words.length < 2 || key.length < 8) return;
    const candidates = new Set([...(this.fuzzyEdges.get(words[0]) ?? []), ...(this.fuzzyEdges.get(words.at(-1)!) ?? [])]);
    const matches = [...candidates].filter(name => oneEdit(key, name));
    // Equally close spellings retain every candidate; only one identity can resolve automatically.
    const results = matches.map(name => this.result(name, this.names.get(name)!, 'fuzzy'));
    if (results.length && results.every(result => result.places.length === 1 && result.places[0].id === results[0].places[0].id)) return results[0];
    if (results.length) return this.result(key, results.flatMap(result => result.places), 'fuzzy');
  }

  private result(canonical: string, places: PlaceEntity[], match: Match['match']): Match {
    const distinct = [...new Set(places)];
    const group = ['university of toronto', 'uoft', 'u of t'].includes(canonical) ? 'University of Toronto' : ['york', 'york university'].includes(canonical) ? 'York University' : undefined;
    return { places: distinct, canonical, match, ...(group ? { group } : {}) };
  }

  mentions(prompt: string): PlaceMention[] {
    const words = [...prompt.matchAll(/[\p{L}\p{N}\p{M}]+(?:['’][\p{L}\p{N}\p{M}]+)*|[&/]/gu)].map(m => ({ start: m.index!, end: m.index! + m[0].length }));
    const mentions: PlaceMention[] = [];
    for (let i = 0; i < words.length; i++) {
      const before = prompt.slice(0, words[i].start).replace(/["“‘(]+\s*$/, '');
      const previous = mentions.at(-1);
      const context = /\b(?:near|nearby|close to|around|by|commute to|walk to|to|of|from|at|in)\s+(?:the\s+)?$/i.test(before) || !before.trim() || previous && /^\s*(?:and|or|,)\s*(?:the\s+)?$/i.test(prompt.slice(previous.end, words[i].start));
      if (!context) continue;
      for (let end = Math.min(words.length, i + this.maxWords); end > i; end--) {
        const text = prompt.slice(words[i].start, words[end - 1].end);
        const exact = this.lookup(text, false);
        const startsWithCue = /^(?:near|nearby|around|by|to|of|from|at|in|close|commute|walk)$/i.test(prompt.slice(words[i].start, words[i].end));
        if (!exact && (startsWithCue || /[.,;!?]/.test(text.replace(/\b(st|ave|rd|blvd|dr|cres|ct|pl|hwy)\./gi, '$1')))) continue;
        const match = exact ?? this.lookup(text);
        if (!match) continue;
        mentions.push({ start: words[i].start, end: words[end - 1].end, query: text, ...(match.match === 'fuzzy' && match.places.length === 1 ? { normalizedQuery: match.canonical } : {}) });
        i = end - 1; break;
      }
    }
    return mentions;
  }
}

export const placeCatalogue = new PlaceCatalogue(curated, generated);
export const placeCatalogueVersion = inputHash(JSON.stringify([curated, generated]));
