/** CAD belongs to the ordinary application. An explicit off switch remains
 * available for deployments which have not provisioned the private converter. */
export function cadDesignEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = env.WFC_CAD_DESIGN_ENABLED;
  if (flag !== undefined && flag !== 'true' && flag !== 'false') {
    throw new Error('WFC_CAD_DESIGN_ENABLED must be true or false.');
  }
  return flag !== 'false';
}

/** Server-owned destination only: browser requests cannot supply a converter
 * URL or redirect the authenticated payload outside the private CAD service. */
export function readCadConverterConfiguration(env: NodeJS.ProcessEnv = process.env) {
  const token = env.WFC_CAD_CONVERTER_TOKEN ?? env.POC_CONVERTER_TOKEN;
  if (!token || token.length < 32 || token.length > 4096 || !/^[\x21-\x7e]+$/.test(token)) {
    throw new Error('WFC_CAD_CONVERTER_TOKEN must contain 32 to 4096 printable non-space characters.');
  }
  let endpoint: URL;
  try { endpoint = new URL(env.WFC_CAD_CONVERTER_URL ?? ''); }
  catch { throw new Error('WFC_CAD_CONVERTER_URL must identify the private CAD conversion service.'); }
  if (endpoint.origin !== 'http://cad-converter:8090' || endpoint.pathname !== '/convert'
    || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error('WFC_CAD_CONVERTER_URL must be http://cad-converter:8090/convert on the private application network.');
  }
  return { convertUrl: endpoint.href, assembleUrl: new URL('/assemble', endpoint).href, token };
}

/** Validate before schema/storage initialization. Ordinary application database
 * names, accounts, hosts and storage buckets have no CAD-specific restriction. */
export function assertCadConfiguration(env: NodeJS.ProcessEnv): void {
  if (cadDesignEnabled(env)) readCadConverterConfiguration(env);
}
