// Pure, deliberately narrow contract for the qualified 5192 -> 5191 delivery.
import path from 'node:path';
import { createHash } from 'node:crypto';
const SHA = /^[a-f0-9]{64}$(?![\s\S])/, IMAGE = /^sha256:[a-f0-9]{64}$(?![\s\S])/;
const need = (value, code) => { if (!value) throw Object.assign(Error(code), { code }); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export const imageInstallDigest = value => createHash('sha256').update(value).digest('hex');
export function prepareRuntimeImageInstall({ root, source, candidate, options, sourceStateBytes, sourceEnvBytes,
  candidateStateBytes, candidateEnvBytes, resources, inspectedImages }) {
  need(options && Object.keys(options).sort().join() === ['expectedStateSha256','expectedEnvSha256','images','candidate','operationId',
    'expectedCandidateStateSha256','expectedCandidateEnvSha256'].sort().join(), 'PF_IMAGE_INSTALL_ARGUMENTS');
  for (const key of ['expectedStateSha256','expectedEnvSha256','expectedCandidateStateSha256','expectedCandidateEnvSha256'])
    need(SHA.test(options[key]), 'PF_IMAGE_INSTALL_PINS_REQUIRED');
  need(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$(?![\s\S])/.test(options.operationId), 'PF_IMAGE_INSTALL_OPERATION_REQUIRED');
  need(source.owner === '8fffd6b8-c896-4bb0-ad92-b6c82f5a7d46' && source.project === 'wfc-pathfinder-local-0cba87606e9b'
    && source.port === 5191 && source.runtime === path.join(root, 'pathfinder-engine/.scratch/batched-capture-runtime-20261018-1600'),
  'PF_IMAGE_INSTALL_EXACT_SOURCE_REQUIRED');
  need(options.candidate && Object.keys(options.candidate).sort().join() === 'owner,port,project,runtime'
    && options.candidate.port === 5192 && candidate.port === 5192
    && ['owner','project','runtime','port'].every(key => candidate[key] === options.candidate[key])
    && ['', '20261021-'].some(prefix=>candidate.runtime === path.join(root,'pathfinder-engine/.scratch','barrier-delivery-'+prefix+options.operationId,'restore-5192'))
    && candidate.owner !== source.owner && candidate.project !== source.project && candidate.runtime !== source.runtime,
  'PF_IMAGE_INSTALL_CANDIDATE_REQUIRED');
  need(options.images && Object.keys(options.images).sort().join() === 'api,web'
    && ['api','web'].every(role => IMAGE.test(options.images[role]) && candidate.images?.[role] === options.images[role])
    && options.images.api !== options.images.web, 'PF_IMAGE_INSTALL_IMAGE_ID_REQUIRED');
  need(imageInstallDigest(sourceStateBytes) === options.expectedStateSha256 && imageInstallDigest(sourceEnvBytes) === options.expectedEnvSha256
    && imageInstallDigest(candidateStateBytes) === options.expectedCandidateStateSha256
    && imageInstallDigest(candidateEnvBytes) === options.expectedCandidateEnvSha256, 'PF_IMAGE_INSTALL_CAS_CHANGED');
  need(same(JSON.parse(sourceStateBytes),source) && same(JSON.parse(candidateStateBytes),candidate)
    && source.envSha256 === options.expectedEnvSha256 && candidate.envSha256 === options.expectedCandidateEnvSha256,
  'PF_IMAGE_INSTALL_STATE_CHANGED');
  need(Array.isArray(resources?.containers) && ['api','web'].every(role => {
    const entries = resources.containers.filter(item => item.role === role);
    return entries.length === 1 && entries[0].running === false && entries[0].image === source.images?.[role];
  }), 'PF_IMAGE_INSTALL_SOURCE_MUST_BE_STOPPED');
  need(Array.isArray(inspectedImages) && inspectedImages.length === 2 && ['api','web'].every(role => {
    const entries = inspectedImages.filter(item => item.Id === options.images[role]);
    return entries.length === 1 && entries[0].Config?.Labels?.['wfc.pathfinder.owner'] === candidate.owner
      && entries[0].Config?.Labels?.['wfc.pathfinder.project'] === candidate.project;
  }), 'PF_IMAGE_INSTALL_LABELS_CHANGED');
  let text = new TextDecoder('utf-8',{fatal:true}).decode(sourceEnvBytes);
  for (const role of ['api','web']) {
    const key = role === 'api' ? 'PF_API_IMAGE' : 'PF_WEB_IMAGE';
    const expression = new RegExp('^'+key+'=([^\\r\\n]*)$', 'gm');
    const matches = [...text.matchAll(expression)];
    need(matches.length === 1 && matches[0][1] === source.images[role], 'PF_IMAGE_INSTALL_ENV_IMAGE_CHANGED');
    text = text.replace(expression, key+'='+options.images[role]);
  }
  const nextState = { ...source, images: { ...source.images,...options.images }, envSha256: imageInstallDigest(text) };
  return { state: nextState, envBytes: Buffer.from(text), stateBytes: Buffer.from(JSON.stringify(nextState,null,2)+'\n') };
}
