/** Exact installation configuration proof. Never include private values in an
 * exception or receipt; this module performs no I/O or environment mutation. */
export const PRODUCER_ENVIRONMENT_KEYS = Object.freeze([
  'PF_PRODUCER_CONTROL_KEY', 'PF_PRODUCER_OWNER', 'PF_PRODUCER_PROJECT', 'PF_PRODUCER_IMAGE',
  'PF_PRODUCER_RUNTIME_SHA256', 'PF_PRODUCER_QUALIFICATION_SHA256', 'PF_PRODUCER_QUALIFY_PROJECT',
]);
const fields = Object.freeze(['key', 'owner', 'project', 'image', 'runtimeInventorySha256', 'expectedSha256', 'qualifyProject']);
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$(?![\s\S])/;
const hash = /^[a-f0-9]{64}$(?![\s\S])/;
const plain = value => value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
const fail = code => { throw Object.assign(new Error(code), { code }); };
function expected(producer) {
  if (producer === undefined || producer === null) return Object.fromEntries(PRODUCER_ENVIRONMENT_KEYS.map(key => [key, '']));
  if (!plain(producer) || Object.keys(producer).some(key => !fields.includes(key)) ||
    !hash.test(producer.key ?? '') || !uuid.test(producer.owner ?? '') || !/^wfc-pathfinder-local-[a-f0-9]{12}$(?![\s\S])/.test(producer.project ?? '') ||
    !/^sha256:[a-f0-9]{64}$(?![\s\S])/.test(producer.image ?? '') || !hash.test(producer.runtimeInventorySha256 ?? '') ||
    producer.expectedSha256 !== undefined && !hash.test(producer.expectedSha256) || producer.qualifyProject !== undefined && !uuid.test(producer.qualifyProject)) fail('PF_PRODUCER_CONFIG_INVALID');
  return Object.fromEntries(PRODUCER_ENVIRONMENT_KEYS.map((key, index) => [key, producer[fields[index]] ?? '']));
}
export function assertProducerEnvironment(environment, producer) {
  const wanted = expected(producer), entries = Array.isArray(environment) ? environment : plain(environment) ? Object.entries(environment) : null;
  if (!entries || entries.length > 1024) fail('PF_PRODUCER_ENVIRONMENT_CHANGED');
  const actual = new Map(); let bytes = 0;
  for (const entry of entries) {
    let key, value;
    if (Array.isArray(environment)) {
      if (typeof entry !== 'string' || entry.length > 16384) fail('PF_PRODUCER_ENVIRONMENT_CHANGED');
      bytes += entry.length; const at = entry.indexOf('=');
      if (at < 1) fail('PF_PRODUCER_ENVIRONMENT_CHANGED');
      key = entry.slice(0, at); value = entry.slice(at + 1);
    } else {
      [key, value] = entry; bytes += key.length + (typeof value === 'string' ? value.length : 16);
    }
    if (bytes > 1024 * 1024) fail('PF_PRODUCER_ENVIRONMENT_CHANGED');
    if (!key.startsWith('PF_PRODUCER')) continue;
    if (!PRODUCER_ENVIRONMENT_KEYS.includes(key) || actual.has(key) || typeof value !== 'string') fail('PF_PRODUCER_ENVIRONMENT_CHANGED');
    actual.set(key, value);
  }
  if (actual.size !== PRODUCER_ENVIRONMENT_KEYS.length || PRODUCER_ENVIRONMENT_KEYS.some(key => actual.get(key) !== wanted[key])) fail('PF_PRODUCER_ENVIRONMENT_CHANGED');
  return Object.freeze({ status: 'PASS', configured: producer !== undefined && producer !== null, variablesChecked: PRODUCER_ENVIRONMENT_KEYS.length });
}
