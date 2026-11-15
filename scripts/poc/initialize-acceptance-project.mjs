import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { login, api, json, saveState } from './poc-client.mjs';

const fingerprint = 'b5bb4fbe666b440c73bb1ffd2ee0db01be66146f8002e4a9df8dce8521db1d34';
const archiveSha256 = 'e3056f28efaa57eef65f81dbdfe41396d9e010bdc975738d1259c58af6c3a922';
const packagePath = process.argv[2];
if (!packagePath) throw new Error('Supply the verified original Aalborg SVF ZIP path.');
const identity = await login({ create: true });
const { projects } = await (await api(identity.token, '/api/projects')).json();
let project = projects.find(item => item.projectNumber === 'AALBORG-STEP-POC');
if (!project) ({ project } = await (await api(identity.token, '/api/projects', json('POST', {
  projectNumber: 'AALBORG-STEP-POC', name: 'HPU Aalborg 2023 · STEP PoC', customer: 'Isolated validation',
  description: 'Independent PoC. Original verified SVF imported normally; no source users or sessions copied.',
}))).json());
const route = `/api/projects/${project.id}`;
let versions = await (await api(identity.token, route + '/model-versions')).json();
let version = versions.versions.find(item => item.contentFingerprint === fingerprint && item.state === 'ready' && item.health === 'healthy');
if (!version) {
  const stat = await fs.stat(packagePath);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(packagePath)) hash.update(chunk);
  if (stat.size !== 439112840 || hash.digest('hex') !== archiveSha256) throw new Error('Aalborg package does not match the verified source.');
  const imported = await (await api(identity.token, route + '/model-imports', {
    method: 'POST', headers: { 'Content-Type': 'application/zip', 'Content-Length': String(stat.size),
      'Idempotency-Key': randomUUID(), 'X-Package-SHA256': archiveSha256 },
    body: createReadStream(packagePath), duplex: 'half', signal: AbortSignal.timeout(900000),
  })).json();
  console.log(JSON.stringify({ stage: 'import-accepted', projectId: project.id, importId: imported.importId }));
  for (let attempt = 0; attempt < 180; attempt++) {
    const result = await (await api(identity.token, route + '/model-imports/' + imported.importId)).json();
    if (result.job.state === 'failed') throw new Error('Model import failed: ' + result.job.failure?.code);
    if (result.job.state === 'complete') break;
    if (attempt === 179) throw new Error('Model import did not finish within acceptance polling budget.');
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  versions = await (await api(identity.token, route + '/model-versions')).json();
  version = versions.versions.find(item => item.contentFingerprint === fingerprint && item.state === 'ready' && item.health === 'healthy');
}
if (!version) throw new Error('Verified ready Aalborg version is missing.');
const selection = versions.selection;
if (selection?.activeModelVersionId !== version.id) {
  await api(identity.token, route + '/active-model', json('PATCH', {
    modelVersionId: version.id, expectedSelectionRevision: selection?.selectionRevision ?? 0,
  }));
}
const state = { projectId: project.id, modelVersionId: version.id, adminId: identity.user.id,
  fingerprint, archiveSha256, projectName: project.name };
await saveState(state);
console.log(JSON.stringify({ status: 'PASS', ...state }));
