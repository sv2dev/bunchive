FROM oven/bun:1.3.5-alpine AS build
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile && \
    bun run build

FROM oven/bun:1.3.5-alpine AS runtime
RUN apk add --no-cache tzdata
WORKDIR /app
ENV TZ=UTC
COPY --from=build /app/entrypoint.sh /app/bunchive.js ./
ENTRYPOINT ["/app/entrypoint.sh"]