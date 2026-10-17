import { describe, expect, it } from "vitest";
import { ELECTION, electionPhase, torontoToday } from "./election";

describe("torontoToday", () => {
  it("uses the Toronto calendar date, not UTC", () => {
    // 02:00 UTC on Oct 27 is still Oct 26 in Toronto (EDT, UTC−4).
    expect(torontoToday(new Date("2026-10-27T02:00:00Z"))).toBe("2026-10-26");
    expect(torontoToday(new Date("2026-10-27T04:30:00Z"))).toBe("2026-10-27");
  });
});

describe("electionPhase", () => {
  it("shows voting information through election day, then the results link", () => {
    expect(electionPhase("2026-10-05")).toEqual({ phase: "upcoming", advanceOver: false });
    expect(electionPhase("2026-10-11")).toEqual({ phase: "upcoming", advanceOver: false });
    expect(electionPhase("2026-10-17")).toEqual({ phase: "upcoming", advanceOver: true });
    expect(electionPhase(ELECTION.day)).toEqual({ phase: "upcoming", advanceOver: true });
    expect(electionPhase("2026-10-27")).toEqual({ phase: "results", advanceOver: true });
  });

  it("links only to official City of Toronto pages", () => {
    for (const link of Object.values(ELECTION.links)) {
      expect(new URL(link).hostname).toMatch(/(^|\.)toronto\.ca$/);
    }
  });
});
