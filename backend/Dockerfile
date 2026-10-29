# syntax=docker/dockerfile:1

# Keep the Go version in step with Dockerfile.dev and docker-compose.tool.yml.
FROM --platform=$BUILDPLATFORM golang:1.27.3 AS build
WORKDIR /src

# Download dependencies as a separate, cacheable step.
RUN --mount=type=cache,target=/go/pkg/mod/ \
    --mount=type=bind,source=go.sum,target=go.sum \
    --mount=type=bind,source=go.mod,target=go.mod \
    go mod download -x

ARG TARGETARCH
RUN --mount=type=cache,target=/go/pkg/mod/ \
    --mount=type=bind,target=. \
    CGO_ENABLED=0 GOARCH=$TARGETARCH go build -ldflags='-w -s' -o /bin/server ./cmd && \
    CGO_ENABLED=0 GOARCH=$TARGETARCH go build -ldflags='-w -s' -o /bin/migrate ./cmd/migrate

# distroless/static ships with ca-certificates and tzdata, and has no shell or
# package manager, which suits a static (CGO_ENABLED=0) binary.
FROM gcr.io/distroless/static-debian12:nonroot AS final

COPY --from=build /bin/server /bin/server
COPY --from=build /bin/migrate /bin/migrate

# migrate reads its SQL from disk at runtime, so bake it into the image.
COPY migration /migration
ENV MIGRATIONS_PATH=/migration

# 65532 is distroless' nonroot uid:gid, given explicitly so a base-image bump
# cannot silently run as root.
USER 65532:65532

EXPOSE 8080

ENTRYPOINT [ "/bin/server" ]
