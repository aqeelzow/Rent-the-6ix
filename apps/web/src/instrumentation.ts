/**
 * Warm the TigerData connection when the server starts.
 *
 * The first search after a restart otherwise pays the TLS handshake and first-query planning
 * (~0.5–1 s) inside the request. The production image is a long-running Next server, so doing it
 * at boot moves that cost off the demo. Fire-and-forget: every route already has its own
 * unavailable path, and a slow database must not delay startup.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { getClient } = await import("./lib/db");
    void getClient()
      ?.unsafe("SELECT 1")
      .catch(() => {});
  } catch {
    // Invalid configuration is reported by the routes that need the database.
  }
}
