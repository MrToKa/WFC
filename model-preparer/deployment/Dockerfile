ARG NODE_BASE=node@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5
FROM ${NODE_BASE}
WORKDIR /opt/preparer
COPY --from=preparer --chown=node:node / /opt/preparer/
COPY --from=package --chown=node:node / /opt/package/
COPY --from=preview --chown=node:node / /opt/preview/sdk/
RUN node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" \
    && mkdir -p /var/lib/preparer/data /var/lib/preparer/work /var/lib/preparer/outputs \
    && chown -R node:node /var/lib/preparer
USER node
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=6 CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "app/server.mjs"]
