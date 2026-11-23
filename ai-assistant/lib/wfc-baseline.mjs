/** Local reconciliation only. Never include raw WFC facts in an OpenAI request.
 * A document interpretation, a current WFC binding and retained model evidence
 * are distinct facts; this module neither overwrites nor promotes any of them.
 */
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const REV = /^(?:0|[1-9][0-9]{0,18})$/;
const states = ['confirmed', 'suggested', 'missing', 'ambiguous', 'stale', 'unsupported-attachment'];
const key = value => value.normalize('NFC').trim().toUpperCase();
const fail = code => { throw Object.assign(new Error(code), { code }); };
const check = condition => { if (!condition) fail('WFC_FACTS_INVALID'); };
const uuid = value => typeof value === 'string' && UUID.test(value);
const hash = value => typeof value === 'string' && HASH.test(value);
const revision = value => typeof value === 'string' && REV.test(value) && BigInt(value) <= 9223372036854775807n;
const text = value => typeof value === 'string' && value.length <= 2000 && value.isWellFormed() && !/[\u0000-\u001f\u007f]/.test(value);
const nullableText = value => value === null || text(value);
const point = value => Array.isArray(value) && value.length === 3 && value.every(n => Number.isFinite(n) && Math.abs(n) <= 1e9);
function object(value, required) {
  check(value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === required.length && required.every(field => Object.hasOwn(value, field)));
}
function scope(value) {
  object(value, ['modelVersionId', 'selectionRevision', 'contentFingerprint', 'aggregateId', 'artifactId', 'projectionSha256', 'captureFrameId', 'geometryRevision', 'traceId']);
  check(['modelVersionId','aggregateId','artifactId','captureFrameId'].every(field => uuid(value[field]))
    && revision(value.selectionRevision) && revision(value.geometryRevision)
    && hash(value.contentFingerprint) && hash(value.projectionSha256) && (value.traceId === null || uuid(value.traceId)));
}
function evidence(value) {
  if (value === null) return;
  object(value, ['kind','modelVersionId','artifactId','captureFrameId','objectIds','bounds','approximate','engineeringAccepted']);
  check(value.kind === 'saved-model-observation' && ['modelVersionId','artifactId','captureFrameId'].every(field => uuid(value[field]))
    && value.approximate === true && value.engineeringAccepted === false
    && Array.isArray(value.objectIds) && value.objectIds.length > 0 && value.objectIds.length <= 4096
    && value.objectIds.every(id => Number.isSafeInteger(id) && id > 0 && id <= 2147483647)
    && new Set(value.objectIds).size === value.objectIds.length);
  object(value.bounds, ['minimum','maximum']);
  check(point(value.bounds.minimum) && point(value.bounds.maximum)
    && value.bounds.minimum.every((n, i) => n <= value.bounds.maximum[i]));
}
function binding(value) {
  if (value === null) return;
  object(value, ['id','status','mode','pointProjectMetres','modelVersionId','aggregateId','artifactId','captureFrameId','sourceObject','selectedObjectEvidence']);
  check(['id','modelVersionId','aggregateId','artifactId','captureFrameId'].every(field => uuid(value[field]))
    && states.includes(value.status) && ['fixed-world','object-derived','object-attached'].includes(value.mode) && point(value.pointProjectMetres));
  if (value.sourceObject !== null) {
    object(value.sourceObject, ['traceId','objectRevisionId','recordSha256']);
    check(uuid(value.sourceObject.traceId) && uuid(value.sourceObject.objectRevisionId) && hash(value.sourceObject.recordSha256));
  }
  evidence(value.selectedObjectEvidence);
}
function indices(facts) {
  const aliases = new Map(), byId = new Map();
  for (const location of facts.locations) {
    byId.set(location.id, location);
    for (const name of [location.name, ...location.aliases]) {
      const normalized = key(name), previous = aliases.get(normalized);
      check(!previous || previous.id === location.id);
      aliases.set(normalized, location);
    }
  }
  return { aliases, byId };
}
function usedEndpoints(facts, aliases) {
  const used = new Map();
  for (const cable of facts.cables) for (const side of ['from','to']) {
    const original = cable[side];
    if (original === null || !original.trim()) continue;
    const normalized = key(original);
    let entry = used.get(normalized);
    if (!entry) { entry = { rawNames: new Set(), occurrences: [], location: aliases.get(normalized) ?? null }; used.set(normalized, entry); }
    entry.rawNames.add(original); entry.occurrences.push({ cableId: cable.id, cableTag: cable.tag, side, originalName: original });
  }
  return used;
}

export function validateWfcFacts(facts, { projectId } = {}) {
  object(facts, ['schemaVersion','projectId','capturedAt','source','registryRevision','current','cables','locations','endpoints']);
  check(facts.schemaVersion === 'wfc.ai.wfc-facts.v1' && uuid(facts.projectId)
    && (!projectId || facts.projectId === projectId) && typeof facts.capturedAt === 'string'
    && facts.capturedAt.endsWith('Z') && Number.isFinite(Date.parse(facts.capturedAt)) && revision(facts.registryRevision));
  object(facts.source, ['kind','consistency','readOnly']);
  check(facts.source.kind === 'local-operator-read-only' && facts.source.consistency === 'repeatable-read' && facts.source.readOnly === true);
  if (facts.current !== null) scope(facts.current);
  check(Array.isArray(facts.cables) && facts.cables.length <= 10000 && Array.isArray(facts.locations) && facts.locations.length <= 10000);
  const cableIds = new Set(), locationIds = new Set();
  for (const cable of facts.cables) {
    object(cable, ['id','tag','from','to','mto','purpose','writeRevision']);
    check(uuid(cable.id) && !cableIds.has(cable.id) && [cable.tag,cable.from,cable.to,cable.mto,cable.purpose].every(nullableText)
      && revision(cable.writeRevision));
    cableIds.add(cable.id);
  }
  for (const location of facts.locations) {
    object(location, ['id','name','aliases','revision','binding','calculationReady']);
    check(uuid(location.id) && !locationIds.has(location.id) && text(location.name) && location.name.trim()
      && revision(location.revision) && Array.isArray(location.aliases) && location.aliases.length <= 100
      && location.aliases.every(name => text(name) && name.trim()) && new Set(location.aliases.map(key)).size === location.aliases.length
      && typeof location.calculationReady === 'boolean');
    locationIds.add(location.id); binding(location.binding);
    check(!location.calculationReady || facts.current !== null && location.binding?.status === 'confirmed'
      && ['modelVersionId','aggregateId','artifactId','captureFrameId'].every(field => location.binding[field] === facts.current[field]));
  }
  const { aliases } = indices(facts), used = usedEndpoints(facts, aliases);
  check(Array.isArray(facts.endpoints) && facts.endpoints.length === used.size);
  const seen = new Set();
  for (const endpoint of facts.endpoints) {
    object(endpoint, ['name','rawNames','locationId','bindingId','bindingStatus','calculationReady','status','fromOccurrences','toOccurrences','distinctCables']);
    check(text(endpoint.name) && endpoint.name.trim());
    const normalized = key(endpoint.name), entry = used.get(normalized);
    check(entry && !seen.has(normalized) && Array.isArray(endpoint.rawNames)
      && endpoint.rawNames.length === entry.rawNames.size && new Set(endpoint.rawNames).size === endpoint.rawNames.length
      && endpoint.rawNames.every(name => entry.rawNames.has(name)));
    seen.add(normalized);
    const location = entry.location;
    const status = !location?.binding || location.binding.status === 'missing' ? 'missing' : location.calculationReady ? 'ready'
      : ['confirmed','stale'].includes(location.binding.status) ? 'obsolete' : 'unresolved';
    check(endpoint.locationId === (location?.id ?? null) && endpoint.bindingId === (location?.binding?.id ?? null)
      && endpoint.bindingStatus === (location?.binding?.status ?? null) && endpoint.calculationReady === (location?.calculationReady ?? false)
      && endpoint.status === status && endpoint.fromOccurrences === entry.occurrences.filter(value => value.side === 'from').length
      && endpoint.toOccurrences === entry.occurrences.filter(value => value.side === 'to').length
      && endpoint.distinctCables === new Set(entry.occurrences.map(value => value.cableId)).size);
  }
  return facts;
}

function geometry(location, current) {
  if (!location?.calculationReady || !location.binding || !current) return { kind:'none', evidence:null };
  const binding = location.binding;
  if (binding.sourceObject && binding.sourceObject.traceId === current.traceId) return { kind:'immutable-object-reference', evidence:binding.sourceObject };
  if (binding.selectedObjectEvidence?.modelVersionId === current.modelVersionId) return { kind:'saved-model-observation', evidence:binding.selectedObjectEvidence };
  return { kind:'none', evidence:null };
}
function matchType(tag, rawNames) {
  if (rawNames.has(tag)) return 'exact-original';
  if ([...rawNames].some(raw => raw.toUpperCase() === tag.toUpperCase())) return 'case-only';
  return 'normalized-only';
}
function parentFact(parentTag, aliases, current) {
  const location = aliases.get(key(parentTag));
  return { parentTag, knownLocationId:location?.id ?? null, currentBindingReady:location?.calculationReady ?? false,
    geometry:geometry(location, current), source:'document-candidate' };
}
function differentTargets(consumer, parent, current) {
  if (!consumer?.calculationReady || !parent?.calculationReady || !current) return null;
  const a = consumer.binding, b = parent.binding;
  if (a.sourceObject && b.sourceObject && a.sourceObject.traceId === current.traceId && b.sourceObject.traceId === current.traceId
    && a.sourceObject.objectRevisionId !== b.sourceObject.objectRevisionId) return 'different-current-trace-object-ids';
  const left = a.selectedObjectEvidence, right = b.selectedObjectEvidence;
  if (!left || !right || left.modelVersionId !== current.modelVersionId || right.modelVersionId !== current.modelVersionId) return null;
  if (!left.objectIds.some(id => right.objectIds.includes(id))) return 'different-current-model-object-ids';
  if (left.captureFrameId === current.captureFrameId && right.captureFrameId === current.captureFrameId
    && left.bounds.minimum.some((n, i) => left.bounds.maximum[i] < right.bounds.minimum[i] || right.bounds.maximum[i] < n)) {
    return 'nonoverlapping-current-frame-bounds';
  }
  return null;
}

/** Reconciles the full supplied document summary against the full WFC snapshot.
 * Never calls OpenAI, searches 3D or authorizes a binding. A document-only tag is
 * retained even if no cable currently uses it; original WFC endpoint text stays.
 */
export function summarizeKnownFacts(facts, equipmentSummary) {
  validateWfcFacts(facts);
  if (!equipmentSummary || equipmentSummary.schemaVersion !== 'wfc.ai.equipment-summary.v1'
    || equipmentSummary.projectId !== facts.projectId || !Array.isArray(equipmentSummary.parents)
    || !Array.isArray(equipmentSummary.review) || !Array.isArray(equipmentSummary.unresolved)
    || equipmentSummary.parents.length > 100000) fail('WFC_DOCUMENT_SUMMARY_INVALID');
  const { aliases } = indices(facts), used = usedEndpoints(facts, aliases);
  const documents = new Map(), review = new Map();
  for (const entry of equipmentSummary.review) {
    if (!entry || !text(entry.consumerTag) || !Array.isArray(entry.reasonCodes)) fail('WFC_DOCUMENT_SUMMARY_INVALID');
    review.set(key(entry.consumerTag), entry);
    if (!documents.has(key(entry.consumerTag))) documents.set(key(entry.consumerTag), []);
  }
  for (const relation of equipmentSummary.parents) {
    if (!relation || !text(relation.consumerTag) || !relation.consumerTag.trim() || !text(relation.parentTag) || !relation.parentTag.trim()
      || !['candidate','review'].includes(relation.status) || !Array.isArray(relation.sources)) fail('WFC_DOCUMENT_SUMMARY_INVALID');
    const normalized = key(relation.consumerTag);
    if (!documents.has(normalized)) documents.set(normalized, []);
    documents.get(normalized).push(relation);
  }
  const endpoints = [];
  for (const [normalized, entry] of used) {
    const relations = documents.get(normalized) ?? [], docReview = review.get(normalized);
    const location = entry.location;
    const parentTags = new Set(relations.map(relation => key(relation.parentTag)));
    const reasonCodes = [];
    if (parentTags.size > 1) reasonCodes.push('CONFLICTING_DOCUMENT_PARENTS');
    if (docReview || relations.some(relation => relation.status === 'review')) reasonCodes.push('DOCUMENT_RELATION_REVIEW');
    if (!location?.calculationReady) reasonCodes.push(location?.binding ? 'WFC_BINDING_NOT_CURRENT' : 'WFC_BINDING_MISSING');
    const targetReviews = relations.filter(relation => relation.status === 'candidate').flatMap(relation => {
      const parent = aliases.get(key(relation.parentTag)), basis = differentTargets(location, parent, facts.current);
      return basis ? [{code:'WFC_DOCUMENT_TARGET_REVIEW',consumerTag:relation.consumerTag,parentTag:relation.parentTag,basis,
        currentBindingId:location.binding.id,documentParentBindingId:parent.binding.id,
        currentEvidence:geometry(location,facts.current),documentParentEvidence:geometry(parent,facts.current)}] : [];
    });
    if (targetReviews.length) reasonCodes.push('WFC_DOCUMENT_TARGET_REVIEW');
    endpoints.push({ originalNames:[...entry.rawNames], occurrences:entry.occurrences,
      wfc:{ locationId:location?.id ?? null, currentBindingReady:location?.calculationReady ?? false, binding:location?.binding ?? null,
        geometry:geometry(location, facts.current) },
      documentCandidates:relations.map(relation => ({ ...relation, match:matchType(relation.consumerTag, entry.rawNames),
        parentFacts:parentFact(relation.parentTag, aliases, facts.current) })),
      documentReview:docReview ?? null, targetReviews, reasonCodes,
      disposition:location?.calculationReady ? 'preserve-current-binding' : 'needs-resolution', automaticBindingAllowed:false });
  }
  const documentOnly = [...documents].filter(([normalized]) => !used.has(normalized)).map(([normalized, relations]) => {
    const reasonCodes=[];
    if(new Set(relations.map(relation=>key(relation.parentTag))).size>1) reasonCodes.push('CONFLICTING_DOCUMENT_PARENTS');
    if(review.has(normalized)||relations.some(relation=>relation.status==='review')) reasonCodes.push('DOCUMENT_RELATION_REVIEW');
    return {consumerTag:relations[0]?.consumerTag ?? review.get(normalized).consumerTag, source:'document-only',
      candidates:relations.map(relation => ({...relation, parentFacts:parentFact(relation.parentTag, aliases, facts.current)})),
      review:review.get(normalized) ?? null, reasonCodes, cableOccurrences:0, automaticBindingAllowed:false};
  });
  const documentParentConflicts=endpoints.filter(entry=>entry.reasonCodes.includes('CONFLICTING_DOCUMENT_PARENTS')).length
    + documentOnly.filter(entry=>entry.reasonCodes.includes('CONFLICTING_DOCUMENT_PARENTS')).length;
  const targetReviewConsumers=endpoints.filter(entry=>entry.targetReviews.length>0).length;
  const conflicts=endpoints.filter(entry=>entry.reasonCodes.some(code=>['CONFLICTING_DOCUMENT_PARENTS','WFC_DOCUMENT_TARGET_REVIEW'].includes(code))).length
    + documentOnly.filter(entry=>entry.reasonCodes.includes('CONFLICTING_DOCUMENT_PARENTS')).length;
  return { schemaVersion:'wfc.ai.known-facts-summary.v1', projectId:facts.projectId, capturedAt:facts.capturedAt,
    registryRevision:facts.registryRevision, counts:{ cables:facts.cables.length, endpointNames:endpoints.length,
      currentBindings:endpoints.filter(entry => entry.wfc.currentBindingReady).length,
      needsResolution:endpoints.filter(entry => entry.disposition === 'needs-resolution').length,
      documentRelations:equipmentSummary.parents.length, documentOnlyConsumers:documentOnly.length,
      documentParentConflicts,wfcDocumentTargetReviewConsumers:targetReviewConsumers,conflicts },
    endpoints, documentOnly, documentUnresolved:equipmentSummary.unresolved, writesPerformed:0,
    rawWfcFactsForExternalApi:false };
}
