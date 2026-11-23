FROM node:24-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5 AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils ca-certificates \
    && rm -rf /var/lib/apt/lists/*

FROM runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --chown=node:node *.mjs ./
COPY --chown=node:node lib ./lib
COPY --chown=node:node test ./test
RUN mkdir -p /var/lib/wfc-ai/cache \
    && chown node:node /var/lib/wfc-ai/cache \
    && chmod 700 /var/lib/wfc-ai/cache
USER node
RUN node --test server.test.mjs test/*.test.mjs
EXPOSE 8091
CMD ["node", "server.mjs"]
