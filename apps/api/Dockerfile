# OPVARYN API image: one static binary plus the migrations it applies on deploy.
#
# Base images are pinned by digest (AGENTS.md): a tag can be re-pushed, a digest
# cannot. Dependabot watches this file for base-image updates.
# syntax=docker/dockerfile:1

FROM golang:1.27.4-alpine@sha256:70bd7ddea8b6cbe5d6943cde279d6b67feb10cc924fb9100d1d8757c1575b280 AS build

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

FROM alpine:3.24@sha256:f59abe656b692d901e184be3445e084786602108599d2a51d229c0f5a48c71bf AS runtime

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
