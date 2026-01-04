FROM oven/bun:1.3.5-alpine AS build
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile && \
    bun run build

FROM oven/bun:1.3.5-alpine AS runtime
WORKDIR /app
COPY --from=build /app/bunchive.js ./
ENTRYPOINT ["bun", "bunchive.js"]