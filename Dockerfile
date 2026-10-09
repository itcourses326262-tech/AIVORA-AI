# syntax=docker/dockerfile:1
#
# AIVORE production image: deps -> build -> runtime.
#
# Base image: Debian bookworm (glibc), not Alpine (musl). The two native dependencies work on both,
# better-sqlite3 13 ships prebuilt binaries for glibc and musl inside its npm package and sharp pulls
# its prebuilt libvips from npm, so neither needs a compiler or a download at build time. glibc wins
# on the rest: libvips is built and tested against it first, sharp's own performance notes call musl's
# default allocator slow for this kind of workload (the Demo video provider and thumbnails), and the
# image has the usual debugging tools. The price is about 80 MB.
#
# The runtime stage holds only what `node server.js` needs: .next/standalone, .next/static, public and
# drizzle, plus five command-line tools under /app/scripts (worker, admin, migrate, backup, restore: see
# the `build` stage). There is no source tree, no devDependency, no tsx and no compiler in the final image.
#
#   docker build -t aivore:local .          (the same as `npm run docker:build`)
#   docker run --rm -p 3000:3000 -v aivore-data:/data --env-file .env \
#     -e DATABASE_PATH=/data/aivore.db -e STORAGE_LOCAL_DIR=/data/media aivore:local
#
# The two -e lines are not optional: `--env-file` beats the ENV lines of the image, and a copy of
# .env.example says DATABASE_PATH=./data/aivore.db, which is a path inside the container's own layer.
# Without them the database and the media would be lost with the container while the volume stays
# empty. A later -e beats --env-file. docker-compose.yml pins the same two paths for you.
#
# `next build` type-checks the whole project: a cold build took about 50 s and about 1.6 GB of extra
# memory on a 4-core machine. On a 1 GB server add swap or build the image elsewhere.

# Change the Node major together with .nvmrc and "engines" in package.json.
ARG NODE_VERSION=22

# ---- deps: every dependency, exactly as in package-lock.json ----------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

# ---- build: the Next.js standalone server and the command-line tools --------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# next.config.ts sets `output: 'standalone'`. No environment variable is needed to build: the
# configuration is parsed lazily, at the first request.
RUN npm run build

# The worker, the admin CLI and the migration runner are TypeScript that imports src/. In development
# `tsx` runs them; the image has no tsx and no source, so they are bundled into three self-contained
# ES modules (esbuild comes with tsx). better-sqlite3 and sharp stay external: they are native and
# are resolved from the standalone node_modules at run time. `--conditions=react-server` turns the
# `server-only` marker package into a no-op, like the `--conditions` flag of the npm scripts.
RUN mkdir -p /out/scripts \
  && node_modules/.bin/esbuild scripts/worker.ts scripts/admin.ts scripts/migrate.ts \
    --bundle --platform=node --format=esm --target=node22 --conditions=react-server \
    --external:better-sqlite3 --external:sharp \
    --outdir=/out/scripts --out-extension:.js=.mjs --log-level=warning \
    '--banner:js=import { createRequire as __aivoreRequire } from "node:module"; const require = __aivoreRequire(import.meta.url);'

# ---- runtime ---------------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
WORKDIR /app

# HOSTNAME matters: Docker sets it to the container id, and the standalone server would then listen on
# that one address only, which makes the health check (127.0.0.1) and port mappings fail.
#
# KEEP_ALIVE_TIMEOUT (milliseconds, read by Next's server.js) matters behind a reverse proxy: Node closes
# an idle connection after 5 s by default, while proxies keep their upstream connections for much longer
# (Caddy: 2 minutes). A request that reuses a connection at the moment Node closes it fails with a 502.
# Keep this above the longest idle time of the proxy in front of the container.
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATABASE_PATH=/data/aivore.db \
    STORAGE_LOCAL_DIR=/data/media \
    WORKER_MODE=inline \
    KEEP_ALIVE_TIMEOUT=125000

# Everything the application writes lives under /data (SQLite database, uploaded and generated media,
# the email outbox, backups). It is created before the VOLUME line so that a new named volume inherits
# the non-root owner; a bind mount must be owned by uid 1000 on the host.
RUN mkdir -p /data/media && chown -R node:node /data /app

COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
# Already inside the standalone output (next.config.ts traces it); copied again so the migrations can
# never go missing if that tracing rule changes.
COPY --from=build --chown=node:node /app/drizzle ./drizzle
COPY --from=build --chown=node:node /out/scripts ./scripts
COPY --chown=node:node scripts/backup.mjs scripts/restore.mjs ./scripts/

USER node
VOLUME ["/data"]
EXPOSE 3000

# /api/health answers 200 when SQLite answers `SELECT 1` and 503 otherwise. No curl in the image:
# Node's own fetch does it. start-period covers the first start (the database is created and migrated).
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]

# Node is PID 1 and handles SIGTERM itself: Next.js stops accepting connections, finishes the requests
# in flight and exits (code 143), and the `exit` hook of the inline job runner hands running
# generations back to the queue (src/server/jobs/start.ts). docker compose adds `init: true`
# (tini) on top, `docker run --init` does the same.
STOPSIGNAL SIGTERM
CMD ["node", "server.js"]
