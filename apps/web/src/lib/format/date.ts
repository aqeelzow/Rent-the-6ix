// Dates in en-CA (SPEC 17). ISO calendar dates are read as UTC so they never shift a day.

const day = new Intl.DateTimeFormat("en-CA", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/** "2026-11-01" → "Nov 1, 2026" */
export function formatDate(isoDate: string): string {
  return day.format(new Date(`${isoDate.slice(0, 10)}T00:00:00Z`));
}

const relative = new Intl.RelativeTimeFormat("en-CA", { numeric: "auto" });

/** 0 → "today", 1 → "yesterday", 3 → "3 days ago" */
export function formatDaysAgo(days: number): string {
  return relative.format(-days, "day");
}
