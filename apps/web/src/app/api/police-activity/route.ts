import { z } from "zod";
import { PoliceActivitySchema, policeMapUrl } from "@/lib/police-activity";

const feed = new URL("/api/services/waterloo/datasets/recent", policeMapUrl);
const query = z.object({
  lat: z
    .string()
    .regex(/^-?\d+\.\d{3}$/)
    .transform(Number)
    .pipe(z.number().min(43.43).max(43.54)),
  lng: z
    .string()
    .regex(/^-?\d+\.\d{3}$/)
    .transform(Number)
    .pipe(z.number().min(-80.64).max(-80.46)),
});
const metadata = z.object({
  facets: z.object({
    reportingPeriods: z
      .array(PoliceActivitySchema.pick({ start: true, end: true }).extend({ id: z.number().int() }))
      .min(1),
  }),
});
const counts = z.object({
  total: PoliceActivitySchema.shape.total,
  byCategory: PoliceActivitySchema.shape.categories,
});

async function read(url: URL) {
  const response = await fetch(url, {
    next: { revalidate: 3600 },
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error("Police map unavailable");
  return response.json();
}

export async function GET(request: Request) {
  const point = query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!point.success)
    return Response.json({ error: "Expected a Waterloo location" }, { status: 400 });
  const { lat, lng } = point.data;

  try {
    const { facets } = metadata.parse(await read(feed));
    const [period] = facets.reportingPeriods.sort((a, b) => b.end.localeCompare(a.end));
    const url = new URL(feed.href + "/occurrences");
    // shortcut: the official map API takes a viewport box. Use a roughly 1 km square until it supports a radius.
    url.searchParams.set(
      "bbox",
      [lng - 0.006, lat - 0.0045, lng + 0.006, lat + 0.0045].map((n) => n.toFixed(4)).join(","),
    );
    url.searchParams.set("reportingPeriodId", String(period.id));
    url.searchParams.set("limit", "1");
    const { total, byCategory } = counts.parse(await read(url));
    return Response.json({
      start: period.start,
      end: period.end,
      total,
      categories: byCategory.sort((a, b) => b.count - a.count),
    });
  } catch {
    return Response.json({ error: "Police activity is temporarily unavailable" }, { status: 503 });
  }
}
