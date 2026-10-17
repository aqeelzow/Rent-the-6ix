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
export function evaluateTarget(target: TravelTarget, rows: TravelTimeRow[]) {
  const scores: number[] = [];
  const confirmed: boolean[] = [];
  for (const mode of targetModes(target)) {
    const row = rows.find(r => r.targetId === target.id && r.mode === mode);
    const minutes = target.maxMinutes ?? defaultMinutes(target, mode);
    if (row?.method === 'otp' && row.minutes !== null) {
      scores.push(decliningScore(row.minutes, minutes));
      confirmed.push(row.minutes <= minutes);
    } else {
      if (row) scores.push(decliningScore(row.distanceM, engineConfig.distanceM[mode] * minutes / defaultMinutes(target, mode)));
    }
  }
  return {
    state: confirmed.some(Boolean) ? 'pass' as const : confirmed.length === targetModes(target).length ? 'fail' as const : 'unknown' as const,
    score: scores.length ? Math.max(...scores) : null,
  };
}
export function travelScore(targets: TravelTarget[], rows: TravelTimeRow[]): number | null {
  const scores = targets.map(t => evaluateTarget(t, rows).score).filter((v): v is number => v !== null);
  return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
}
