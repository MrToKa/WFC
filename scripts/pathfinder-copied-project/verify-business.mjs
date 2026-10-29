import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { ROOT, contained } from '../pathfinder-local/runtime-lib.mjs';
import { writePrivateJson } from '../operations/docker.mjs';
import { assertCanonicalPath } from '../operations/archives.mjs';
import { EXPECTED, verifySeedInput, validateSeedPlan } from './seed-lib.mjs';

// Offline comparison of already captured lossless row strings. No database,
// credentials, model operation, bootstrap import or numeric business decoding.
const { values } = parseArgs({ strict: true, options: { before: { type: 'string' }, seeded: { type: 'string' }, after: { type: 'string' }, plan: { type: 'string' }, 'plan-sha256': { type: 'string' }, 'seed-receipt': { type: 'string' }, 'model-version': { type: 'string' } } });
const hash = b => createHash('sha256').update(b).digest('hex');
const receipt = { schemaVersion: 'pathfinder.copied-project.business-verification.v1', status: 'FAIL', recordedAt: new Date().toISOString(), checks: [] };
const work = path.join(ROOT, 'pathfinder-engine/.scratch/copied-business-verification-' + randomUUID()); await fs.mkdir(work);
await writePrivateJson(path.join(work, 'owner.json'), { format: 'PF-COPIED-BUSINESS-VERIFY', work, owner: EXPECTED.owner });
const check = (name, ok) => receipt.checks.push({ name, status: ok ? 'PASS' : 'FAIL' });
async function read(file, parent, limit) {
  const target = path.resolve(file); assert.ok(contained(parent, target)); await assertCanonicalPath(target);
  const stat = await fs.stat(target); assert.ok(stat.size > 0 && stat.size <= limit); const bytes = await fs.readFile(target); assert.equal(bytes.length, stat.size); return bytes;
}
async function capture(file) {
  const compact = JSON.parse(await read(file, path.join(ROOT, 'docs/pathfinder/evidence/batched-capture'), 131072));
  assert.equal(compact.status, 'PASS'); assert.equal(compact.schemaVersion, 'pathfinder.batched-capture.protected-business.v2'); assert.equal(compact.target.owner, EXPECTED.owner);
  const bytes = await read(path.resolve(ROOT, compact.raw.path), path.join(ROOT, 'pathfinder-engine/.scratch'), 32 * 1024 ** 2); assert.equal(hash(bytes), compact.raw.sha256);
  const groups = JSON.parse(bytes).groups; assert.deepEqual(Object.keys(groups).sort(), ['cables', 'projects', 'selections', 'types']);
  for (const rows of Object.values(groups)) assert.ok(rows.length <= 100000 && rows.every(r => typeof r.key === 'string' && typeof r.row_text === 'string') && new Set(rows.map(r => r.key)).size === rows.length);
  return { compact, groups };
}
try {
  const rawPlan = await read(values.plan, path.join(ROOT, 'pathfinder-engine/.scratch'), 2 * 1024 ** 2); assert.equal(hash(rawPlan), values['plan-sha256']);
  const source = verifySeedInput(await fs.readFile(path.join(ROOT, EXPECTED.snapshot.path)), await fs.readFile(path.join(ROOT, EXPECTED.receipt.path)));
  const plan = validateSeedPlan(JSON.parse(rawPlan), source), seed = JSON.parse(await read(values['seed-receipt'], path.join(ROOT, 'docs/pathfinder/evidence/copied-project'), 131072));
  assert.equal(seed.status, 'PASS'); assert.equal(seed.projectId, plan.newProject.id); assert.equal(seed.plan.sha256, values['plan-sha256']); assert.equal(seed.source.snapshotSha256, EXPECTED.snapshot.sha256); assert.equal(seed.target.owner, EXPECTED.owner);
  const before = await capture(values.before), seeded = await capture(values.seeded), details = {};
  const expected = { projects: [plan.newProject.id], types: plan.types.map(r => r.id), cables: plan.cables.map(r => r.id), selections: [plan.newProject.id] };
  for (const [name, rows] of Object.entries(before.groups)) {
    const current = new Map(seeded.groups[name].map(r => [r.key, r.row_text])), old = new Set(rows.map(r => r.key));
    const additions = seeded.groups[name].filter(r => !old.has(r.key)).map(r => r.key).sort();
    const changed = rows.filter(r => current.get(r.key) !== r.row_text);
    details[name] = { oldRowsChanged: changed, actualAddedIds: additions, expectedAddedIds: [...expected[name]].sort() };
    check('preexisting-' + name + '-exact', changed.length === 0);
    check('exact-new-' + name + '-identities', JSON.stringify(additions) === JSON.stringify([...expected[name]].sort()));
  }
  receipt.plan = { path: path.relative(ROOT, values.plan).replaceAll('\\', '/'), sha256: values['plan-sha256'] }; receipt.projectId = plan.newProject.id;
  receipt.seedCounts = Object.fromEntries(Object.entries(expected).map(([name, ids]) => [name, ids.length]));
  if (values.after) {
    assert.match(values['model-version'] ?? '', /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
    const after = await capture(values.after);
    for (const name of ['projects', 'types', 'cables']) {
      const current = new Map(after.groups[name].map(r => [r.key, r.row_text]));
      const changed = seeded.groups[name].filter(r => current.get(r.key) !== r.row_text);
      details[name].afterChanged = changed;
      check('all-seeded-' + name + '-exact-through-import-and-ui', changed.length === 0 && current.size === seeded.groups[name].length);
    }
    const selections = new Map(after.groups.selections.map(r => [r.key, r.row_text]));
    const oldChanged = before.groups.selections.filter(r => selections.get(r.key) !== r.row_text);
    const current = JSON.parse(selections.get(plan.newProject.id) ?? '{}');
    check('old-model-selections-exact', oldChanged.length === 0);
    check('only-expected-new-model-selected-once', selections.size === seeded.groups.selections.length && current.project_id === plan.newProject.id && current.active_model_version_id === values['model-version'] && current.selection_revision === 1);
    receipt.after = { path: values.after, raw: after.compact.raw }; details.afterSelections = { oldChanged, currentNew: selections.get(plan.newProject.id) };
  }
  receipt.before = { path: values.before, raw: before.compact.raw }; receipt.seeded = { path: values.seeded, raw: seeded.compact.raw };
  await writePrivateJson(path.join(work, 'comparison.private.json'), details);
  assert.ok(receipt.checks.every(r => r.status === 'PASS')); receipt.status = 'PASS';
} catch { receipt.error = 'COPIED_BUSINESS_VERIFICATION_FAILED'; }
receipt.privateWorkRoot = path.relative(ROOT, work).replaceAll('\\', '/');
const filename = path.join(ROOT, 'docs/pathfinder/evidence/copied-project/business-verification-' + Date.now() + '.json'); await fs.mkdir(path.dirname(filename), { recursive: true }); await fs.writeFile(filename, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ status: receipt.status, checks: receipt.checks.length, file: path.relative(ROOT, filename).replaceAll('\\', '/'), error: receipt.error })); process.exitCode = receipt.status === 'PASS' ? 0 : 1;
