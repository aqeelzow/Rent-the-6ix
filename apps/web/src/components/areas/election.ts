// The election info box (SPEC 9.3): static official facts and links, no AI. Checked against the
// City of Toronto's election pages (toronto.ca/city-government/elections) on 2026-10-17.

export const ELECTION = {
  /** Monday, October 26, 2026; voting places open 10 a.m. to 8 p.m. */
  day: "2026-10-26",
  /** Advance voting, 10 a.m. to 7 p.m. each day. */
  advance: { start: "2026-10-06", end: "2026-10-11" },
  links: {
    myVote: "https://myvote.toronto.ca/",
    candidates: "https://www.toronto.ca/city-government/elections/candidate-list/",
    keyDates: "https://www.toronto.ca/city-government/elections/key-dates/",
    results:
      "https://www.toronto.ca/city-government/elections/election-results-reports/election-results/",
  },
} as const;

const torontoDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Toronto",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Today's date in Toronto as "YYYY-MM-DD" (en-CA formats dates that way). */
export function torontoToday(now: Date = new Date()): string {
  return torontoDate.format(now);
}

/**
 * What the box shows on a given Toronto date: voting information up to and including election
 * day, then a link to the official results. Advance voting is reported as over once it has ended.
 */
export function electionPhase(today: string): {
  phase: "upcoming" | "results";
  advanceOver: boolean;
} {
  return {
    phase: today > ELECTION.day ? "results" : "upcoming",
    advanceOver: today > ELECTION.advance.end,
  };
}
