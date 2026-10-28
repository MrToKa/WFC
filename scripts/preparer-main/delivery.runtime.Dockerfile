# API_BASE and WEB_BASE are fresh local aliases verified against the supplied IDs.
# This thin image is valid only when package.json and package-lock.json match
# the original main WFC checkpoint. No dependencies are installed here.
ARG API_BASE
ARG WEB_BASE
FROM ${API_BASE} AS api-runtime
ARG DELIVERY_REVISION
ARG DELIVERY_FINGERPRINT
ARG API_BASE_ID
ARG WEB_BASE_ID
LABEL org.opencontainers.image.revision="${DELIVERY_REVISION}" \
      wfc.preparer.delivery.fingerprint="${DELIVERY_FINGERPRINT}" \
      wfc.preparer.delivery.api-base="${API_BASE_ID}" \
      wfc.preparer.delivery.web-base="${WEB_BASE_ID}"
USER root
RUN rm -rf /app/server/dist
COPY --chown=node:node server-dist/ /app/server/dist/
COPY --chown=node:node ["templates/", "/app/Template files/"]
USER node
CMD ["node", "server/dist/server/index.js"]

FROM ${WEB_BASE} AS web-runtime
ARG DELIVERY_REVISION
ARG DELIVERY_FINGERPRINT
ARG API_BASE_ID
ARG WEB_BASE_ID
LABEL org.opencontainers.image.revision="${DELIVERY_REVISION}" \
      wfc.preparer.delivery.fingerprint="${DELIVERY_FINGERPRINT}" \
      wfc.preparer.delivery.api-base="${API_BASE_ID}" \
      wfc.preparer.delivery.web-base="${WEB_BASE_ID}"
USER root
RUN rm -rf /usr/share/nginx/html
COPY dist/ /usr/share/nginx/html/
COPY nginx.conf /etc/nginx/conf.d/default.conf
