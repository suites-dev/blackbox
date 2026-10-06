FROM node:22.22.0-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY app.cjs ./
USER node
CMD ["node", "app.cjs"]
