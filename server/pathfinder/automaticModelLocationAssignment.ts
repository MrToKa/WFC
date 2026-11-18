import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { ENDPOINT_ANCHOR_RULE, endpointLocationNameSchema, endpointLocationSchema, normalizeEndpointLocation } from '../../shared/pathfinderEndpointBindings.js';
import { MODEL_LOCATION_MATCH_LIMITS } from '../../shared/pathfinderModelLocationMatch.js';
import { assertLoginNotExpired } from './auth.js';
import { readPreparedNamedEndpointMatches } from './automaticEndpointCandidates.js';
import { confirmEndpointBindingChangeInTransaction, readCurrentEndpointBindingContext } from './endpointBindingRepository.js';
import { PathFinderError } from './errors.js';
import type { JobPrincipal } from './jobContracts.js';

const maxAssignmentsPerTransaction = 64;

type UnassignedLocation = {
  key: string;
  id: string | null;
  name: string | null;
  revision: string | null;
  aliases: string[];
};
type AssignmentTarget = { id: string; name: string; revision: string | null; aliases: string[] };

/** Server-side Find and assign for an authorized generation, using the
 * published model evidence. Returning assignments lets the scheduler finish
 * admission on the resulting generation with the changed heads in scope. */
export async function assignAutomaticModelLocationsInTransaction(client: PoolClient, projectId: string, who: JobPrincipal,
  signal: AbortSignal, beforeWrite: () => Promise<void>) {
  const check = () => { signal.throwIfAborted(); assertLoginNotExpired(who); };
  check();
  const current = await readCurrentEndpointBindingContext(client, projectId);
  if (!current?.traceId) return 0;
  const requested = (await client.query<{ name: string }>(`/* automatic-location-assignment:names */
    SELECT DISTINCT e.name COLLATE "C" AS name FROM cables c CROSS JOIN LATERAL (VALUES(c.from_location),(c.to_location)) e(name)
    WHERE c.project_id=$1 AND c.mto IS DISTINCT FROM 'MV' AND btrim(e.name)<>''
    ORDER BY name LIMIT $2`, [projectId, MODEL_LOCATION_MATCH_LIMITS.names + 1])).rows;
  check();
  if (requested.length > MODEL_LOCATION_MATCH_LIMITS.names) throw new PathFinderError('MODEL_LOCATION_MATCH_NAME_LIMIT', 413);
  const names = new Map<string, string>();
  for (const row of requested) {
    const valid = endpointLocationNameSchema.safeParse(row.name.normalize('NFC').trim());
    if (!valid.success) continue;
    const key = normalizeEndpointLocation(valid.data);
    if (!names.has(key)) names.set(key, valid.data);
  }
  if (!names.size) return 0;

  const available = (await client.query<UnassignedLocation>(`/* automatic-location-assignment:unassigned */
    SELECT wanted.key,l.id,l.name,l.revision::text,ARRAY(
      SELECT a.display_alias FROM pf_location_aliases a WHERE a.project_id=l.project_id AND a.location_id=l.id
        AND a.normalized_alias<>normalize(upper(btrim(l.name)),NFC) ORDER BY a.normalized_alias
    ) AS aliases
    FROM unnest($2::text[]) wanted(key)
    LEFT JOIN pf_location_aliases a ON a.project_id=$1 AND a.normalized_alias=wanted.key
    LEFT JOIN pf_locations l ON l.project_id=a.project_id AND l.id=a.location_id
    WHERE NOT EXISTS(SELECT 1 FROM pf_endpoint_binding_heads h WHERE h.project_id=l.project_id AND h.location_id=l.id)
      AND NOT EXISTS(SELECT 1 FROM pf_location_bindings b WHERE b.project_id=l.project_id AND b.location_id=l.id)
    ORDER BY wanted.key`, [projectId, [...names.keys()]])).rows;
  check();
  const locationIds = new Set<string>();
  const candidates = available.flatMap<AssignmentTarget>(row => {
    const name = names.get(row.key);
    if (name === undefined) throw new PathFinderError('AUTOMATIC_ENDPOINT_LOCATION_INTEGRITY', 409);
    if (row.id === null) return [{ id: randomUUID(), name, revision: null, aliases: [] }];
    if (locationIds.has(row.id)) return [];
    locationIds.add(row.id);
    return [endpointLocationSchema.parse({ id: row.id, name: row.name, revision: row.revision, aliases: row.aliases })];
  });
  if (!candidates.length) return 0;
  const matches = await readPreparedNamedEndpointMatches(client, { projectId, current, signal,
    names: candidates.flatMap(({ name, aliases }) => [name, ...aliases]) });
  let registryRevision: string | undefined;
  let assigned = 0;
  for (const candidate of candidates) {
    check();
    const evidence = [candidate.name, ...candidate.aliases].map(name => matches.get(normalizeEndpointLocation(name)));
    if (evidence.some(match => !match || !['automatic-ready', 'missing'].includes(match.status))) continue;
    const objects = new Map(evidence.flatMap(match => match?.object ? [[match.object.objectRevisionId, match.object]] as const : []));
    if (objects.size !== 1) continue;
    const [object] = objects.values();
    if (registryRevision === undefined) {
      const row = (await client.query<{ revision: string }>(`/* automatic-location-assignment:registry */
        SELECT registry_revision::text AS revision FROM pf_project_state WHERE project_id=$1 FOR UPDATE`, [projectId])).rows[0];
      if (!row) throw new PathFinderError('MODEL_LOCATION_MATCH_STATE_REQUIRED', 409);
      registryRevision = row.revision;
      await beforeWrite();
      check();
    }
    const receipt = await confirmEndpointBindingChangeInTransaction(client, projectId, who, candidate.id, {
      schemaVersion: 'wfc.pf.endpoint-binding-write.v1', expectedRegistryRevision: registryRevision,
      expectedLocationRevision: candidate.revision, expectedHeadId: null, expectedSelectionRevision: current.selectionRevision,
      modelVersionId: current.modelVersionId, aggregateId: current.aggregateId, projectionSha256: current.projectionSha256,
      captureFrameId: current.captureFrameId, idempotencyKey: randomUUID(),
      reason: 'Automatic Find and assign From/To: unique visible prepared equipment match; approximate bottom centre.',
      location: { name: candidate.name, aliases: candidate.aliases }, mode: 'object-derived', anchorRule: ENDPOINT_ANCHOR_RULE, object,
    }, signal);
    registryRevision = receipt.registryRevision;
    assigned++;
    if (assigned === maxAssignmentsPerTransaction) break;
  }
  check();
  return assigned;
}
