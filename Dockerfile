# syntax=docker/dockerfile:1
#
# Production image for LeadSprint. Builds the API server (esbuild bundle)
# and the operator console (Vite static build), then serves both from a
# single Express process on a single port — the shape Coolify's "Git
# Repository" resource expects (one app, one port), per the deploy sheet.
#
# Build:  docker build -t leadsprint .
# Run:    docker run -p 5000:5000 --env-file .env leadsprint
#
# All required runtime environment variables are documented in
# .env.example and docs/leadsprint-provider-setup.md. None are baked into
# this image — they're supplied at deploy time (Coolify's environment
# variables UI, or `--env-file` locally).

FROM node:24-bookworm-slim AS base
RUN corepack enable
WORKDIR /repo

# ---- install workspace dependencies -----------------------------------
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY tsconfig.json tsconfig.base.json ./
COPY lib ./lib
COPY artifacts ./artifacts
COPY scripts ./scripts
RUN pnpm install --frozen-lockfile

# ---- typecheck + build --------------------------------------------------
FROM deps AS build
ENV NODE_ENV=production
# Required at Vite config-load time for the operator console build.
# BASE_PATH=/ means assets are served from the app root, which matches
# serving the SPA directly from Express (see STATIC_DIR below) rather than
# behind a sub-path proxy.
ENV PORT=5000
ENV BASE_PATH=/
RUN pnpm run typecheck
RUN pnpm --filter "@workspace/api-server" run build
RUN pnpm --filter "@workspace/leadsprint" run build

# Drop devDependencies from the workspace node_modules before shipping.
RUN pnpm install --frozen-lockfile --prod

# ---- runtime -------------------------------------------------------------
FROM node:24-bookworm-slim AS runtime
WORKDIR /repo
ENV NODE_ENV=production
COPY --from=build /repo /repo

ENV STATIC_DIR=/repo/artifacts/leadsprint/dist/public
ENV PORT=5000
EXPOSE 5000

# Coolify / Docker healthcheck — matches GET /api/healthz (routes/health.ts)
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+'/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
