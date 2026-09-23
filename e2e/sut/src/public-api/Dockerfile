# public-api service image.
#
# The four services in this demo share one package.json, one tsconfig.json and the
# src/lib + src/domain.ts sources, so the build context is the sut/ root, not this
# folder. Build it from sut/:
#
#   docker build -f src/public-api/Dockerfile -t sut-public-api:local .
#
# See src/DOCKER.md for the full set of build commands.

# ---------------------------------------------------------------------------
# deps: full dependency tree (including devDependencies) used to run tsc.
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# ---------------------------------------------------------------------------
# build: compile src/ to dist/.
#
# We invoke tsc directly instead of "npm run build". The build script in
# package.json also runs scripts/clean-build.mjs, which is not present in this
# example, and package.json is out of scope for this image. Compiling into a
# fresh layer makes the clean step redundant anyway.
#
# tsconfig.json includes src/**/*.ts, so the unit tests compile into dist/ too.
# They are stripped here so no test code reaches the runtime image.
# ---------------------------------------------------------------------------
FROM deps AS build
WORKDIR /app
COPY tsconfig.json ./
COPY src ./src
RUN ./node_modules/.bin/tsc -p tsconfig.json \
 && find dist -name '*.test.js' -delete \
 && find dist -name '*.test.js.map' -delete

# ---------------------------------------------------------------------------
# prod-deps: runtime dependency tree only.
#
# public-api is the one service that genuinely uses all three runtime
# dependencies: pg, redis and @aws-sdk/client-sqs.
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

# ---------------------------------------------------------------------------
# runtime
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

LABEL org.opencontainers.image.title="sut-public-api" \
      org.opencontainers.image.description="Public API service for the compose auto-instrumentation demo. Fronts the subscription flow and fans out to fraud-check, order-service and payment-mock." \
      org.opencontainers.image.base.name="docker.io/library/node:22-bookworm-slim"

ENV NODE_ENV=production \
    NODE_OPTIONS=--enable-source-maps

WORKDIR /app

# Copied as root and run as node, so the running process cannot rewrite its own
# code or dependency tree.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY package.json ./

# Runtime closure for this service: its own compiled folder plus the shared
# modules it reaches through relative imports (../lib/*, ../domain,
# ../fixture-control-auth).
COPY --from=build /app/dist/lib ./dist/lib
COPY --from=build /app/dist/domain.js ./dist/
COPY --from=build /app/dist/domain.js.map ./dist/
COPY --from=build /app/dist/fixture-control-auth.js ./dist/
COPY --from=build /app/dist/fixture-control-auth.js.map ./dist/
COPY --from=build /app/dist/public-api ./dist/public-api

USER node

# No tini in the image. Compose already sets "init: true" for these services and
# Kubernetes reaps orphans via the pod sandbox, so PID 1 signal handling and
# zombie reaping are provided by the orchestrator. Run with "docker run --init"
# if you start the container directly.
EXPOSE 3000

# Mirrors the subscription-system Compose TCP probe, honouring PORT when set.
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["env", "-u", "NODE_OPTIONS", "node", "-e", "const p=Number(process.env.PORT||3000);const s=require('node:net').connect(p,'127.0.0.1',()=>{s.destroy();process.exit(0)});s.setTimeout(2000,()=>process.exit(1));s.on('error',()=>process.exit(1))"]

CMD ["node", "dist/public-api/server.js"]
