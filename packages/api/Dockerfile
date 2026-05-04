# syntax=docker/dockerfile:1.7
FROM oven/bun:1.1.34-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/api/package.json packages/api/package.json
COPY packages/cli/package.json packages/cli/package.json
COPY packages/core/package.json packages/core/package.json
RUN bun install --frozen-lockfile || bun install

FROM oven/bun:1.1.34-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Default to the web process. Fly's [processes] block overrides this per process group.
EXPOSE 8080
CMD ["bun", "packages/api/src/web.ts"]
