FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    NODE_OPTIONS=--enable-source-maps \
    PORT=8080

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

USER node
EXPOSE 8080

CMD ["node", "dist/payment-mock/server.js"]
