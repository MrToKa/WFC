import path from 'node:path';

export function readConfiguration(env = process.env) {
  const required = ['PREPARER_DATA_DIR', 'PREPARER_WORK_DIR', 'PREPARER_OUTPUT_DIR', 'PREPARER_PACKAGE_MODULE'];
  for (const name of required) if (!env[name] || !path.isAbsolute(env[name])) throw new Error(`Missing or invalid ${name}`);
  for (const name of ['PREPARER_SDK_DIR', 'PREPARER_IMPORT_ROOT', 'PREPARER_SOURCE_ROOT', 'PREPARER_PRICE_PROOF_PATH', 'PREPARER_PRICE_SIGNING_KEY_PATH']) if (env[name] && !path.isAbsolute(env[name])) throw new Error(`Invalid ${name}`);
  const requestedMode = env.PREPARER_MODE || 'closed';
  if (!['closed', 'simulation', 'live'].includes(requestedMode)) throw new Error('Invalid PREPARER_MODE');
  let wfcOrigin = null;
  if (env.PREPARER_WFC_ORIGIN) {
    let endpoint;
    try { endpoint = new URL(env.PREPARER_WFC_ORIGIN); } catch { throw new Error('Invalid PREPARER_WFC_ORIGIN'); }
    if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.pathname !== '/' || endpoint.search || endpoint.hash) throw new Error('Invalid PREPARER_WFC_ORIGIN');
    wfcOrigin = endpoint.origin;
  }
  // WFC's authenticated workspace has one operational mode. Legacy standalone
  // installations retain their explicitly selected closed/simulation/live mode.
  const mode = wfcOrigin ? 'live' : requestedMode;
  const instanceId = env.PREPARER_INSTANCE_ID || null;
  if (instanceId && !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(instanceId)) throw new Error('Invalid PREPARER_INSTANCE_ID');
  const port = Number(env.PREPARER_PORT || 8080);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid PREPARER_PORT');
  const host = env.PREPARER_HOST || '127.0.0.1';
  if (!['127.0.0.1', 'localhost', '0.0.0.0', '::1'].includes(host)) throw new Error('Invalid PREPARER_HOST');
  const publicOrigin = env.PREPARER_PUBLIC_ORIGIN || `http://${host === '0.0.0.0' ? '127.0.0.1' : host === '::1' ? '[::1]' : host}:${port}`;
  const origin = new URL(publicOrigin);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('Invalid PREPARER_PUBLIC_ORIGIN');
  const readiness = {};
  const checks = {
    APS_CLIENT_ID: value => /^[A-Za-z0-9_-]{8,128}$/.test(value),
    APS_CLIENT_SECRET: value => value.length >= 8 && value.length <= 512 && !/[\s\x00-\x1f]/.test(value),
    APS_REGION: value => ['US', 'EMEA'].includes(value),
    APS_BUCKET: value => /^[a-z0-9][a-z0-9._-]{2,127}$/.test(value),
  };
  for (const [name, check] of Object.entries(checks)) {
    const value = normalizeEnvValue(env[name]);
    readiness[name] = { present: typeof value === 'string' && value.length > 0, valid: typeof value === 'string' && check(value) };
  }
  // Only presence/syntax leaves this boundary. No credential values are retained.
  return Object.freeze({ mode, wfcOrigin, instanceId, port, host, publicOrigin: origin.origin,
    dataDirectory: path.resolve(env.PREPARER_DATA_DIR), workDirectory: path.resolve(env.PREPARER_WORK_DIR),
    outputDirectory: path.resolve(env.PREPARER_OUTPUT_DIR), packageModulePath: path.resolve(env.PREPARER_PACKAGE_MODULE),
    sdkDirectory: env.PREPARER_SDK_DIR ? path.resolve(env.PREPARER_SDK_DIR) : null,
    importRoot: env.PREPARER_IMPORT_ROOT ? path.resolve(env.PREPARER_IMPORT_ROOT) : null,
    sourceRoot: env.PREPARER_SOURCE_ROOT ? path.resolve(env.PREPARER_SOURCE_ROOT) : null,
    proofPath: env.PREPARER_PRICE_PROOF_PATH || null, proofSha256: env.PREPARER_PRICE_PROOF_SHA256 || null,
    signingKeyPath: env.PREPARER_PRICE_SIGNING_KEY_PATH || null,
    liveReuseOnly: wfcOrigin ? false : env.PREPARER_LIVE_REUSE_ONLY !== 'false',
    configuration: Object.freeze(readiness),
  });
}
export function normalizeEnvValue(value) {
  if (typeof value !== 'string') return value;
  value = value.trim();
  if (value.length >= 2 && ['"', "'"].includes(value[0]) && value.at(-1) === value[0]) return value.slice(1, -1);
  return value.replace(/\s+#.*$/, '').trim();
}
export function loadPrivateAPSConfiguration(env = process.env) {
  const values = {};
  for (const [field, name] of Object.entries({ clientId: 'APS_CLIENT_ID', clientSecret: 'APS_CLIENT_SECRET', region: 'APS_REGION', bucket: 'APS_BUCKET' })) values[field] = normalizeEnvValue(env[name]);
  return Object.freeze(values);
}
