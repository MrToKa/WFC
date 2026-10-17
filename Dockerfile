FROM node:24-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5 AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG VITE_API_URL=/
ENV VITE_API_URL=${VITE_API_URL}
ARG VITE_VIEWER_HARNESS=false
ENV VITE_VIEWER_HARNESS=${VITE_VIEWER_HARNESS}

RUN npm run build \
    && npm run server:build

FROM node:24-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5 AS api-runtime

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force

COPY --from=build /app/server/dist ./server/dist
COPY --from=build ["/app/Template files", "./Template files"]

RUN mkdir -p /var/lib/wfc/model-imports \
    && chown node:node /var/lib/wfc/model-imports \
    && chmod 700 /var/lib/wfc/model-imports \
    && node --version \
    && node --input-type=module -e "const m = await import('./server/dist/server/vendor/routings-model-package/index.mjs'); if (typeof m.verifyPackage !== 'function' || m.DEFAULT_LIMITS.maxArchiveBytes !== 2147483648) process.exit(1);"

USER node
EXPOSE 4000

CMD ["node", "server/dist/server/index.js"]

FROM api-runtime AS operations-runtime

USER root
COPY scripts/operations/*.mjs ./scripts/operations/
CMD ["node", "server/dist/server/operations/cli.js"]

FROM nginx:alpine AS web-runtime

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

FROM build AS test-runtime

RUN mkdir -p /app/node_modules/.vite /app/node_modules/.vite-temp \
    && chown -R node:node /app/dist /app/public/viewer-runtime /app/node_modules/.vite /app/node_modules/.vite-temp
USER node

CMD ["node", "--test", "--test-concurrency=1", "server/dist/server/__tests__/modelRegistryPackage.node-test.js"]
