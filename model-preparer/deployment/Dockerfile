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
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=6 CMD node -e "const h=require('node:http');const r=h.get({host:'127.0.0.1',port:Number(process.env.PREPARER_PORT||8080),path:'/health',headers:{Host:new URL(process.env.PREPARER_PUBLIC_ORIGIN).host},timeout:4000},s=>{s.resume();process.exitCode=s.statusCode===200?0:1;});r.on('timeout',()=>r.destroy());r.on('error',()=>{process.exitCode=1;});"
CMD ["node", "app/server.mjs"]
