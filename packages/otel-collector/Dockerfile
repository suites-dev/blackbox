FROM node:22-alpine

WORKDIR /app

COPY package.json ./package.json
COPY dist ./dist

RUN mkdir /data && chown node:node /data

USER node

EXPOSE 4318

ENTRYPOINT ["node", "dist/main.js"]
