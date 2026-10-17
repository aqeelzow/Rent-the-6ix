// B-owned scoring and ordinary-search tunables; surface on A's /data page at integration.
export const engineConfig = {
  weights: { value: 30, price: 15, travel: 30, home: 25, safety: 0 },
  fairnessWeight: 45, safetyWeight: 15, priceOverrun: .15, sizeOverrun: .25,
  ageOverrunYears: 20, availabilityOverrunDays: 30,
  candidateLimit: 500, routingLimit: 100, routingBudgetMs: 3000, percentileBudgetMs: 120000,
  distanceM: { walk: 800, bike: 3000, transit: 3000, drive: 6000 },
  minutes: {
    quick: { walk: 10, bike: 10, transit: 15, drive: 10 },
    civic: { walk: 15, bike: 10, transit: 20, drive: 10 },
    place: { walk: 20, bike: 20, transit: 30, drive: 25 },
  },
} as const;
