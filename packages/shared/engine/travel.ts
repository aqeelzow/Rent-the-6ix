import type { Listing, TravelTarget, TravelTimeRow } from '../schemas/index';
import { engineConfig } from './config';
export const clamp = (n: number) => Math.max(0, Math.min(100, n));
export const decliningScore = (actual: number, target: number) => clamp(100 * (2 - actual / target));
export function distanceM(a: Listing['location'], b: Listing['location']): number {
  const radians = Math.PI / 180;
  const dLat = (b.lat - a.lat) * radians, dLng = (b.lng - a.lng) * radians;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}
export const targetModes = (target: TravelTarget) => [target.mode, ...target.alternativeModes ?? []];
export function defaultMinutes(target: TravelTarget, mode: TravelTimeRow['mode']): number {
  const group = target.kind === 'place' || target.category === 'university' ? 'place' : ['grocery', 'pharmacy', 'rapid_transit'].includes(target.category ?? '') ? 'quick' : 'civic';
  return engineConfig.minutes[group][mode];
}
/** Rounded-up planning estimate from straight-line metres, including detours and mode overhead. */
export function estimateTravelMinutes(metres: number, mode: TravelTimeRow['mode']): number {
  if (!Number.isFinite(metres) || metres < 0) throw new RangeError('Travel distance must be finite and nonnegative');
  if (metres === 0) return 0;
  const { speedKmh, routeFactor, overheadMinutes } = engineConfig.travelEstimate[mode];
  return Math.ceil(overheadMinutes + 60 * (metres / 1000) * routeFactor / speedKmh);
}

/** A named place uses its coordinates; amenities use the nearest measured destination. */
export function targetDistanceM(target: TravelTarget, rows: TravelTimeRow[], origin?: Listing['location']): number | null {
  if (origin && target.resolved) return distanceM(origin, target.resolved);
  const distances = rows.filter(row => row.targetId === target.id).map(row => row.distanceM);
  return distances.length ? Math.min(...distances) : null;
}
/**
 * The straight-line distance at which walking stops being the sensible answer (SPEC 7.4). Travel
 * here is measured between the two addresses, so this is a fact about the pair, not a promise about
 * a route: under it the listing is a walk from the target, over it the renter needs transport.
 */
export const WALKABLE_M = 1500;
/**
 * What to say about a distance: walkable, or get a way of transport. Named after the advice rather
 * than after a mode, so it can never be confused with the travel mode of the same idea.
 */
export const travelAdvice = (metres: number): 'walkable' | 'transport' => metres < WALKABLE_M ? 'walkable' : 'transport';
export function evaluateTarget(target: TravelTarget, rows: TravelTimeRow[], origin?: Listing['location']) {
  const metres = targetDistanceM(target, rows, origin);
  if (metres === null) return { state: 'unknown' as const, score: null };
  const estimates = targetModes(target).map(mode => ({ actual: estimateTravelMinutes(metres, mode), limit: target.maxMinutes ?? defaultMinutes(target, mode) }));
  return {
    state: estimates.some(({ actual, limit }) => actual <= limit) ? 'pass' as const : 'fail' as const,
    score: Math.max(...estimates.map(({ actual, limit }) => decliningScore(actual, limit))),
  };
}
export function travelScore(targets: TravelTarget[], rows: TravelTimeRow[], origin?: Listing['location']): number | null {
  const scores = targets.map(t => evaluateTarget(t, rows, origin).score).filter((v): v is number => v !== null);
  return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
}
