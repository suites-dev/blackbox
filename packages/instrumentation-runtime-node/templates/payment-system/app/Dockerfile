FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json npm-shrinkwrap.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY server.cjs ./
USER node
CMD ["node", "server.cjs"]
