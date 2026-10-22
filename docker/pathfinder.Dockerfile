FROM mcr.microsoft.com/dotnet/sdk:9.0-bookworm-slim AS engine-build
WORKDIR /source
COPY pathfinder-engine/src ./src
COPY pathfinder-engine/tools/PathFinder.ModelRunner ./tools/PathFinder.ModelRunner
RUN dotnet publish tools/PathFinder.ModelRunner/PathFinder.ModelRunner.csproj --configuration Release --output /engine --no-self-contained -p:UseAppHost=false
RUN dotnet publish src/PathFinder.BarrierVerifier/PathFinder.BarrierVerifier.csproj --configuration Release --output /barrier-verifier --no-self-contained -p:UseAppHost=false

FROM node:24-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5 AS web-build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV VITE_API_URL=/ VITE_VIEWER_HARNESS=false
RUN npm run build && npm run server:build

FROM mcr.microsoft.com/dotnet/runtime:9.0-bookworm-slim AS dotnet-runtime

FROM node:24-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5 AS api-runtime
ENV NODE_ENV=production DOTNET_ROOT=/usr/share/dotnet DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_GENERATE_ASPNET_CERTIFICATE=false \
    PF_BARRIER_VERIFIER_DLL=/opt/pathfinder-barrier-verifier/PathFinder.BarrierVerifier.dll
WORKDIR /app
COPY --from=dotnet-runtime /usr/share/dotnet /usr/share/dotnet
RUN apt-get update && apt-get install --no-install-recommends -y libicu72 libssl3 libgssapi-krb5-2 zlib1g \
    && rm -rf /var/lib/apt/lists/* \
    && ln -s /usr/share/dotnet/dotnet /usr/local/bin/dotnet && dotnet --list-runtimes
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=engine-build /engine /opt/pathfinder
COPY --from=engine-build /barrier-verifier /opt/pathfinder-barrier-verifier
COPY --from=web-build /app/server/dist ./server/dist
COPY --from=web-build ["/app/Template files", "./Template files"]
COPY scripts/operations/archives.mjs ./scripts/operations/archives.mjs
COPY scripts/pathfinder-local/container-ops.mjs ./scripts/pathfinder-local/container-ops.mjs
RUN mkdir -p /var/lib/wfc/model-imports /var/lib/wfc/pathfinder && chown -R node:node /var/lib/wfc && chmod 700 /var/lib/wfc/model-imports /var/lib/wfc/pathfinder
USER node
EXPOSE 4000
CMD ["node", "server/dist/server/index.js"]

FROM nginx:alpine AS web-runtime
COPY docker/pathfinder.nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /app/dist /usr/share/nginx/html
EXPOSE 80
