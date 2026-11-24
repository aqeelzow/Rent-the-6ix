import { z } from "zod";
import { OtpClient, type RoutedPath } from "./otp";

/**
 * GET /api/route?from=lat,lng&to=lat,lng&mode=walk|bike|drive|transit (#24): one routed trip
 * with its legs' shapes, for the map to draw the real path. 503 when no router is configured
 * (OTP_URL unset), so the map keeps its straight line; 404 when OTP finds no trip.
 *
 * Only for points around Waterloo: the router's graph covers the Region and nothing else.
 */
const point = z
  .string()
  .regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/)
  .transform((value) => {
    const [lat, lng] = value.split(",").map(Number) as [number, number];
    return { lat, lng };
  })
  .refine(
    ({ lat, lng }) => lat > 43.2 && lat < 43.75 && lng > -81 && lng < -80.1,
    "outside Waterloo",
  );

const querySchema = z.object({
  from: point,
  to: point,
  mode: z.enum(["walk", "bike", "drive", "transit"]),
});

/** Routed paths are the same all day for a pair: an hour of caching spares the router. */
const CACHE = "public, max-age=3600";

export function createRouteHandler(
  env: Record<string, string | undefined> = process.env,
  makeClient: (url: string) => Pick<OtpClient, "path"> = (url) => new OtpClient({ url }),
) {
  return async (request: Request): Promise<Response> => {
    const url = env.OTP_URL;
    if (!url) return Response.json({ error: "routing_unavailable" }, { status: 503 });
    const params = Object.fromEntries(new URL(request.url).searchParams);
    const parsed = querySchema.safeParse(params);
    if (!parsed.success) return Response.json({ error: "invalid_request" }, { status: 400 });
    const { from, to, mode } = parsed.data;
    const path: RoutedPath | null = await makeClient(url).path(from, to, mode, {
      signal: request.signal,
    });
    if (!path) return Response.json({ error: "no_route" }, { status: 404 });
    return Response.json(path, { headers: { "cache-control": CACHE } });
  };
}
