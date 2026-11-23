import assert from 'node:assert/strict';
import test from 'node:test';
import { ANALYSIS_SCHEMA, validateManifest, validateAnalysis, analysisCacheKey } from '../lib/evidence.mjs';

const projectId = '11111111-1111-4111-8111-111111111111';
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE1cAAAAASUVORK5CYII=';
const clone = value => structuredClone(value);
function fixtures() {
  const manifest = { schemaVersion: 'wfc.ai.document-manifest.v1', projectId, documents: [{ id: 'pid', sha256: 'a'.repeat(64),
    pages: [{ page: 1, text: '15-PTC4005 belongs to pump 15-P4005', width: 100, height: 100 }] }] };
  const evidence = quote => ({ documentId: 'pid', page: 1, basis: 'local-text', quote, bbox: null });
  const analysis = { schemaVersion: 'wfc.ai.document-analysis.v1', projectId,
    coverage: [{ documentId: 'pid', page: 1, status: 'analyzed', reason: '' }],
    entities: [{ id: 'ptc', tag: '15-PTC4005', kind: 'signal', evidence: [evidence('15-PTC4005')] },
      { id: 'pump', tag: '15-P4005', kind: 'equipment', evidence: [evidence('15-P4005')] }],
    relations: [{ fromEntityId: 'ptc', toEntityId: 'pump', type: 'ptc-of', status: 'supported', evidence: [evidence('15-PTC4005 belongs to pump 15-P4005')] }], unresolved: [] };
  return { manifest, analysis };
}
const rejects = (mutate, code) => {
  const data = fixtures(); mutate(data);
  assert.throws(() => validateAnalysis(data.analysis, data.manifest), code ? { code } : undefined);
};

test('valid supplied text analysis returns original data, not engineering acceptance', () => {
  const { manifest, analysis } = fixtures();
  assert.equal(validateManifest(manifest), manifest); assert.equal(validateAnalysis(analysis, manifest), analysis);
  assert.equal(Object.hasOwn(analysis, 'engineeringAccepted'), false);
});
test('normalized whitespace and NFC quotes are source-backed', () => {
  const { manifest, analysis } = fixtures(); manifest.documents[0].pages[0].text += ' cafe\u0301\n label';
  analysis.unresolved.push({ reason: 'example', evidence: [{ documentId: 'pid', page: 1, basis: 'local-text', quote: 'café label', bbox: [0, 0, 20, 20] }] });
  validateAnalysis(analysis, manifest);
});
test('rejects hallucinated text quote', () => rejects(x => { x.analysis.entities[0].evidence[0].quote = 'imaginary'; }, 'ANALYSIS_QUOTE_NOT_FOUND'));
test('rejects phantom page and document', () => {
  rejects(x => { x.analysis.entities[0].evidence[0].page = 9; }, 'ANALYSIS_SOURCE_NOT_FOUND');
  rejects(x => { x.analysis.entities[0].evidence[0].documentId = 'other'; }, 'ANALYSIS_SOURCE_NOT_FOUND');
});
test('rejects cross-project output', () => rejects(x => { x.analysis.projectId = '22222222-2222-4222-8222-222222222222'; }, 'ANALYSIS_SCOPE_MISMATCH'));
test('rejects incomplete, duplicate and invented coverage', () => {
  rejects(x => { x.manifest.documents[0].pages.push({ ...x.manifest.documents[0].pages[0], page: 2 }); }, 'ANALYSIS_COVERAGE_INCOMPLETE');
  rejects(x => { x.analysis.coverage.push(clone(x.analysis.coverage[0])); }, 'ANALYSIS_COVERAGE_INVALID');
  rejects(x => { x.analysis.coverage[0].page = 2; }, 'ANALYSIS_COVERAGE_INVALID');
});
test('rejects duplicate entities and relations, phantom targets and unsupported unknown edges', () => {
  rejects(x => { x.analysis.entities.push(clone(x.analysis.entities[0])); }, 'ANALYSIS_DUPLICATE_ENTITY');
  rejects(x => { x.analysis.relations.push(clone(x.analysis.relations[0])); }, 'ANALYSIS_DUPLICATE_RELATION');
  rejects(x => { x.analysis.relations[0].toEntityId = 'absent'; }, 'ANALYSIS_ENTITY_NOT_FOUND');
  rejects(x => { x.analysis.relations[0].type = 'unknown'; }, 'ANALYSIS_UNSUPPORTED_RELATION');
  rejects(x => { x.analysis.relations[0].evidence = []; });
});
test('rejects invalid, outside-page, nonfinite and reversed bounding boxes', () => {
  for (const bbox of [[0, 0, 101, 10], [20, 0, 10, 10], [0, 0, Infinity, 1], [0, 0, 10]]) rejects(x => { x.analysis.entities[0].evidence[0].bbox = bbox; });
});
test('unreadable page cannot claim supported relation and requires reason', () => {
  rejects(x => { x.analysis.coverage[0].status = 'unreadable'; x.analysis.coverage[0].reason = 'blurred'; }, 'ANALYSIS_UNREADABLE_SOURCE');
  rejects(x => { x.analysis.coverage[0].status = 'unreadable'; });
});
test('strict manifest rejects duplicate docs/pages, unknown fields, oversized text and excess total pages', () => {
  for (const mutate of [m => m.documents.push(clone(m.documents[0])), m => m.documents[0].pages.push(clone(m.documents[0].pages[0])),
    m => { m.untrusted = true; }, m => { m.documents[0].pages[0].text = 'x'.repeat(250001); },
    m => { m.documents[0].pages = Array.from({ length: 257 }, (_, i) => ({ ...m.documents[0].pages[0], page: i + 1 })); }]) {
    const { manifest } = fixtures(); mutate(manifest); assert.throws(() => validateManifest(manifest));
  }
});
test('rejects prototype keys, getters and extra response fields without executing getters', () => {
  rejects(x => { x.analysis.entities[0].evidence[0].unexpected = 1; });
  rejects(x => { x.analysis.unresolved.push(JSON.parse('{"reason":"x","evidence":[],"__proto__":{}}')); });
  const { manifest } = fixtures(); let invoked = false;
  Object.defineProperty(manifest, 'extra', { enumerable: true, get() { invoked = true; return 1; } });
  assert.throws(() => validateManifest(manifest)); assert.equal(invoked, false);
});
test('canonical cache key changes for every source/config scope and preserves property-order equality', () => {
  const { manifest } = fixtures(); const input = { manifest, model: 'test-model', promptVersion: 'p1', schemaVersion: 's1' };
  const key = analysisCacheKey(input); assert.match(key, /^[a-f0-9]{64}$/);
  assert.equal(key, analysisCacheKey({ schemaVersion: 's1', promptVersion: 'p1', model: 'test-model', manifest }));
  for (const field of ['model', 'promptVersion', 'schemaVersion', 'parserVersion']) assert.notEqual(key, analysisCacheKey({ ...input, [field]: 'changed' }));
  for (const mutate of [m => { m.projectId = '22222222-2222-4222-8222-222222222222'; }, m => { m.documents[0].sha256 = 'b'.repeat(64); },
    m => { m.documents[0].pages[0].text += ' changed'; }, m => { m.documents[0].pages[0].width = 101; }]) {
    const next = clone(manifest); mutate(next); assert.notEqual(key, analysisCacheKey({ ...input, manifest: next }));
  }
});
test('all OpenAI object schemas are strict and every property required', () => {
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'object') { assert.equal(node.additionalProperties, false); assert.deepEqual(node.required, Object.keys(node.properties)); }
    for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(walk); else if (typeof value === 'object') walk(value);
  }
  walk(ANALYSIS_SCHEMA);
});
test('image-only split-label signals remain four consumers pointing to one pump with auditable visual regions', () => {
  const { manifest, analysis } = fixtures(); const page = manifest.documents[0].pages[0]; page.text = ''; page.imageDataUrl = png;
  const visual = (quote, bbox) => ({ documentId: 'pid', page: 1, basis: 'visual-observation', quote, bbox });
  const signals = ['15-MS', '15-PTC', '15-SC01', '15-M'];
  analysis.entities = signals.map((prefix, i) => ({ id: 'signal-' + i, tag: prefix + '4005', kind: 'signal',
    evidence: [visual(prefix, [i * 10, 0, i * 10 + 9, 9]), visual('4005', [i * 10, 10, i * 10 + 9, 19])] }));
  analysis.entities.push({ id: 'pump', tag: '15-P4005', kind: 'equipment', evidence: [visual('15-P4005', [0, 40, 30, 60])] });
  analysis.relations = signals.map((_, i) => ({ fromEntityId: 'signal-' + i, toEntityId: 'pump', type: i === 1 ? 'ptc-of' : 'signal-of',
    status: 'supported', evidence: [visual('', [0, 0, 50, 60])] }));
  assert.equal(validateAnalysis(analysis, manifest), analysis);
  assert.equal(analysis.entities.length, 5); assert.equal(analysis.relations.length, 4);
  assert.equal(analysis.entities[0].evidence[0].basis, 'visual-observation');
  assert.notEqual(analysisCacheKey({ manifest, model: 'm', promptVersion: 'p', schemaVersion: 's' }),
    analysisCacheKey({ manifest: fixtures().manifest, model: 'm', promptVersion: 'p', schemaVersion: 's' }));
});
test('visual observations require supplied image and bbox; cannot impersonate verified local OCR', () => {
  rejects(x => { Object.assign(x.analysis.entities[0].evidence[0], { basis: 'visual-observation', bbox: [0, 0, 10, 10] }); }, 'ANALYSIS_VISUAL_SOURCE_REQUIRED');
  rejects(x => { x.manifest.documents[0].pages[0].imageDataUrl = png; x.analysis.entities[0].evidence[0].basis = 'visual-observation'; }, 'ANALYSIS_VISUAL_SOURCE_REQUIRED');
  rejects(x => { x.manifest.documents[0].pages[0].text = ''; x.manifest.documents[0].pages[0].imageDataUrl = png; }, 'ANALYSIS_QUOTE_NOT_FOUND');
});
test('manifest image checks reject invalid media types, base64 and magic bytes', () => {
  for (const imageDataUrl of ['https://example.org/private.png', 'data:image/gif;base64,R0lGODlh', 'data:image/png;base64,AAAA', png + '\n']) {
    const { manifest } = fixtures(); manifest.documents[0].pages[0].imageDataUrl = imageDataUrl;
    assert.throws(() => validateManifest(manifest), { code: 'MANIFEST_IMAGE_INVALID' });
  }
});
