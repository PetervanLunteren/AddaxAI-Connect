# MinIO server and mc client, built from source.
#
# MinIO stopped publishing images and deleted minio/minio and minio/mc from
# Docker Hub on 11 Sep 2026, so a fresh deploy could no longer pull them. The
# Go module proxy still serves the source. This builds the exact release every
# server ran from the old image, and the mc that release bundled, so switching
# changes no version. One image serves both minio and minio-init.
#
# Bumping: see "MinIO image" in DEVELOPERS.md. Keep the CI version check in
# .github/workflows/minio-image.yml in step with the tags below.

# The Go release upstream built this MinIO release with.
FROM golang:1.24.6-bookworm AS build

ARG MINIO_MODULE=v0.0.0-20250907161309-07c3a429bfed
ARG MINIO_VERSION=2025-09-07T16:13:09Z
ARG MINIO_RELEASE=RELEASE.2025-09-07T16-13-09Z
ARG MINIO_COMMIT=07c3a429bfed433e49018cb0f78a52145d4bedeb
ARG MINIO_SHORT_COMMIT=07c3a429bfed

ARG MC_MODULE=v0.0.0-20250813083541-7394ce0dd2a8
ARG MC_VERSION=2025-08-13T08:35:41Z
ARG MC_RELEASE=RELEASE.2025-08-13T08-35-41Z
ARG MC_COMMIT=7394ce0dd2a80935aded936b09fa12cbb3cb8096
ARG MC_SHORT_COMMIT=7394ce0dd2a8

# Static binaries. The build shares a small server with the running stack, so
# compile one package at a time and make the compiler and linker (Go programs
# themselves) collect garbage before they pass 1 GiB.
ENV CGO_ENABLED=0 GOFLAGS=-p=1 GOMEMLIMIT=1GiB

# The -X flags are the version stamps upstream sets. Without them the binary
# calls itself DEVELOPMENT.GOGET. Two steps, so a new mc does not rebuild minio.
RUN go install -trimpath -ldflags "-s -w \
      -X github.com/minio/minio/cmd.Version=${MINIO_VERSION} \
      -X github.com/minio/minio/cmd.ReleaseTag=${MINIO_RELEASE} \
      -X github.com/minio/minio/cmd.CommitID=${MINIO_COMMIT} \
      -X github.com/minio/minio/cmd.ShortCommitID=${MINIO_SHORT_COMMIT} \
      -X github.com/minio/minio/cmd.CopyrightYear=2025" \
    github.com/minio/minio@${MINIO_MODULE}

RUN go install -trimpath -ldflags "-s -w \
      -X github.com/minio/mc/cmd.Version=${MC_VERSION} \
      -X github.com/minio/mc/cmd.ReleaseTag=${MC_RELEASE} \
      -X github.com/minio/mc/cmd.CommitID=${MC_COMMIT} \
      -X github.com/minio/mc/cmd.ShortCommitID=${MC_SHORT_COMMIT} \
      -X github.com/minio/mc/cmd.CopyrightYear=2025" \
    github.com/minio/mc@${MC_MODULE}

FROM debian:bookworm-slim

# curl for the compose healthcheck. ca-certificates because the cold tier and
# the backup mirror talk TLS to the remote bucket.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /go/bin/minio /go/bin/mc /usr/local/bin/

# The old image's entrypoint only put "minio" in front of the compose command,
# so `server /data ...` runs the same way here. Root, like before.
ENTRYPOINT ["minio"]
