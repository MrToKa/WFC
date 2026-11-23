import { createHash } from 'node:crypto';

const MANIFEST_VERSION = 'wfc.ai.document-manifest.v1';
const ANALYSIS_VERSION = 'wfc.ai.document-analysis.v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
const MAX_BYTES = 4 * 1024 * 1024;
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const fail = (code) => { throw Object.assign(new Error(code), { code }); };
const check = (condition, code = 'INVALID_EVIDENCE') => { if (!condition) fail(code); };

// Reject non-JSON objects, unsafe keys, cycles and excessive nesting before traversal.
function safeJson(value, maxBytes = MAX_BYTES) {
  const seen = new Set(); let nodes = 0;
  function visit(item, depth) {
    check(depth <= 32 && ++nodes <= 200000, 'EVIDENCE_LIMIT');
    if (item === null || typeof item === 'boolean') return;
    if (typeof item === 'string') {
      check(item.isWellFormed() && !item.includes('\u0000'), 'INVALID_EVIDENCE_TEXT'); return;
    }
    if (typeof item === 'number') { check(Number.isFinite(item)); return; }
    check(typeof item === 'object' && !seen.has(item)); seen.add(item);
    const proto = Object.getPrototypeOf(item);
    check(Array.isArray(item) ? proto === Array.prototype : proto === Object.prototype || proto === null);
    check(Object.getOwnPropertySymbols(item).length === 0);
    for (const key of Object.getOwnPropertyNames(item)) {
      if (Array.isArray(item) && key === 'length') continue;
      if (Array.isArray(item)) check(/^(?:0|[1-9][0-9]*)$/.test(key) && Number(key) < item.length);
      check(!forbidden.has(key));
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      check(descriptor.enumerable && Object.hasOwn(descriptor, 'value'));
      visit(descriptor.value, depth + 1);
    }
    if (Array.isArray(item)) check(Object.keys(item).length === item.length);
    seen.delete(item);
  }
  visit(value, 0);
  check(Buffer.byteLength(JSON.stringify(value), 'utf8') <= maxBytes, 'EVIDENCE_LIMIT');
}
function object(value, keys) {
  check(value !== null && !Array.isArray(value) && typeof value === 'object');
  const actual = Object.keys(value);
  check(actual.length === keys.length && keys.every(key => Object.hasOwn(value, key)));
}
function string(value, max = 256, allowEmpty = false) {
  check(typeof value === 'string' && value.length <= max && (allowEmpty || value.trim().length > 0));
}
function array(value, max, min = 0) { check(Array.isArray(value) && value.length >= min && value.length <= max); }
function positive(value) { check(typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1000000); }
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
}
const digest = value => createHash('sha256').update(canonical(value)).digest('hex');

export function validateManifest(manifest) {
  safeJson(manifest, 16 * 1024 * 1024);
  object(manifest, ['schemaVersion', 'projectId', 'documents']);
  check(manifest.schemaVersion === MANIFEST_VERSION && UUID.test(manifest.projectId));
  array(manifest.documents, 256, 1);
  const docs = new Set(); let pages = 0, textBytes = 0;
  for (const doc of manifest.documents) {
    object(doc, ['id', 'sha256', 'pages']); string(doc.id);
    check(!docs.has(doc.id) && HASH.test(doc.sha256)); docs.add(doc.id);
    array(doc.pages, 256, 1); const pageIds = new Set();
    for (const page of doc.pages) {
      object(page, ['page', 'text', 'width', 'height', ...(Object.hasOwn(page, 'imageDataUrl') ? ['imageDataUrl'] : [])]);
      check(Number.isSafeInteger(page.page) && page.page > 0 && page.page <= 1000000 && !pageIds.has(page.page));
      pageIds.add(page.page); check(++pages <= 256, 'EVIDENCE_LIMIT');
      string(page.text, 250000, true); positive(page.width); positive(page.height);
      textBytes += Buffer.byteLength(page.text); check(textBytes <= MAX_BYTES, 'EVIDENCE_LIMIT');
      if (Object.hasOwn(page, 'imageDataUrl')) {
        check(typeof page.imageDataUrl === 'string', 'MANIFEST_IMAGE_INVALID');
        const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]*={0,2})$/.exec(page.imageDataUrl);
        check(match && match[2].length > 0 && match[2].length <= Math.ceil(5 * 1024 * 1024 / 3) * 4, 'MANIFEST_IMAGE_INVALID');
        const bytes = Buffer.from(match[2], 'base64');
        check(bytes.length <= 5 * 1024 * 1024 && bytes.toString('base64') === match[2], 'MANIFEST_IMAGE_INVALID');
        check(match[1] === 'png' ? bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
          && bytes.subarray(12,16).toString('ascii') === 'IHDR'
          : bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
            && bytes.at(-2) === 255 && bytes.at(-1) === 217, 'MANIFEST_IMAGE_INVALID');
      }
    }
  }
  return manifest;
}

const str = (maxLength = 256) => ({ type: 'string', minLength: 1, maxLength });
const obj = properties => ({ type: 'object', additionalProperties: false, properties, required: Object.keys(properties) });
const list = (items, maxItems, minItems = 0) => ({ type: 'array', items, minItems, maxItems });
const evidenceSchema = obj({ documentId: str(), page: { type: 'integer', minimum: 1, maximum: 1000000 },
  basis: { type: 'string', enum: ['local-text', 'visual-observation'] },
  quote: { type: 'string', maxLength: 16000 }, bbox: { anyOf: [{ type: 'null' }, { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4 }] } });
const evidenceList = list(evidenceSchema, 32);
export const ANALYSIS_SCHEMA = obj({
  schemaVersion: { type: 'string', enum: [ANALYSIS_VERSION] }, projectId: { type: 'string', pattern: UUID.source.replaceAll('a-f', 'A-Fa-f') },
  coverage: list(obj({ documentId: str(), page: { type: 'integer', minimum: 1, maximum: 1000000 },
    status: { type: 'string', enum: ['analyzed', 'unreadable'] }, reason: { type: 'string', maxLength: 2000 } }), 256, 1),
  entities: list(obj({ id: str(), tag: str(500), kind: { type: 'string', enum: ['equipment', 'instrument', 'signal', 'unknown'] },
    evidence: list(evidenceSchema, 32, 1) }), 4096),
  relations: list(obj({ fromEntityId: str(), toEntityId: str(),
    type: { type: 'string', enum: ['ptc-of', 'signal-of', 'open-signal-of', 'closed-signal-of', 'connected-to', 'unknown'] },
    status: { type: 'string', enum: ['supported', 'uncertain'] }, evidence: evidenceList }), 8192),
  unresolved: list(obj({ reason: str(2000), evidence: evidenceList }), 4096),
});

const normalize = text => text.normalize('NFC').replace(/\s+/gu, ' ').trim();
/** Checks syntax and cited source presence, never engineering truth or acceptance.
 * Visual quotes are model observations of an actual image region, not locally verified OCR.
 * Multiple evidence entries preserve split labels without inventing a contiguous source quote.
 * A 'supported' relation means the model reports cited support, not permission to bind. */
export function validateAnalysis(analysis, manifest) {
  validateManifest(manifest); safeJson(analysis);
  object(analysis, ['schemaVersion', 'projectId', 'coverage', 'entities', 'relations', 'unresolved']);
  check(analysis.schemaVersion === ANALYSIS_VERSION && analysis.projectId === manifest.projectId, 'ANALYSIS_SCOPE_MISMATCH');
  const pages = new Map(manifest.documents.flatMap(doc => doc.pages.map(page => [JSON.stringify([doc.id, page.page]), page])));
  const coverage = new Map(); array(analysis.coverage, 256, 1);
  for (const entry of analysis.coverage) {
    object(entry, ['documentId', 'page', 'status', 'reason']); string(entry.documentId);
    check(Number.isSafeInteger(entry.page) && entry.page > 0);
    const key = JSON.stringify([entry.documentId, entry.page]);
    check(pages.has(key) && !coverage.has(key), 'ANALYSIS_COVERAGE_INVALID');
    check(['analyzed', 'unreadable'].includes(entry.status)); string(entry.reason, 2000, entry.status === 'analyzed');
    coverage.set(key, entry.status);
  }
  check(coverage.size === pages.size, 'ANALYSIS_COVERAGE_INCOMPLETE');
  function validateEvidence(entries, min = 0) {
    array(entries, 32, min); const seen = new Set();
    for (const entry of entries) {
      object(entry, ['documentId', 'page', 'basis', 'quote', 'bbox']); string(entry.documentId);
      check(Number.isSafeInteger(entry.page) && entry.page > 0);
      const key = JSON.stringify([entry.documentId, entry.page]); const page = pages.get(key);
      check(page, 'ANALYSIS_SOURCE_NOT_FOUND');
      check(['local-text', 'visual-observation'].includes(entry.basis), 'ANALYSIS_EVIDENCE_BASIS_INVALID');
      string(entry.quote, 16000, entry.basis === 'visual-observation');
      if (entry.basis === 'local-text') check(normalize(page.text).includes(normalize(entry.quote)), 'ANALYSIS_QUOTE_NOT_FOUND');
      else check(Object.hasOwn(page, 'imageDataUrl') && entry.bbox !== null, 'ANALYSIS_VISUAL_SOURCE_REQUIRED');
      if (entry.bbox !== null) {
        array(entry.bbox, 4, 4); const [x1, y1, x2, y2] = entry.bbox;
        check(entry.bbox.every(Number.isFinite) && x1 >= 0 && y1 >= 0 && x1 < x2 && y1 < y2
          && x2 <= page.width && y2 <= page.height, 'ANALYSIS_BBOX_INVALID');
      }
      const identity = canonical(entry); check(!seen.has(identity), 'ANALYSIS_DUPLICATE_EVIDENCE'); seen.add(identity);
    }
  }
  array(analysis.entities, 4096); const ids = new Set();
  for (const entity of analysis.entities) {
    object(entity, ['id', 'tag', 'kind', 'evidence']); string(entity.id); string(entity.tag, 500);
    check(!ids.has(entity.id), 'ANALYSIS_DUPLICATE_ENTITY'); ids.add(entity.id);
    check(['equipment', 'instrument', 'signal', 'unknown'].includes(entity.kind)); validateEvidence(entity.evidence, 1);
  }
  array(analysis.relations, 8192); const edges = new Set();
  for (const relation of analysis.relations) {
    object(relation, ['fromEntityId', 'toEntityId', 'type', 'status', 'evidence']);
    check(ids.has(relation.fromEntityId) && ids.has(relation.toEntityId), 'ANALYSIS_ENTITY_NOT_FOUND');
    check(['ptc-of', 'signal-of', 'open-signal-of', 'closed-signal-of', 'connected-to', 'unknown'].includes(relation.type));
    check(['supported', 'uncertain'].includes(relation.status));
    check(relation.status !== 'supported' || relation.type !== 'unknown', 'ANALYSIS_UNSUPPORTED_RELATION');
    validateEvidence(relation.evidence, relation.status === 'supported' ? 1 : 0);
    if (relation.status === 'supported') check(relation.evidence.every(e => coverage.get(JSON.stringify([e.documentId, e.page])) === 'analyzed'), 'ANALYSIS_UNREADABLE_SOURCE');
    const key = JSON.stringify([relation.fromEntityId, relation.toEntityId, relation.type]);
    check(!edges.has(key), 'ANALYSIS_DUPLICATE_RELATION'); edges.add(key);
  }
  array(analysis.unresolved, 4096);
  for (const entry of analysis.unresolved) { object(entry, ['reason', 'evidence']); string(entry.reason, 2000); validateEvidence(entry.evidence); }
  return analysis;
}

const PILOT_PARSER_VERSION = 'wfc.gvl244.document-pages.v2';
export const DOCUMENT_PARSER_VERSION = PILOT_PARSER_VERSION;
export function analysisCacheKey({ manifest, model, promptVersion, schemaVersion, parserVersion = DOCUMENT_PARSER_VERSION }) {
  validateManifest(manifest); string(model); string(promptVersion); string(schemaVersion); string(parserVersion);
  // Includes actual supplied page text/dimensions as well as claimed document hash.
  // Preserve the original v2 receipts. A new parser must earn its own receipts, even for identical pixels.
  return digest({ manifest, model, promptVersion, schemaVersion, ...(parserVersion === PILOT_PARSER_VERSION ? {} : { parserVersion }) });
}
