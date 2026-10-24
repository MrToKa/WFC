# Root must verify these fresh local aliases against the exact supplied image IDs.
# No registry pull or unverified tag is part of recovery qualification.
ARG ARCHIVE_HELPER_IMAGE
ARG WFC_API_IMAGE
FROM ${WFC_API_IMAGE} AS dependencies
FROM ${ARCHIVE_HELPER_IMAGE}
ARG ARCHIVE_HELPER_ID
ARG WFC_API_ID
LABEL wfc.preparer.sp1.capture-node-base="${ARCHIVE_HELPER_ID}" \
      wfc.preparer.sp1.capture-dependency-base="${WFC_API_ID}"
COPY --from=dependencies /app/node_modules /app/node_modules
