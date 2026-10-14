# OPVARYN web image: the Next.js standalone server.
#
# The build context is the repository root, because the app consumes the
# @opvaryn/contracts workspace package (and the lockfile that pins it). Build it
# with: docker build -f apps/web/Dockerfile .
#
# Base images are pinned by digest (AGENTS.md). Dependabot watches this file.
# syntax=docker/dockerfile:1

FROM node:26-alpine@sha256:143494b1da2945f061539253adc65e4f1569ddf07da2d384c022c791a9d90a4a AS build

WORKDIR /repo

# The workspace manifest set, then the lockfile: dependencies are only reinstalled
# when the lockfile changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/web/package.json apps/web/
# Node 26 images no longer ship corepack, so pnpm is installed explicitly. The
# version is the one mise.toml pins for the host; keep the two in step, because the
# lockfile format is pnpm's.
RUN npm install --global pnpm@12.12.0 && pnpm install --frozen-lockfile

COPY packages ./packages
COPY apps/web ./apps/web
# No API contract regeneration happens here: the generated types are committed and
# the quality gate is what proves they match openapi.yaml.
RUN pnpm --filter @opvaryn/web build

FROM node:26-alpine@sha256:143494b1da2945f061539253adc65e4f1569ddf07da2d384c022c791a9d90a4a AS runtime

RUN addgroup -S -g 10001 opvaryn && adduser -S -u 10001 -G opvaryn opvaryn

WORKDIR /app
# The standalone output carries only the server and the modules it imports; static
# assets and public files are copied beside it, which is the layout it expects.
COPY --from=build --chown=opvaryn:opvaryn /repo/apps/web/.next/standalone ./
COPY --from=build --chown=opvaryn:opvaryn /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=opvaryn:opvaryn /repo/apps/web/public ./apps/web/public

ENV NODE_ENV=production \
    PORT=21500 \
    HOSTNAME=0.0.0.0
USER opvaryn
EXPOSE 21500

HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=5 \
    CMD wget -qO- http://127.0.0.1:21500/ >/dev/null 2>&1 || exit 1

# The standalone server entry point; API_BASE_URL is read at request time, so the
# same image runs against any API host.
CMD ["node", "apps/web/server.js"]
