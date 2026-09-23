# payment-mock service image.
#
# The four services in this demo share one package.json, one tsconfig.json and the
# src/lib + src/domain.ts sources, so the build context is the sut/ root, not this
# folder. Build it from sut/:
#
#   docker build -f src/payment-mock/Dockerfile -t sut-payment-mock:local .
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
# All four services resolve against the same package.json, so each image carries
# the union of runtime dependencies (@aws-sdk/client-sqs, pg, redis) even when a
# service does not require all of them. payment-mock in particular loads only
# node: builtins. Pruning per service would mean splitting package.json into
# workspaces, which is out of scope here. See src/DOCKER.md.
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

# ---------------------------------------------------------------------------
# runtime
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

LABEL org.opencontainers.image.title="sut-payment-mock" \
      org.opencontainers.image.description="Payment mock service for the compose auto-instrumentation demo. Serves fixture-controlled payment authorisation responses." \
      org.opencontainers.image.base.name="docker.io/library/node:22-bookworm-slim"

ENV NODE_ENV=production \
    NODE_OPTIONS=--enable-source-maps

WORKDIR /app

# Copied as root and run as node, so the running process cannot rewrite its own
# code or dependency tree.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY package.json ./

# Runtime closure for this service: its own compiled folder plus the shared
# modules it reaches through relative imports (../lib/*, ../fixture-control-auth).
COPY --from=build /app/dist/lib ./dist/lib
COPY --from=build /app/dist/fixture-control-auth.js ./dist/
COPY --from=build /app/dist/fixture-control-auth.js.map ./dist/
COPY --from=build /app/dist/payment-mock ./dist/payment-mock

USER node

# No tini in the image. Compose already sets "init: true" for these services and
# Kubernetes reaps orphans via the pod sandbox, so PID 1 signal handling and
# zombie reaping are provided by the orchestrator. Run with "docker run --init"
# if you start the container directly.
EXPOSE 8080

# Mirrors the subscription-system Compose TCP probe, honouring PORT when set.
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["env", "-u", "NODE_OPTIONS", "node", "-e", "const p=Number(process.env.PORT||8080);const s=require('node:net').connect(p,'127.0.0.1',()=>{s.destroy();process.exit(0)});s.setTimeout(2000,()=>process.exit(1));s.on('error',()=>process.exit(1))"]

CMD ["node", "dist/payment-mock/server.js"]
