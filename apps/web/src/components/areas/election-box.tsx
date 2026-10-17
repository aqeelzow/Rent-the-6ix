import { ExternalLink, Vote } from "lucide-react";
import { t, type MessageKey } from "@/lib/format/messages";
import { ELECTION, electionPhase, torontoToday } from "./election";

const e = (key: string, params?: Record<string, string | number>) =>
  t(`areas.election.${key}` as MessageKey, params);

const longDay = new Intl.DateTimeFormat("en-CA", {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const monthDay = new Intl.DateTimeFormat("en-CA", {
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});
const at = (isoDate: string) => new Date(`${isoDate}T00:00:00Z`);

function OfficialLink({ href, label }: { href: string; label: string }) {
  return (
    <li>
      <a
        href={href}
        className="text-primary inline-flex items-center gap-1.5 font-medium underline-offset-4 hover:underline"
      >
        {label}
        <ExternalLink aria-hidden className="size-3.5" />
      </a>
    </li>
  );
}

/**
 * Election info (SPEC 9.3): the date, voting hours and official City links; after election day,
 * the official results. Static facts only: never candidates, parties, platforms or predictions.
 */
export function ElectionBox({ today = torontoToday() }: { today?: string }) {
  const { phase, advanceOver } = electionPhase(today);
  // "October 6 – 11"
  const advance = {
    dates: monthDay.formatRange(at(ELECTION.advance.start), at(ELECTION.advance.end)),
  };

  return (
    <aside
      aria-labelledby="election-title"
      className="bg-card flex flex-col gap-3 rounded-xl border p-4"
    >
      <h2 id="election-title" className="flex items-center gap-2 font-semibold">
        <Vote aria-hidden className="text-primary size-5" />
        {phase === "results"
          ? e("resultsTitle")
          : e("title", { date: longDay.format(at(ELECTION.day)) })}
      </h2>
      {phase === "upcoming" && (
        <div className="flex flex-col gap-1 text-sm">
          <p>{e("hours")}</p>
          <p className="text-muted-foreground">
            {advanceOver ? e("advancePast", advance) : e("advanceUpcoming", advance)}
          </p>
        </div>
      )}
      <ul className="flex flex-col gap-1.5 text-sm">
        {phase === "results" ? (
          <OfficialLink href={ELECTION.links.results} label={e("results")} />
        ) : (
          <>
            <OfficialLink href={ELECTION.links.myVote} label={e("myVote")} />
            <OfficialLink href={ELECTION.links.candidates} label={e("candidates")} />
            <OfficialLink href={ELECTION.links.keyDates} label={e("keyDates")} />
          </>
        )}
      </ul>
      <p className="text-muted-foreground text-xs">{e("note")}</p>
    </aside>
  );
}
