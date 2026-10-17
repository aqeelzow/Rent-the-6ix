import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import type { NextConfig } from "next";

const repoRoot = path.join(import.meta.dirname, "../..");

// One .env.local at the repo root serves web, worker and scripts. Next already loaded
// apps/web/.env*; root values only fill keys that are still unset.
const rootEnvFile = path.join(repoRoot, ".env.local");
if (existsSync(rootEnvFile)) {
  for (const [key, value] of Object.entries(parseEnv(readFileSync(rootEnvFile, "utf8")))) {
    process.env[key] ??= value;
  }
}

const nextConfig: NextConfig = {
  // Cache Components stay off: pages and GET route handlers render at request time,
  // so DB-backed routes never get prerendered at build (SPEC change log, P0.1).
  cacheComponents: false,
  reactCompiler: true,
  // packages/shared is plain TypeScript source with no build step.
  transpilePackages: ["@rentthe6ix/shared"],
  // Self-contained server bundle for the Docker image on Vultr.
  output: "standalone",
  outputFileTracingRoot: repoRoot,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
