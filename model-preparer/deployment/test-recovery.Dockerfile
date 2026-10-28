FROM node@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5
COPY --from=preparer / /opt/preparer/
COPY --from=package / /opt/package/
COPY docker-recovery-fixture.mjs /opt/preparer/deployment/docker-recovery-fixture.mjs
COPY app-sigterm-fixture.mjs /opt/preparer/deployment/app-sigterm-fixture.mjs
ENTRYPOINT ["node"]
