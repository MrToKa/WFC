import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { preparationAggregateSchema, preparationPlanSchema, preparationPlanHashInput, preparationCanonicalJson,
  type PreparationContext, type PreparationScope } from '../../shared/pathfinderPreparation.js';
import { snapshotSchema, type SnapshotObject } from './contracts.js';
import { readPreparationBlob } from './preparationStorage.js';

/** Historical identities are hints for a fresh model lookup, never old geometry
 * or permission to reuse version-local dbIds in a different model load. */
export const TRAY_CARRYOVER_LIMITS = Object.freeze({ sourceScopes: 4, sessionsPerScope: 128,
  projectionBytes: 64 * 1024 ** 2, totalProjectionBytes: 128 * 1024 ** 2, rootsPerTray: 2048,
  identityText: 1024, cacheEntries: 4, cacheBytes: 1024 ** 2 });
type Carryover = NonNullable<PreparationContext['trayAssignmentCarryover']>;
type Identity = Carryover[number]['roots'][number]['identity'];
type CachedIdentities = ReadonlyMap<string, Readonly<Identity> | null>;
const identityCache = new Map<string, CachedIdentities>();
const same = (a: unknown, b: unknown) => preparationCanonicalJson(a) === preparationCanonicalJson(b);
const digest = (value: unknown) => createHash('sha256').update(preparationCanonicalJson(value)).digest('hex');
const sourceKey = (scope: PreparationScope) => [scope.modelVersionId, scope.contentFingerprint, scope.selectionRevision].join(':');
const normalized = (value: string) => value.normalize('NFC').trim();
const propertyKey = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[\s_.-]+/g, '');
const propertyAliases = { guid: new Set(['guid', 'globalid', 'ifcguid']), sourcefile: new Set(['sourcefile', 'sourcefilename', 'quelldatei']) };
const externalIdentity = (value: string | null | undefined) => value && value.length <= TRAY_CARRYOVER_LIMITS.identityText
  && !/[\u0000-\u001f\u007f-\u009f]/u.test(value) ? value : null;
function oneProperty(object: SnapshotObject, key: keyof typeof propertyAliases): string | null {
  const values = [...new Set(object.properties.filter(property => propertyAliases[key].has(propertyKey(property.name))).map(property => normalized(property.value)).filter(Boolean))];
  return values.length === 1 && values[0].length <= TRAY_CARRYOVER_LIMITS.identityText ? values[0] : null;
}
function identityOf(object: SnapshotObject): Identity | null {
  if (object.properties.some(property => (propertyAliases.guid.has(propertyKey(property.name)) || propertyAliases.sourcefile.has(propertyKey(property.name)))
    && normalized(property.value).length > TRAY_CARRYOVER_LIMITS.identityText)) return null;
  const rawGuid = oneProperty(object, 'guid')?.replace(/^\{(.*)\}$/, '$1').toLowerCase() ?? null;
  const guid = rawGuid && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(rawGuid) ? rawGuid : null;
  const externalId = externalIdentity(object.externalId);
  return guid || externalId ? { externalId, guid, sourceFile: oneProperty(object, 'sourcefile') } : null;
}
const fileKey = (value: string | null) => value === null ? null : normalized(value).replaceAll('\\', '/').toLowerCase();
function qualifiedIdentities(objects: SnapshotObject[], rootIds: string[]): CachedIdentities {
  const externalCounts = new Map<string, number>(), guidSources = new Map<string, Array<string | null>>();
  for (const object of objects) {
    const external = externalIdentity(object.externalId);
    if (external) externalCounts.set(external, (externalCounts.get(external) ?? 0) + 1);
    const rawGuid = oneProperty(object, 'guid')?.replace(/^\{(.*)\}$/, '$1').toLowerCase();
    if (rawGuid && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(rawGuid)) {
      const sources = guidSources.get(rawGuid) ?? []; sources.push(fileKey(oneProperty(object, 'sourcefile'))); guidSources.set(rawGuid, sources);
    }
  }
  const byId = new Map(objects.map(object => [object.id, object])), result = new Map<string, Readonly<Identity> | null>();
  for (const root of rootIds) {
    const object = byId.get(root), identity = object ? identityOf(object) : null;
    if (identity) {
      if (identity.externalId && externalCounts.get(identity.externalId) !== 1) identity.externalId = null;
      if (identity.guid) {
        const source = fileKey(identity.sourceFile), matches = (guidSources.get(identity.guid) ?? [])
          .filter(value => source === null || value === null || value === source);
        if (matches.length !== 1) identity.guid = null;
      }
    }
    result.set(root, identity && (identity.externalId || identity.guid) ? Object.freeze(identity) : null);
  }
  return result;
}
function retainIdentities(cache: Map<string, CachedIdentities>, key: string, identities: CachedIdentities): void {
  const bytes = (value: CachedIdentities) => Buffer.byteLength(JSON.stringify([...value]));
  const size = bytes(identities); if (size > TRAY_CARRYOVER_LIMITS.cacheBytes) return;
  cache.delete(key); cache.set(key, identities);
  let total = [...cache.values()].reduce((sum, value) => sum + bytes(value), 0);
  while (cache.size > TRAY_CARRYOVER_LIMITS.cacheEntries || total > TRAY_CARRYOVER_LIMITS.cacheBytes) {
    const oldest = cache.keys().next().value!; total -= bytes(cache.get(oldest)!); cache.delete(oldest);
  }
}

/** Upgrade existing assignments from checksum-verified published captures.
 * Missing/oversized historical evidence leaves just that assignment unresolved;
 * it must not prevent the current model's context from loading. */
export async function loadTrayAssignmentCarryover(c: PoolClient, projectId: string, current: PreparationScope,
  resolutions: PreparationContext['resolutions'], cache: Map<string, CachedIdentities> = identityCache): Promise<Carryover> {
  const groups = new Map<string, PreparationContext['resolutions']>();
  for (const resolution of resolutions) {
    if (resolution.mode !== 'roots' || sourceKey(resolution.scope) === sourceKey(current)
      || resolution.rootObjectIds.length > TRAY_CARRYOVER_LIMITS.rootsPerTray) continue;
    const key = sourceKey(resolution.scope);
    if (!groups.has(key) && groups.size >= TRAY_CARRYOVER_LIMITS.sourceScopes) continue;
    groups.set(key, [...(groups.get(key) ?? []), resolution]);
  }
  const result: Carryover = []; let totalBytes = 0;
  for (const candidates of groups.values()) {
    const source = candidates[0].scope;
    const pending = new Map(candidates.map(resolution => [resolution.id, resolution]));
    // A historical plan includes its object manifest. Read one at a time instead
    // of materializing the entire bounded history when the newest is sufficient.
    for (let offset = 0; offset < TRAY_CARRYOVER_LIMITS.sessionsPerScope && pending.size; offset++) {
      const row = (await c.query<{ plan: unknown; manifest: unknown }>(`/* tray-assignment-carryover */
        SELECT s.plan,a.manifest FROM pf_preparation_sessions s
        JOIN pf_preparation_aggregates a ON a.project_id=s.project_id AND a.session_id=s.id
        WHERE s.project_id=$1 AND s.state='published' AND s.plan->>'modelVersionId'=$2
          AND s.plan->>'contentFingerprint'=$3 AND s.plan->>'selectionRevision'=$4
        ORDER BY s.created_at DESC,s.id DESC LIMIT 1 OFFSET $5`, [projectId, source.modelVersionId, source.contentFingerprint, source.selectionRevision, offset])).rows[0];
      if (!row) break;
      const parsedPlan = preparationPlanSchema.safeParse(row.plan), parsedAggregate = preparationAggregateSchema.safeParse(row.manifest);
      if (!parsedPlan.success || !parsedAggregate.success) continue;
      const plan = parsedPlan.data, aggregate = parsedAggregate.data;
      if (plan.projectId !== projectId || aggregate.projectId !== projectId || sourceKey(plan) !== sourceKey(source)
        || sourceKey(aggregate) !== sourceKey(source) || aggregate.sessionId !== plan.id
        || aggregate.orderedPlanSha256 !== plan.orderedPlanSha256 || digest(preparationPlanHashInput(plan)) !== plan.orderedPlanSha256) continue;
      const matches = [...pending.values()].filter(resolution => plan.requestedScope.trays.some(tray =>
        tray.projectTrayId === resolution.projectTrayId && tray.ownershipDecisionId === resolution.id
        && same(tray.orderedRootObjectIds, resolution.rootObjectIds)));
      if (!matches.length || aggregate.projection.bytes > TRAY_CARRYOVER_LIMITS.projectionBytes) continue;
      try {
        const key = [projectId, sourceKey(source), plan.id, aggregate.projection.payloadRef, aggregate.projection.sha256, aggregate.projection.bytes].join(':');
        const rootIds = [...new Set(matches.flatMap(resolution => resolution.rootObjectIds))];
        let identities = cache.get(key);
        if (!identities || rootIds.some(root => !identities!.has(root))) {
          if (totalBytes + aggregate.projection.bytes > TRAY_CARRYOVER_LIMITS.totalProjectionBytes) continue;
          totalBytes += aggregate.projection.bytes;
          const bytes = await readPreparationBlob(projectId, plan.id, aggregate.projection, TRAY_CARRYOVER_LIMITS.projectionBytes);
          const snapshot = snapshotSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
          if (snapshot.model.projectId !== projectId || snapshot.model.modelVersionId !== source.modelVersionId
            || snapshot.model.contentSha256 !== source.contentFingerprint) continue;
          const objects = new Map(snapshot.objects.map(object => [object.id, object]));
          if (objects.size !== snapshot.objects.length) continue;
          const extracted = new Map(identities);
          for (const [root, identity] of qualifiedIdentities(snapshot.objects, rootIds)) extracted.set(root, identity);
          identities = extracted; retainIdentities(cache, key, identities);
        }
        for (const resolution of matches) {
          const roots = resolution.rootObjectIds.map(objectId => {
            const identity = identities!.get(objectId);
            return identity ? { objectId, identity: { ...identity } } : null;
          });
          if (roots.some(root => root === null)) continue;
          result.push({ resolutionId: resolution.id, projectTrayId: resolution.projectTrayId,
            sourceModelVersionId: source.modelVersionId, roots: roots as Carryover[number]['roots'] });
          pending.delete(resolution.id);
        }
      } catch { /* Historical storage is optional; never authorize from unverified bytes. */ }
    }
  }
  return result;
}
