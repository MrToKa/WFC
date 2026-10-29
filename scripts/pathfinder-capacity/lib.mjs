import { createHash } from 'node:crypto';

export const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const SHA = /^[a-f0-9]{64}$/;
export const IMAGE = /^sha256:[a-f0-9]{64}$/;
export const fail = code => { throw Object.assign(new Error(code), { code }); };
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  return Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
}
export function finiteTree(value, depth = 0) {
  if (depth > 128) fail('OUTPUT_DEPTH_LIMIT');
  if (typeof value === 'number' && !Number.isFinite(value)) fail('OUTPUT_NONFINITE');
  if (value && typeof value === 'object') for (const item of Object.values(value)) finiteTree(item, depth + 1);
  return value;
}
export function rejectDuplicateMembers(text) {
  let at = 0;
  const space = () => { while (/\s/.test(text[at] ?? '') && at < text.length) at++; };
  const string = () => {
    const start = at++;
    while (at < text.length) { const ch = text[at++]; if (ch === '\\') at++; else if (ch === '"') { try { return JSON.parse(text.slice(start, at)); } catch { fail('OUTPUT_JSON_INVALID'); } } }
    fail('OUTPUT_JSON_INVALID');
  };
  const value = depth => {
    if (depth > 128) fail('OUTPUT_DEPTH_LIMIT'); space();
    if (text[at] === '{') {
      at++; space(); const keys = new Set(); if (text[at] === '}') { at++; return; }
      for (;;) {
        if (text[at] !== '"') fail('OUTPUT_JSON_INVALID'); const key = string();
        if (keys.has(key)) fail('OUTPUT_DUPLICATE_MEMBER'); keys.add(key); space(); if (text[at++] !== ':') fail('OUTPUT_JSON_INVALID');
        value(depth + 1); space(); const end = text[at++]; if (end === '}') return; if (end !== ',') fail('OUTPUT_JSON_INVALID'); space();
      }
    }
    if (text[at] === '[') {
      at++; space(); if (text[at] === ']') { at++; return; }
      for (;;) { value(depth + 1); space(); const end = text[at++]; if (end === ']') return; if (end !== ',') fail('OUTPUT_JSON_INVALID'); }
    }
    if (text[at] === '"') { string(); return; }
    const token = /^(?:-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?|true|false|null)/.exec(text.slice(at));
    if (!token) fail('OUTPUT_JSON_INVALID'); at += token[0].length;
  };
  value(0); space(); if (at !== text.length) fail('OUTPUT_JSON_INVALID');
}
export function parseOutput(bytes, maximum) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > maximum) fail('OUTPUT_SIZE_LIMIT');
  let value; try { const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); rejectDuplicateMembers(text); value = JSON.parse(text); } catch (error) { if (error.code === 'OUTPUT_DUPLICATE_MEMBER' || error.code === 'OUTPUT_DEPTH_LIMIT') throw error; fail('OUTPUT_JSON_INVALID'); }
  if (!value || Array.isArray(value) || typeof value !== 'object') fail('OUTPUT_OBJECT_REQUIRED');
  return finiteTree(value);
}
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const integer = (value, low, high) => Number.isSafeInteger(value) && value >= low && value <= high;
const decimal = value => typeof value === 'string' && /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,28})?$/.test(value) && value.length <= 60;
const point = value => Array.isArray(value) && value.length === 3 && value.every(n => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e9);
const exactKeys = (value, keys) => object(value) && Object.keys(value).sort().join() === [...keys].sort().join();
export function validateManifest(value) {
  if (!object(value) || value.schemaVersion !== 'pathfinder.capacity.input.v1' || typeof value.label !== 'string' || !value.label.trim() || value.label.length > 160) fail('MANIFEST_SCHEMA_INVALID');
  if (Object.keys(value).some(key => !['schemaVersion', 'label', 'snapshot', 'request', 'repeatQueries', 'caseTimeoutMilliseconds', 'totalTimeoutMilliseconds', 'syntheticSizes'].includes(key))) fail('MANIFEST_MEMBER_INVALID');
  const snapshot = value.snapshot, request = value.request;
  if (!exactKeys(snapshot, ['path', 'sha256', 'projectId', 'modelVersionId', 'contentSha256']) || !SHA.test(snapshot.sha256 ?? '') || !SHA.test(snapshot.contentSha256 ?? '') || !UUID.test(snapshot.projectId ?? '') || !UUID.test(snapshot.modelVersionId ?? '') || typeof snapshot.path !== 'string') fail('MANIFEST_SNAPSHOT_INVALID');
  if (!exactKeys(request, ['category', 'from', 'to', 'options', 'projectSettings', 'connectionGap']) || !['MV', 'LV', 'Control', 'Instrumentation'].includes(request.category) || !point(request.from) || !point(request.to) || !decimal(request.connectionGap) || !(Number(request.connectionGap) > 0 && Number(request.connectionGap) <= 100)) fail('MANIFEST_REQUEST_INVALID');
  const options = request.options;
  if (!object(options) || Object.keys(options).sort().join() !== ['connectionToleranceMeters', 'sampleSpacingMeters', 'secondaryDistanceMeters', 'preferVerticalApproach', 'maxGraphNodes', 'maxGraphConnections'].sort().join() ||
    !Number.isFinite(options.connectionToleranceMeters) || options.connectionToleranceMeters !== Number(request.connectionGap) || options.connectionToleranceMeters <= 0 || options.connectionToleranceMeters > 100 ||
    !Number.isFinite(options.sampleSpacingMeters) || options.sampleSpacingMeters <= 0 || options.sampleSpacingMeters > 100 || !Number.isFinite(options.secondaryDistanceMeters) || options.secondaryDistanceMeters < 0 || options.secondaryDistanceMeters > 1e6 || typeof options.preferVerticalApproach !== 'boolean' ||
    !integer(options.maxGraphNodes, 2, 1000000) || !integer(options.maxGraphConnections, 1, 4000000)) fail('MANIFEST_OPTIONS_INVALID');
  const settings = request.projectSettings;
  if (!exactKeys(settings, ['revision', 'secondaryTrayLength', 'endConnectionLength', 'additionalBendingPercent']) || typeof settings.revision !== 'string' || !/^[0-9]{1,256}$/.test(settings.revision) || BigInt(settings.revision) > 9223372036854775807n || !(settings.secondaryTrayLength === null || decimal(settings.secondaryTrayLength)) || !decimal(settings.endConnectionLength) || !decimal(settings.additionalBendingPercent)) fail('MANIFEST_SETTINGS_INVALID');
  if (!integer(value.repeatQueries, 1, 64) || !integer(value.caseTimeoutMilliseconds, 100, 60000) || !integer(value.totalTimeoutMilliseconds, value.caseTimeoutMilliseconds, 300000) || !Array.isArray(value.syntheticSizes) || value.syntheticSizes.length < 1 || value.syntheticSizes.length > 4 || value.syntheticSizes.some(size => ![8, 64, 256, 1024].includes(size)) || new Set(value.syntheticSizes).size !== value.syntheticSizes.length) fail('MANIFEST_BUDGET_INVALID');
  return value;
}
export function validateResponse(value, request) {
  if (value.schemaVersion !== 'pathfinder.model.response.v1' || value.requestId !== request.requestId || value.engineeringAccepted !== false || !['calculated', 'settings_required', 'no_path', 'resource_limit', 'deadline_exceeded', 'invalid_request', 'category_required', 'model_needs_review'].includes(value.status)) fail('RUNNER_ENVELOPE_INVALID');
  if (value.status === 'calculated') {
    const route = value.route, design = value.design;
    if (!object(route) || route.success !== true || !Number.isFinite(route.lengthMeters) || route.lengthMeters < 0 || !Array.isArray(route.pathPoints) || !route.pathPoints.length || !route.pathPoints.every(p => object(p) && point([p.x, p.y, p.z])) || !Array.isArray(route.segmentIds) || !route.segmentIds.every(id => typeof id === 'string') || !object(design) || !decimal(design.designLengthMeters)) fail('RUNNER_RESULT_INVALID');
    if (!object(value.prepared) || typeof value.prepared.loadedFromDisk !== 'boolean' || value.prepared.engineeringAccepted !== false) fail('RUNNER_CACHE_INVALID');
  }
  return value;
}
export function routeDigest(response) { return sha256(canonical({ route: response.route, design: response.design, effectiveCategory: response.effectiveCategory })); }
/** Docker mount enumeration is unordered; route/path arrays must never use this normalization. */
export function stableContainerMetadata(container) {
  return { ...container, mounts: [...container.mounts].sort((a, b) => String(a.destination).localeCompare(String(b.destination))) };
}
export function parseStat(text) {
  const end = text.lastIndexOf(')'), start = text.indexOf('('), pid = Number(text.slice(0, start).trim()), fields = text.slice(end + 1).trim().split(/\s+/);
  if (start < 0 || end < start || !integer(pid, 1, Number.MAX_SAFE_INTEGER) || fields.length < 3 || !integer(Number(fields[1]), 0, Number.MAX_SAFE_INTEGER) || !integer(Number(fields[2]), 0, Number.MAX_SAFE_INTEGER)) fail('PROC_STAT_INVALID');
  return { pid, ppid: Number(fields[1]), group: Number(fields[2]), state: fields[0] };
}
export function rssBytes(status) {
  const found = /^VmRSS:\s*(\d+)\s+kB\s*$/m.exec(status);
  return found ? Number(found[1]) * 1024 : 0;
}
export function assertContainer(value, expected) {
  const host = value.HostConfig ?? {}, labels = value.Config?.Labels ?? {};
  if (value.Id !== expected.id || value.Image !== expected.image || value.Name !== '/' + expected.name || labels['wfc.pathfinder.owner'] !== expected.owner || labels['wfc.pathfinder.project'] !== expected.project || labels['wfc.pathfinder.capacity'] !== 'true' || labels['wfc.pathfinder.isolated'] !== 'true') fail('CAPACITY_OWNERSHIP_REQUIRED');
  if (host.NetworkMode !== 'none' || Object.keys(host.PortBindings ?? {}).length || host.Privileged || host.ReadonlyRootfs !== true || host.Memory !== 4 * 1024 ** 3 || host.PidsLimit !== 256 || host.NanoCpus !== 2e9) fail('CAPACITY_ISOLATION_REQUIRED');
  if ((value.Mounts ?? []).length !== 4 || (host.Mounts ?? []).length !== 4 || expected.mounts.some(m => !host.Mounts.some(actual => actual.Type === 'bind' && actual.Source === m.Source && actual.Target === m.Target && Boolean(actual.ReadOnly) === m.ReadOnly) || !value.Mounts.some(actual => actual.Type === 'bind' && actual.Source === m.Source && actual.Destination === m.Target && actual.RW === !m.ReadOnly))) fail('CAPACITY_MOUNT_REQUIRED');
  return value;
}
