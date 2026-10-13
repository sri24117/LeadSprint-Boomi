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
# Pinned so a build today and a build next month resolve with the same pnpm
# (an unpinned corepack default floats with the base image). Bump deliberately.
ARG PNPM_VERSION=12.5.1
RUN npm install --global "pnpm@${PNPM_VERSION}"
WORKDIR /repo

# ---- install workspace dependencies -----------------------------------
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY tsconfig.json tsconfig.base.json ./
COPY lib ./lib
COPY artifacts ./artifacts
COPY scripts ./scripts
# --frozen-lockfile: ship exactly the dependency versions CI tested. A stale
# lockfile must fail the build, not silently resolve newer packages.
RUN pnpm install --frozen-lockfile

# ---- typecheck + build --------------------------------------------------
FROM deps AS build
ARG VITE_LEADSPRINT_DEMO_AUTH=false
ARG VITE_CLERK_PUBLISHABLE_KEY=""
ENV VITE_LEADSPRINT_DEMO_AUTH=${VITE_LEADSPRINT_DEMO_AUTH}
ENV VITE_CLERK_PUBLISHABLE_KEY=${VITE_CLERK_PUBLISHABLE_KEY}
ENV NODE_ENV=production
# Required at Vite config-load time for the operator console build.
# BASE_PATH=/ means assets are served from the app root, which matches
# serving the SPA directly from Express (see STATIC_DIR below) rather than
# behind a sub-path proxy.
ENV PORT=5000
ENV BASE_PATH=/
# Fail fast on a console build that can never work in this image. The API
# refuses demo auth when NODE_ENV=production, so a demo-auth console would
# 401 on every request. An empty Clerk key is only a warning: the console then
# says "Sign-in is not configured" instead of failing the whole deploy.
RUN if [ "${VITE_LEADSPRINT_DEMO_AUTH}" = "true" ]; then \
      echo "ERROR: VITE_LEADSPRINT_DEMO_AUTH=true cannot be used for a production image (the API refuses demo auth when NODE_ENV=production). Set it to false." >&2; \
      exit 1; \
    fi; \
    if [ -z "${VITE_CLERK_PUBLISHABLE_KEY}" ]; then \
      echo "WARNING: VITE_CLERK_PUBLISHABLE_KEY is empty. Nobody will be able to sign in. Set it as a BUILD-time variable and redeploy." >&2; \
    fi
RUN pnpm run typecheck
RUN pnpm --filter "@workspace/api-server" run build
RUN pnpm --filter "@workspace/leadsprint" run build

# Drop devDependencies from the workspace node_modules before shipping.
RUN pnpm install --frozen-lockfile --prod

# ---- runtime -------------------------------------------------------------
FROM node:24-bookworm-slim AS runtime
WORKDIR /repo
ENV NODE_ENV=production
# Run as the image's unprivileged `node` user, not root: a compromised
# process must not be able to rewrite the bundle, install packages, or
# touch anything else on the container filesystem. The app only needs to
# read /repo (bundle + static SPA) and listen on unprivileged port 5000.
COPY --from=build --chown=node:node /repo /repo
USER node

ENV STATIC_DIR=/repo/artifacts/leadsprint/dist/public
ENV PORT=5000
EXPOSE 5000

# Coolify / Docker healthcheck — matches GET /api/healthz (routes/health.ts)
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+'/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
