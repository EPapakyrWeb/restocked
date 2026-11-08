FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data

WORKDIR /app
# No dependencies to install: the app only uses Node's standard library (incl. node:sqlite).
COPY package.json ./
COPY src ./src

RUN mkdir -p /data && chown node:node /data
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" || exit 1

# Run node directly (not via npm) so SIGTERM reaches the app and in-flight sends finish cleanly.
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]
