# The OTTv1 web server. It runs no submitted code itself: every compile and every bot runs in a
# throwaway container from the bot image (docker/bot.Dockerfile), started through the host's
# Docker daemon (see docker-compose.yml).
FROM node:24-alpine

RUN apk add --no-cache docker-cli

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/app/data \
    SANDBOX=docker
EXPOSE 3000
CMD ["node", "server/index.js"]
