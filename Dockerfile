FROM node:24-bookworm-slim AS build
RUN corepack enable && corepack prepare pnpm@10.10.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile
COPY tsconfig*.json ./
COPY src ./src
COPY scripts ./scripts
RUN pnpm build && pnpm prune --prod

FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends fonts-dejavu-core libfontconfig1 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production DATABASE_PATH=/app/data/executive.sqlite
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./package.json
RUN mkdir /app/data && chown node:node /app/data
USER node
CMD ["node", "dist/src/index.js"]
