# Game server image (architecture/Platform-Services.md §5) — also hosts the
# built client (same origin: / = SPA, /ws = game socket).
# Build context = repo root; workspace TS is bundled by esbuild, npm deps stay
# external and come from a pruned prod install (pnpm deploy).

FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY packages/engine/package.json packages/engine/package.json
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/chain-solana/package.json packages/chain-solana/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/client/package.json apps/client/package.json
COPY e2e/package.json e2e/package.json
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY packages ./packages
COPY apps/server ./apps/server
COPY apps/client ./apps/client
RUN pnpm --filter @metarchy/server exec esbuild src/index.ts \
      --bundle --platform=node --target=node22 --format=esm \
      --outfile=dist/index.mjs \
      --external:fastify --external:@fastify/static --external:ws --external:jose \
      --external:pg --external:@noble/hashes --external:@electric-sql/pglite \
      --external:prom-client --external:@sentry/node
# Build stamp for client error reports (deploy.yml passes the commit sha).
ARG GIT_SHA=unknown
RUN VITE_GIT_SHA="$GIT_SHA" pnpm --filter @metarchy/client exec vite build
RUN pnpm --filter @metarchy/server deploy --prod --ignore-scripts --legacy /out

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /repo/apps/server/dist/index.mjs ./index.mjs
COPY --from=build /repo/apps/client/dist ./public
COPY supabase/migrations ./migrations
ENV MIGRATIONS_DIR=/app/migrations
ENV STATIC_DIR=/app/public
EXPOSE 8080
CMD ["node", "index.mjs"]
