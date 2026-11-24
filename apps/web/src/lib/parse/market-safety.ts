import type { SearchIntent } from "@rentkdubs/shared/schemas";

/** Waterloo does not publish neighbourhood crime rates suitable for scoring. */
export function withoutNeighbourhoodSafety(intent: SearchIntent): SearchIntent {
  if (!intent.safety.enabled && !intent.fieldSources.safety && !intent.weights?.safety) return intent;
  const fieldSources = { ...intent.fieldSources };
  delete fieldSources.safety;
  return {
    ...intent,
    safety: { enabled: false, hard: false },
    fieldSources,
    ...(intent.weights ? { weights: { ...intent.weights, safety: 0 } } : {}),
  };
}
