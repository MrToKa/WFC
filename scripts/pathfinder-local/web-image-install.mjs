// Pure plan for this frontend repair. It neither writes files nor touches Docker.
import path from 'node:path';
import { createHash } from 'node:crypto';

const SHA = /^[a-f0-9]{64}$(?![\s\S])/;
const IMAGE = /^sha256:[a-f0-9]{64}$(?![\s\S])/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$(?![\s\S])/;
export const WEB_INSTALL_BASELINE = Object.freeze({
  owner: '8fffd6b8-c896-4bb0-ad92-b6c82f5a7d46',
  project: 'wfc-pathfinder-local-0cba87606e9b',
  port: 5191,
  api: 'sha256:ac0d16ab1b0f4c92922c20d1a13a5ea142d4c6e92558de1870daf4db7fd60fcf',
  web: 'sha256:a0e6972c41356185cefc12a5781995a71820e5298ebb405ed34dc59a79270529',
});

const need = (value, code) => {
  if (!value) throw Object.assign(Error(code), { code });
};
export const webImageInstallDigest = bytes => createHash('sha256').update(bytes).digest('hex');
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);

export function prepareWebImageInstall(input) {
  need(input && Object.getPrototypeOf(input) === Object.prototype
    && Object.keys(input).sort().join() === [
      'root', 'source', 'sourceStateBytes', 'sourceEnvBytes',
      'expectedStateSha256', 'expectedEnvSha256', 'webImage',
      'inspectedImage', 'resources', 'operationId',
    ].sort().join(), 'PF_WEB_INSTALL_ARGUMENTS');
  const { root, source, sourceStateBytes, sourceEnvBytes, expectedStateSha256,
    expectedEnvSha256, webImage, inspectedImage, resources, operationId } = input;

  need(typeof root === 'string' && path.isAbsolute(root) && root === path.resolve(root)
    && source?.format === 'WFC-PF-LOCAL' && source.schemaVersion === 1
    && source.root === root && source.owner === WEB_INSTALL_BASELINE.owner
    && source.project === WEB_INSTALL_BASELINE.project && source.port === WEB_INSTALL_BASELINE.port
    && source.runtime === path.join(root, 'pathfinder-engine/.scratch/batched-capture-runtime-20261018-1600'),
  'PF_WEB_INSTALL_EXACT_SOURCE_REQUIRED');
  need(source.images?.api === WEB_INSTALL_BASELINE.api && source.images?.web === WEB_INSTALL_BASELINE.web,
    'PF_WEB_INSTALL_BASELINE_IMAGES_REQUIRED');
  need(UUID.test(operationId ?? ''), 'PF_WEB_INSTALL_OPERATION_REQUIRED');
  need(SHA.test(expectedStateSha256 ?? '') && SHA.test(expectedEnvSha256 ?? ''), 'PF_WEB_INSTALL_PINS_REQUIRED');
  need(Buffer.isBuffer(sourceStateBytes) && sourceStateBytes.length <= 1024 ** 2
    && Buffer.isBuffer(sourceEnvBytes) && sourceEnvBytes.length <= 65536,
  'PF_WEB_INSTALL_SOURCE_BYTES_REQUIRED');
  need(webImageInstallDigest(sourceStateBytes) === expectedStateSha256
    && webImageInstallDigest(sourceEnvBytes) === expectedEnvSha256,
  'PF_WEB_INSTALL_CAS_CHANGED');
  // runtime.env is emitted as canonical LF UTF-8. Refuse alternate encodings so
  // TextDecoder cannot silently discard a BOM while planning a one-value edit.
  need(!sourceEnvBytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))
    && !sourceEnvBytes.includes(0x0d), 'PF_WEB_INSTALL_SOURCE_ENCODING');

  let decodedState, text;
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    decodedState = JSON.parse(decoder.decode(sourceStateBytes));
    text = decoder.decode(sourceEnvBytes);
  } catch { need(false, 'PF_WEB_INSTALL_SOURCE_ENCODING'); }
  need(equal(decodedState, source) && source.envSha256 === expectedEnvSha256,
    'PF_WEB_INSTALL_STATE_CHANGED');

  need(IMAGE.test(webImage ?? '') && webImage !== WEB_INSTALL_BASELINE.web
    && webImage !== WEB_INSTALL_BASELINE.api && inspectedImage?.Id === webImage
    && inspectedImage.Os === 'linux' && inspectedImage.Architecture === 'amd64'
    && inspectedImage.Config?.Labels?.['wfc.pathfinder.owner'] === source.owner
    && inspectedImage.Config.Labels['wfc.pathfinder.project'] === source.project,
  'PF_WEB_INSTALL_CANDIDATE_REQUIRED');
  need(Array.isArray(resources?.containers), 'PF_WEB_INSTALL_RESOURCE_REQUIRED');
  for (const role of ['api', 'web']) {
    const entries = resources.containers.filter(row => row.role === role);
    need(entries.length === 1 && SHA.test(entries[0].id ?? '')
      && entries[0].image === WEB_INSTALL_BASELINE[role]
      && entries[0].running === (role === 'api'),
    'PF_WEB_INSTALL_SERVICE_STATE_CHANGED');
  }

  const readEnv = key => {
    const matches = [...text.matchAll(new RegExp('^' + key + '=([^\\r\\n]*)$', 'gm'))];
    need(matches.length === 1, 'PF_WEB_INSTALL_ENV_BINDING_CHANGED');
    return matches[0][1];
  };
  need(readEnv('PF_OWNER') === source.owner && readEnv('PF_PROJECT') === source.project
    && readEnv('PF_HTTP_PORT') === String(source.port)
    && readEnv('PF_API_IMAGE') === WEB_INSTALL_BASELINE.api
    && readEnv('PF_WEB_IMAGE') === WEB_INSTALL_BASELINE.web,
  'PF_WEB_INSTALL_ENV_BINDING_CHANGED');
  // Preserve the original private file byte-for-byte except this single value.
  const envBytes = Buffer.from(text.replace(/^PF_WEB_IMAGE=[^\r\n]*$/m, 'PF_WEB_IMAGE=' + webImage));
  const state = { ...source, images: { ...source.images, web: webImage }, envSha256: webImageInstallDigest(envBytes) };
  return { state, envBytes, stateBytes: Buffer.from(JSON.stringify(state, null, 2) + '\n') };
}
