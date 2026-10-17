// Test-only replacement for Next.js's `server-only` import marker.
// Vitest doesn't run under Next's react-server condition; the actual app keeps the
// real marker and enforces server-only module boundaries during Next builds.
export {};
