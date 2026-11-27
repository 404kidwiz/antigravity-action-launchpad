FROM node:22-slim

WORKDIR /app

COPY package.json ./
COPY dist/ ./dist/

USER node

CMD ["node", "dist/server.mjs"]
