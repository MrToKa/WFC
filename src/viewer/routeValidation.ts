import { CHANNEL, isUuid, normalizeRoutingKey, parseRouting, validateEnvelope,
  type IgnoredOccurrence, type ModelRouteResultPayload, type RoutingOccurrence, type RouteWarning } from '../../viewer-runtime/protocol.mjs';
import type { ViewerEvent, ViewerEventIdentity } from './ViewerController';

export type RouteIdentity = Readonly<{
  protocolVersion: 1; instanceId: string; projectId: string; modelVersionId: string; loadId: string; requestId: string;
}>;
export type RouteAttempt = RouteIdentity & {
  operationId: string; rawRouting: string; source: 'manual' | 'cable'; cableId: string | null;
};
export type ProjectRouteState = 'exists' | 'missing' | 'ambiguous' | 'unavailable';
export type ProjectRouteMatch = { state: ProjectRouteState; matchCount: number | null };
export type ProjectRouteHalf = {
  identity: RouteIdentity; operationId: string; rawRouting: string; source: 'manual' | 'cable'; cableId: string | null;
  databaseCheck: 'available' | 'unavailable';
  segments: (RoutingOccurrence & { project: ProjectRouteMatch })[]; ignored: IgnoredOccurrence[];
};
export type RouteCheckResult = {
  protocolVersion: 1; projectId: string; modelVersionId: string; loadId: string; requestId: string;
  source: 'manual' | 'cable'; cableId: string | null; rawRouting: string;
  status: 'empty' | 'complete' | 'partial' | 'none' | 'invalid'; databaseCheck: 'available' | 'unavailable';
  segments: (RoutingOccurrence & { project: ProjectRouteMatch; model: { state: 'found' | 'missing' | 'ambiguous'; matchCount: number; drawable: boolean } })[];
  ignored: IgnoredOccurrence[]; drawableCount: number; lineCount: number; warnings: RouteWarning[];
};
export type ParsedRouteInput = {
  status: 'valid' | 'empty' | 'invalid'; rawRouting: string; segments: RoutingOccurrence[]; ignored: IgnoredOccurrence[]; error: string | null;
};
export class RouteValidationError extends Error {
  readonly code = 'ROUTE_RESULT_MISMATCH';
  constructor() { super('The route results do not belong to the current request and model. Show the route again.'); this.name = 'RouteValidationError'; }
}
const mismatch = (): never => { throw new RouteValidationError(); };
const identityKeys = ['protocolVersion', 'instanceId', 'projectId', 'modelVersionId', 'loadId', 'requestId'] as const;
const identityOf = (value: RouteIdentity): RouteIdentity => Object.freeze({ protocolVersion: 1, instanceId: value.instanceId, projectId: value.projectId,
  modelVersionId: value.modelVersionId, loadId: value.loadId, requestId: value.requestId });
const sameIdentity = (a: ViewerEventIdentity | undefined, b: RouteIdentity) => Boolean(a && identityKeys.every(key => a[key] === b[key]));
function validateAttempt(attempt: RouteAttempt): void {
  if (!attempt || attempt.protocolVersion !== 1 || ![attempt.instanceId, attempt.projectId, attempt.modelVersionId, attempt.loadId, attempt.requestId, attempt.operationId].every(isUuid) ||
    typeof attempt.rawRouting !== 'string' || !['manual', 'cable'].includes(attempt.source) || (attempt.source === 'manual' ? attempt.cableId !== null : !isUuid(attempt.cableId))) mismatch();
}
export function parseRouteInput(raw: string | null): ParsedRouteInput {
  const rawRouting = raw === null ? '' : raw;
  try { const parsed = parseRouting(rawRouting); return { status: parsed.segments.length ? 'valid' : 'empty', rawRouting, ...parsed, error: null }; }
  catch { return { status: 'invalid', rawRouting, segments: [], ignored: [], error: 'The route contains invalid identifiers or exceeds 8,000 characters or 100 segments.' }; }
}

/** A fresh complete project tray response, or null for a non-access lookup failure. */
export function buildProjectRouteCheck(attempt: RouteAttempt, trays: readonly { id: string; projectId: string; name: string }[] | null): ProjectRouteHalf {
  validateAttempt(attempt);
  const parsed = parseRouteInput(attempt.rawRouting); if (parsed.status === 'invalid') return mismatch();
  const counts = new Map<string, number>(), ids = new Set<string>();
  if (trays !== null && !Array.isArray(trays)) return mismatch();
  if (trays !== null) for (const tray of trays) {
    if (!tray || !isUuid(tray.id) || tray.projectId !== attempt.projectId || typeof tray.name !== 'string' || ids.has(tray.id)) mismatch();
    ids.add(tray.id);
    let key: string;
    try { key = normalizeRoutingKey(tray.name); } catch { continue; }
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return { identity: identityOf(attempt), operationId: attempt.operationId, rawRouting: attempt.rawRouting, source: attempt.source, cableId: attempt.cableId,
    databaseCheck: trays === null ? 'unavailable' : 'available', ignored: parsed.ignored.map(value => ({ ...value })),
    segments: parsed.segments.map(value => {
      const count = counts.get(value.key) ?? 0;
      return { ...value, project: trays === null ? { state: 'unavailable', matchCount: null } : { state: count === 1 ? 'exists' : count ? 'ambiguous' : 'missing', matchCount: count } };
    }) };
}

function resultBase(attempt: RouteAttempt) {
  return { protocolVersion: 1 as const, projectId: attempt.projectId, modelVersionId: attempt.modelVersionId, loadId: attempt.loadId, requestId: attempt.requestId,
    source: attempt.source, cableId: attempt.cableId, rawRouting: attempt.rawRouting };
}
/** Local invalid/empty attempts use a fresh caller-owned ID; they send no DB claims to the frame. */
export function createLocalRouteCheck(attempt: RouteAttempt): RouteCheckResult {
  validateAttempt(attempt);
  const parsed = parseRouteInput(attempt.rawRouting); if (parsed.status === 'valid') return mismatch();
  return { ...resultBase(attempt), status: parsed.status, databaseCheck: 'unavailable', segments: [], ignored: parsed.ignored.map(value => ({ ...value })), drawableCount: 0, lineCount: 0,
    warnings: [{ code: parsed.status === 'invalid' ? 'ROUTE_INVALID' : parsed.ignored.length ? 'SECONDARY_ONLY' : 'ENTER_ROUTE', segmentIndex: null,
      message: parsed.error ?? (parsed.ignored.length ? 'The route contains only SECONDARY markers. Enter at least one tray identifier.' : 'Enter a route.') }] };
}

export function aggregateRouteCheck(attempt: RouteAttempt, event: ViewerEvent, project: ProjectRouteHalf): RouteCheckResult {
  validateAttempt(attempt);
  const parsed = parseRouteInput(attempt.rawRouting); if (parsed.status === 'invalid') return mismatch();
  if (!event || !project || !Array.isArray(project.segments) || !Array.isArray(project.ignored)) return mismatch();
  if (event.type !== 'ROUTE_RESULT' || event.requestId !== attempt.requestId || !sameIdentity(event.identity, attempt) || !sameIdentity(project.identity, attempt) || project.operationId !== attempt.operationId ||
    project.rawRouting !== attempt.rawRouting || project.source !== attempt.source || project.cableId !== attempt.cableId || !['available', 'unavailable'].includes(project.databaseCheck)) return mismatch();
  const envelope = validateEnvelope({ channel: CHANNEL, ...event.identity, type: event.type, payload: event.payload }, 'frame-to-parent');
  if (!envelope) return mismatch();
  const model = envelope.payload as unknown as ModelRouteResultPayload;
  if (model.rawRouting !== attempt.rawRouting || model.source !== attempt.source || model.cableId !== attempt.cableId || project.segments.length !== parsed.segments.length ||
    project.ignored.length !== parsed.ignored.length || !project.ignored.every((value, index) => value && value.segmentIndex === parsed.ignored[index].segmentIndex && value.token === parsed.ignored[index].token && value.reason === 'SECONDARY')) return mismatch();
  const warnings: RouteWarning[] = model.warnings.map(value => ({ ...value }));
  const segments = parsed.segments.map((value, index) => {
    const db = project.segments[index];
    if (!db || db.segmentIndex !== value.segmentIndex || db.token !== value.token || db.key !== value.key || !db.project) return mismatch();
    const match = db.project;
    const validCount = Number.isSafeInteger(match.matchCount) && Number(match.matchCount) >= 0;
    if (project.databaseCheck === 'unavailable' ? match.state !== 'unavailable' || match.matchCount !== null :
      !validCount || (match.state === 'exists' ? match.matchCount !== 1 : match.state === 'missing' ? match.matchCount !== 0 : match.state !== 'ambiguous' || Number(match.matchCount) <= 1)) return mismatch();
    if (match.state === 'missing') warnings.push({ code: 'PROJECT_MISSING', segmentIndex: value.segmentIndex, message: `${value.token} does not exist in this project.` });
    else if (match.state === 'ambiguous') warnings.push({ code: 'PROJECT_AMBIGUOUS', segmentIndex: value.segmentIndex, message: `${value.token} matches more than one tray name in this project.` });
    return { ...value, project: { ...match }, model: { ...model.segments[index].model } };
  });
  if (project.databaseCheck === 'unavailable' && segments.length) warnings.push({ code: 'PROJECT_CHECK_UNAVAILABLE', segmentIndex: null, message: 'The project tray check is unavailable. Model matches are shown independently.' });
  const complete = project.databaseCheck === 'available' && model.lineCount > 0 && segments.every(value => value.project.state === 'exists' && value.model.state === 'found' && value.model.drawable);
  return { ...resultBase(attempt), status: !segments.length ? 'empty' : !model.drawableCount ? 'none' : complete ? 'complete' : 'partial',
    databaseCheck: project.databaseCheck, segments, ignored: parsed.ignored.map(value => ({ ...value })), drawableCount: model.drawableCount, lineCount: model.lineCount, warnings };
}
