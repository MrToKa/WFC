import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ROOT, contained } from '../pathfinder-local/runtime-lib.mjs';
import { assertCanonicalPath, hashFile } from '../operations/archives.mjs';
import { writePrivateJson } from '../operations/docker.mjs';
import { SOURCE, refuse } from './binding.mjs';
import { sha, assertNoAuth, validateChain } from './provenance-lib.mjs';
const need = (v, code) => { if (!v) refuse(code); }, rel = f => path.relative(ROOT, f).replaceAll('\\', '/');
const scratch = path.join(ROOT, 'pathfinder-engine/.scratch'), evidence = path.join(ROOT, 'docs/pathfinder/evidence/copied-recovery');
const journalDir = 'pathfinder-engine/.scratch/copied-import-cec74539-2706-4833-b86b-9e3fd11d6469';
const pins = [
  ['source', 'pathfinder-engine/.scratch/current-inputs-2b20a8ae-a435-4d4d-aec4-005bb021a715/current-inputs.private.json', '0a84d1327950d4bd1d8420661f526cf1c97fdec5dbaaca71c429bf3e0c3bd897'],
  ['source-receipt', 'docs/pathfinder/evidence/current-inputs/source-copy-fullname-20261018T1533Z.json', 'a1c9e90a2c48e9da4d619cc3a4d5a90c1a9c2ae2c4b91fc99c9d396f5aba2c02'],
  ['plan', 'pathfinder-engine/.scratch/copied-project-seed-20261018-1710/plan.private.json', '3ac537e097ce4eec007bc2604c0c9338a9bfb0ecad81f3af70a71100b18d0b0d'],
  ['seed-receipt', 'docs/pathfinder/evidence/copied-project/seed-1792343294599-9df304d0.json', 'c3b236a265c557d79ff13774972f263a5ad28943ce32181e363a9be10abb1718'],
  ['import-receipt', 'docs/pathfinder/evidence/copied-project/import-1792343839359-a5edb878-4114-4f5f-b05b-f392c58af9cb.json', 'a244261e315ce842892a13b7b69d34f7fa1b8c527aeee5d05cd39f95356cf7f8'],
  ['capture-provenance', 'docs/pathfinder/evidence/copied-project/actual-observation-20261018.json', null],
  ['import-intent', journalDir + '/intent.private.json', '5bc7c593ecebca1866087ffec99b7fb661b2305e9c509dd19736bb533630f91b'],
  ['import-owner', journalDir + '/owner.private.json', null],
  ...Array.from({ length: 67 }, (_, i) => ['import-event', journalDir + '/event-' + String(i).padStart(4, '0') + '.private.json', null]),
];
async function read(file, bound = 4 * 1024 ** 2) {
  await assertCanonicalPath(file); const s = await fs.stat(file); need(s.isFile() && s.nlink === 1 && s.size > 0 && s.size <= bound, 'PROVENANCE_FILE_BOUND');
  const bytes = await fs.readFile(file); need(bytes.length === s.size, 'PROVENANCE_FILE_CHANGED'); return bytes;
}
function validateContents(items) {
  const byRole = role => items.find(x => x.role === role), json = role => JSON.parse(byRole(role).raw);
  for (const item of items) assertNoAuth(JSON.parse(item.raw));
  const imported = json('import-receipt'), seed = json('seed-receipt'), capture = json('capture-provenance'), intent = json('import-intent'), owner = json('import-owner');
  need(seed.status === 'PASS' && imported.status === 'PASS' && imported.projectId === SOURCE.projectId && imported.result.modelVersionId === SOURCE.modelVersionId && imported.target.owner === SOURCE.owner && seed.target.owner === SOURCE.owner, 'PROVENANCE_RECEIPT_SCOPE');
  need(intent.projectId === SOURCE.projectId && intent.planSha256 === byRole('plan').sha256 && owner.owner === SOURCE.owner && owner.projectId === SOURCE.projectId, 'PROVENANCE_INTENT_SCOPE');
  need(capture.status === 'PASS' && capture.projectId === SOURCE.projectId && capture.modelVersionId === SOURCE.modelVersionId && capture.artifact.id === '9723d683-96d2-48cd-814a-f2de5a0be8f6' && capture.artifact.capture.inputScope.equipmentNameCount === 1527 && capture.artifact.engineeringAccepted === false, 'PROVENANCE_CAPTURE_SCOPE');
  return validateChain(byRole('import-intent').raw, items.filter(x => x.role === 'import-event').map(x => ({ name: path.basename(x.source), bytes: x.raw })), journalDir, imported.privateJournal);
}
const receipt = { schemaVersion: 'pathfinder.copied-recovery.provenance-receipt.v1', status: 'FAIL', startedAt: new Date().toISOString() };
try {
  const { values, positionals } = parseArgs({ strict: true, allowPositionals: true, options: { work: { type: 'string' } } }); const mode = positionals[0]; receipt.mode = mode;
  need(positionals.length === 1 && ['prepare', 'seal', 'verify'].includes(mode), 'PROVENANCE_MODE');
  const work = path.resolve(ROOT, values.work ?? ''); need(contained(scratch, work) && /^copied-recovery-[a-f0-9-]{36}$/.test(path.basename(work)), 'PROVENANCE_WORK');
  const record = JSON.parse(await read(path.join(work, 'drill.private.json'))), owner = JSON.parse(await read(path.join(work, 'owner.json')));
  need(record.schemaVersion === 'pathfinder.copied-recovery.drill-private.v1' && owner.id === record.id && owner.work === work && owner.format === 'PF-COPIED-RECOVERY' && record.source.owner === SOURCE.owner && path.resolve(record.source.runtime) === path.join(ROOT, SOURCE.runtime), 'PROVENANCE_OWNER');
  receipt.drillId = record.id; const dir = path.join(work, 'provenance'), manifestFile = path.join(dir, 'manifest.private.json'); let manifest, items = [];
  if (mode === 'prepare') {
    need(record.phase === 'planned', 'PROVENANCE_PHASE'); await assertCanonicalPath(dir, { directory: true, allowMissing: true }); await fs.mkdir(dir, { mode: 0o700 });
    if (process.platform === 'win32') await promisify(execFile)('icacls', [dir, '/inheritance:r', '/grant:r', process.env.USERDOMAIN + '\\' + process.env.USERNAME + ':(OI)(CI)(F)'], { windowsHide: true, timeout: 5000, maxBuffer: 8192 });
    for (let i = 0; i < pins.length; i++) {
      const [role, source, pin] = pins[i], raw = await read(path.join(ROOT, source)); need(!pin || sha(raw) === pin, 'PROVENANCE_SOURCE_PIN');
      const item = { role, source, file: String(i).padStart(3, '0') + '.private.json', bytes: raw.length, sha256: sha(raw), raw }; items.push(item);
    }
    receipt.chain = validateContents(items);
    for (const item of items) { const file = path.join(dir, item.file); await fs.writeFile(file, item.raw, { flag: 'wx', mode: 0o600 }); need((await hashFile(file)).sha256 === item.sha256, 'PROVENANCE_COPY_READBACK'); }
    manifest = { schemaVersion: 'pathfinder.copied-recovery.provenance-private.v1', drillId: record.id, sourceOwner: SOURCE.owner, projectId: SOURCE.projectId, modelVersionId: SOURCE.modelVersionId, files: items.map(({ raw, ...item }) => item), retainedPackage: { path: 'pathfinder-engine/.scratch/pathfinder-local/aalborg-portable.zip', bytes: 439112840, sha256: 'e3056f28efaa57eef65f81dbdfe41396d9e010bdc975738d1259c58af6c3a922', copiedIntoAdjunct: false } };
    await writePrivateJson(manifestFile, manifest);
  } else {
    manifest = JSON.parse(await read(manifestFile)); need(manifest.schemaVersion === 'pathfinder.copied-recovery.provenance-private.v1' && manifest.drillId === record.id && manifest.sourceOwner === SOURCE.owner && manifest.files?.length === pins.length, 'PROVENANCE_MANIFEST');
    for (let i = 0; i < pins.length; i++) {
      const item = manifest.files[i], [role, source, pin] = pins[i]; need(item.role === role && item.source === source && item.file === String(i).padStart(3, '0') + '.private.json' && (!pin || item.sha256 === pin), 'PROVENANCE_MEMBER_SCOPE');
      const raw = await read(path.join(dir, item.file)); need(raw.length === item.bytes && sha(raw) === item.sha256, 'PROVENANCE_MEMBER_HASH'); items.push({ ...item, raw });
    }
    receipt.chain = validateContents(items);
    need(['backup_complete', 'restore_started', 'restore_returned', 'restored', 'qualified', 'retirement_started', 'retired'].includes(record.phase) && /^[a-f0-9-]{36}$/.test(record.backupId ?? '') && record.backup === path.join(work, 'backup'), 'PROVENANCE_BACKUP_PHASE');
    const coreFile = path.join(record.backup, 'manifest.json'), coreBytes = await read(coreFile), core = JSON.parse(coreBytes), complete = JSON.parse(await read(path.join(record.backup, 'complete.json')));
    need(sha(coreBytes) === record.manifest.sha256 && coreBytes.length === record.manifest.bytes && core.backupId === record.backupId && core.sourceOwner === SOURCE.owner && core.sourceProject === SOURCE.project && core.files?.length === 8 && complete.backupId === record.backupId && complete.manifest.sha256 === sha(coreBytes), 'PROVENANCE_CORE_LINK');
    receipt.coreManifest = { path: rel(coreFile), bytes: coreBytes.length, sha256: sha(coreBytes) }; receipt.backupId = core.backupId;
    const seal = { schemaVersion: 'pathfinder.copied-recovery.provenance-seal.v1', drillId: record.id, backupId: record.backupId, coreManifest: receipt.coreManifest, adjunctManifest: { path: rel(manifestFile), ...await hashFile(manifestFile) }, files: manifest.files.length, chain: receipt.chain };
    const sealFile = path.join(dir, 'seal.private.json');
    if (mode === 'seal') await writePrivateJson(sealFile, seal);
    else need(JSON.stringify(JSON.parse(await read(sealFile))) === JSON.stringify(seal), 'PROVENANCE_SEAL_LINK');
    receipt.seal = { path: rel(sealFile), ...await hashFile(sealFile) };
  }
  receipt.adjunctManifest = { path: rel(manifestFile), ...await hashFile(manifestFile) }; receipt.files = manifest.files.length; receipt.totalBytes = manifest.files.reduce((n, v) => n + v.bytes, 0); receipt.authMaterialExcluded = true; receipt.rawModelBackupScope = 'Core archive, not this adjunct; actual raw resource proof is supplied separately by backup/restore audits.'; receipt.status = 'PASS';
} catch (error) { receipt.error = /^PROVENANCE_[A-Z_]+$/.test(error.code ?? '') ? error.code : 'PROVENANCE_FAILED'; receipt.recovery = 'Private partial adjunct retained; no runtime action or source mutation was attempted.'; }
receipt.finishedAt = new Date().toISOString(); await fs.mkdir(evidence, { recursive: true }); const file = path.join(evidence, 'provenance-' + Date.now() + '-' + randomUUID().slice(0, 8) + '.json'); await fs.writeFile(file, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' }); console.log(JSON.stringify({ status: receipt.status, mode: receipt.mode, file: rel(file), sha256: (await hashFile(file)).sha256, error: receipt.error })); process.exitCode = receipt.status === 'PASS' ? 0 : 1;
