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
RUN CGO_ENABLED=0 go build -trimpath -buildvcs=false -ldflags '-s -w' -o /out/server ./cmd/server \
    && CGO_ENABLED=0 go build -trimpath -buildvcs=false -ldflags '-s -w' -o /out/migrate ./cmd/migrate

FROM alpine:3.22@sha256:5291449c3df73caf6ed85e649dec1b9e818b39a5d8c871e97afc13e9cd5e8fa8 AS runtime

# ca-certificates for outbound TLS, tzdata so timestamps render in the host zone.
RUN apk add --no-cache ca-certificates tzdata \
    && adduser -D -H -u 10001 opvaryn

WORKDIR /app
COPY --from=build /out/server /out/migrate ./
# The migration runner reads sql/migrations relative to its working directory.
COPY --from=build /src/sql ./sql

USER opvaryn
EXPOSE 21501

# The compose healthcheck uses the same probe; this one keeps a bare `docker run`
# honest too.
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
    CMD wget -qO- http://127.0.0.1:21501/readyz >/dev/null 2>&1 || exit 1

ENTRYPOINT ["/app/server"]
