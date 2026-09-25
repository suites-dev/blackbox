FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

FROM deps AS build
WORKDIR /app
COPY tsconfig.json ./
COPY src ./src
RUN ./node_modules/.bin/tsc -p tsconfig.json \
 && find dist -name '*.test.js' -delete \
 && find dist -name '*.test.js.map' -delete

FROM node:22-bookworm-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM node:22-bookworm-slim AS runtime

LABEL org.opencontainers.image.title="sut-redis-proof-consumer" \
      org.opencontainers.image.description="Blocking Redis proof consumer for the Blackbox shared-state observation boundary."

ENV NODE_ENV=production \
    NODE_OPTIONS=--enable-source-maps

WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY package.json ./
COPY --from=build /app/dist/lib ./dist/lib
COPY --from=build /app/dist/redis-proof-consumer ./dist/redis-proof-consumer

USER node
CMD ["node", "dist/redis-proof-consumer/server.js"]
