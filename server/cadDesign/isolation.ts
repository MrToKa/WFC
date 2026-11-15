/** This branch's CAD feature is deliberately limited to the isolated PoC stack. */
export function assertCadPocIsolation(env: NodeJS.ProcessEnv): void {
  if (env.WFC_CAD_DESIGN_ENABLED !== 'true') return;
  let database: URL;
  try { database = new URL(env.DATABASE_URL ?? ''); }
  catch { throw new Error('CAD PoC requires its dedicated wfc_poc database.'); }
  if (env.WFC_CAD_ISOLATED_STACK !== 'true' ||
      !['postgres:', 'postgresql:'].includes(database.protocol) ||
      database.pathname !== '/wfc_poc' || database.hostname !== 'postgres' ||
      database.username !== 'wfc_poc' || (database.port && database.port !== '5432') ||
      env.MINIO_ENDPOINT !== 'minio' || env.MINIO_PORT !== '9000' ||
      env.MINIO_BUCKET_PROJECTS !== 'wfc-poc-project-files' ||
      env.MINIO_BUCKET_TEMPLATES !== 'wfc-poc-template-files' ||
      env.WFC_MODEL_BUCKET !== 'wfc-poc-models') {
    throw new Error('CAD PoC must use compose.poc.yaml with dedicated wfc_poc PostgreSQL and wfc-poc storage buckets.');
  }
}
