# Root must resolve and record the official base digest before building. No
# mutable default tag or downloaded host/unrelated-project browser is used.
ARG PLAYWRIGHT_BASE_IMAGE
FROM ${PLAYWRIGHT_BASE_IMAGE} AS producer-base
ARG PLAYWRIGHT_BASE_IMAGE
USER root
WORKDIR /opt/wfc-producer
RUN node -e "if (!/^mcr\.microsoft\.com\/playwright:v1\.64\.0-noble@sha256:[a-f0-9]{64}$/.test(process.argv[1] || '')) process.exit(1)" "$PLAYWRIGHT_BASE_IMAGE"
COPY docker/pathfinder-producer/package.json docker/pathfinder-producer/package-lock.json ./
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 PLAYWRIGHT_BROWSERS_PATH=/ms-playwright NODE_ENV=production
RUN npm ci --omit=dev --ignore-scripts \
    && node -e "if (require('./node_modules/playwright-core/package.json').version !== '1.64.0') process.exit(1)" \
    && npm cache clean --force
COPY scripts/pathfinder-background/container-profile.mjs scripts/pathfinder-background/producer-process.mjs scripts/pathfinder-background/sandbox-probe.mjs ./
RUN chmod -R a-w /opt/wfc-producer
USER 1000:1000
ENV HOME=/tmp/home TMPDIR=/tmp NODE_OPTIONS=--max-old-space-size=512
ENTRYPOINT ["node"]

FROM producer-base AS producer-probe
CMD ["/opt/wfc-producer/sandbox-probe.mjs"]

FROM producer-base AS producer-runtime
COPY scripts/pathfinder-background/managed-runner.mjs ./managed-runner.mjs
COPY public/viewer-runtime/7.130.0/ ./viewer-runtime/7.130.0/
CMD ["/opt/wfc-producer/managed-runner.mjs"]
