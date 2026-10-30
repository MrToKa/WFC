FROM mcr.microsoft.com/dotnet/sdk:9.0-bookworm-slim AS tray-engine-build
WORKDIR /source
COPY pathfinder-engine/src ./src
COPY pathfinder-engine/tools/PathFinder.ModelRunner ./tools/PathFinder.ModelRunner
RUN dotnet publish tools/PathFinder.ModelRunner/PathFinder.ModelRunner.csproj --configuration Release --output /engine --no-self-contained -p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/runtime:9.0-bookworm-slim AS tray-dotnet-runtime

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

ENV NODE_ENV=production DOTNET_ROOT=/usr/share/dotnet DOTNET_CLI_TELEMETRY_OPTOUT=1 \
    PF_ENGINE_DLL=/opt/pathfinder/PathFinder.ModelRunner.dll PF_ROOT=/var/lib/wfc/pathfinder
WORKDIR /app

COPY --from=tray-dotnet-runtime /usr/share/dotnet /usr/share/dotnet
RUN apt-get update && apt-get install --no-install-recommends -y libicu72 libssl3 libgssapi-krb5-2 zlib1g \
    && rm -rf /var/lib/apt/lists/* \
    && ln -s /usr/share/dotnet/dotnet /usr/local/bin/dotnet
COPY --from=tray-engine-build /engine /opt/pathfinder

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force

COPY --from=build /app/server/dist ./server/dist
COPY --from=build ["/app/Template files", "./Template files"]

RUN mkdir -p /var/lib/wfc/model-imports /var/lib/wfc/pathfinder \
    && chown node:node /var/lib/wfc/model-imports /var/lib/wfc/pathfinder \
    && chmod 700 /var/lib/wfc/model-imports /var/lib/wfc/pathfinder \
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
