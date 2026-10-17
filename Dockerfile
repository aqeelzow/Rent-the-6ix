# syntax=docker/dockerfile:1
# Dockerfile — owner: D (P0.9)
#
# One file, two runnable targets, because web and worker share the same install and
# build layers. Compose picks a target with `build.target`.
#
#   docker build --target web    -t rentthe6ix-web    .
#   docker build --target worker -t rentthe6ix-worker .
#
# Node 24 matches package.json `engines`. The web target is Next's `output:
# "standalone"` bundle (next.config.ts sets `outputFileTracingRoot` to the repo root,
# so the server entry is apps/web/server.js and node_modules live at /app).

ARG NODE_VERSION=24-bookworm-slim

FROM node:${NODE_VERSION} AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
RUN corepack enable

# Manifests only, so `pnpm install` is cached until a dependency actually changes.
# If a new workspace package is added, add its package.json here too.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/shared/package.json packages/shared/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# Source on top of the installed tree. The copied node_modules keep pnpm's relative
# workspace symlinks, which still point at /app/packages/shared.
FROM base AS build
COPY --from=deps /app ./
COPY . .
# NEXT_PUBLIC_* values are inlined at build time, so they arrive as build args, not
# as runtime env. Empty is fine: the map falls back to OpenFreeMap (SPEC 20).
ARG NEXT_PUBLIC_MAPTILER_KEY=
ENV NEXT_PUBLIC_MAPTILER_KEY=${NEXT_PUBLIC_MAPTILER_KEY}
RUN pnpm --filter web build && mkdir -p apps/web/public

# --- runtime: web ---------------------------------------------------------
FROM node:${NODE_VERSION} AS web
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
# `/status` is the judge-facing page and exists from P0.1, so it is the health target.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=5 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]

# --- runtime: worker ------------------------------------------------------
# Node 24 runs TypeScript directly (type stripping), so the worker needs no build
# step. Keep the deps tree: civic loaders and the OTP client import shared code.
#
# Listing adapters drive CloakBrowser (Chromium via playwright-core; C, apps/worker/src/lib/fetch.ts).
# Its binary and Chromium's system libraries go in layers that depend only on the installed
# dependencies, so a code change doesn't re-download ~150 MB. The binary lives in the image
# (CLOAKBROWSER_CACHE_DIR), not the worker-cache volume, and auto-update is off so a running
# container never swaps its browser mid-run.
FROM base AS worker
ENV NODE_ENV=production \
    CLOAKBROWSER_CACHE_DIR=/opt/cloakbrowser \
    CLOAKBROWSER_AUTO_UPDATE=false
COPY --from=deps /app ./
# playwright-core knows Chromium's apt packages for this Debian release.
RUN node apps/worker/node_modules/playwright-core/cli.js install-deps chromium \
    && rm -rf /var/lib/apt/lists/*
RUN apps/worker/node_modules/.bin/cloakbrowser install
COPY --from=build /app ./
CMD ["node", "apps/worker/src/index.ts"]
