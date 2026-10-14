# OPVARYN API image: one static binary plus the migrations it applies on deploy.
#
# Base images are pinned by digest (AGENTS.md): a tag can be re-pushed, a digest
# cannot. Dependabot watches this file for base-image updates.
# syntax=docker/dockerfile:1

FROM golang:1.27-alpine@sha256:f92b6ef800e499660581efdabdf25d9d817a9d124eaf900924f0504e7e27e12d AS build

WORKDIR /src

# Dependency layer first: the module cache is only rebuilt when go.mod/go.sum move.
COPY go.mod go.sum ./
RUN go mod download

COPY . .
# Static, stripped binaries: the runtime image needs no libc and no toolchain.
# useradm ships too: a fresh host has no accounts and no other way to create the
# first one (the bootstrap problem in ADR 0008), so docs/ops-runbook.md runs it
# inside this container.
RUN CGO_ENABLED=0 go build -trimpath -buildvcs=false -ldflags '-s -w' -o /out/server ./cmd/server \
    && CGO_ENABLED=0 go build -trimpath -buildvcs=false -ldflags '-s -w' -o /out/migrate ./cmd/migrate \
    && CGO_ENABLED=0 go build -trimpath -buildvcs=false -ldflags '-s -w' -o /out/useradm ./cmd/useradm

FROM alpine:3.24@sha256:294b683cb724975bec92580e1e685676bd4b50bda910ddb8c51d4cabeaec77e6 AS runtime

# ca-certificates for outbound TLS, tzdata so timestamps render in the host zone.
RUN apk add --no-cache ca-certificates tzdata \
    && adduser -D -H -u 10001 opvaryn

WORKDIR /app
COPY --from=build /out/server /out/migrate /out/useradm ./
# The migration runner reads sql/migrations relative to its working directory.
COPY --from=build /src/sql ./sql

USER opvaryn
EXPOSE 21501

# The compose healthcheck uses the same probe; this one keeps a bare `docker run`
# honest too.
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
    CMD wget -qO- http://127.0.0.1:21501/readyz >/dev/null 2>&1 || exit 1

ENTRYPOINT ["/app/server"]
