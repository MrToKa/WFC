import type { Pool } from 'pg';
import { vi } from 'vitest';
import type { EndpointBinding, EndpointBindingWrite } from '../../shared/pathfinderEndpointBindings.js';
import { geometryTraceFixture } from './geometryTraceFixtures.js';
import { buildGeometryTrace } from './geometryTraceBuilder.js';
import { createEndpointBindingRepository } from './endpointBindingRepository.js';

export const endpointFixtureId = (n: number) => `ed000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
/** Synthetic in-memory SQL protocol fixture. This is not an actual PostgreSQL test. */
export function endpointBindingFixture() {
  const f = geometryTraceFixture(), built = buildGeometryTrace(f), locationId = endpointFixtureId(1), who = { userId: f.createdBy, loginId: endpointFixtureId(2), loginExpiresAt: Date.now() + 60000 };
  const state = { exists: true, admin: true, user: true, revoked: false, commitFails: false, rollbackFails: false, prepared: true, registry: '4', selectedRevision: '1', locations: new Map<string, { id: string; name: string; revision: string }>(), aliases: new Map<string, { location_id: string; normalized_alias: string; display_alias: string }>(), bindings: new Map<string, EndpointBinding>(), heads: new Map<string, string>(), commands: new Map<string, { kind: string; request_sha256: string; request: unknown; receipt: unknown }>(), legacy: null as null | { model_version_id: string; revision: string; point: [number, number, number]; object_id: string | null; derivation: string }, observations: new Map<string, { id: string; record_sha256: string; record: unknown }>(), decisions: new Map<string, { id: string; input_sha256: string; record_sha256: string; record: unknown }>(), cables: [{ id: endpointFixtureId(10), from_location: 'EQUIPMENT', to_location: ' Alias ' }, { id: endpointFixtureId(11), from_location: 'Alias', to_location: 'equipment' }, { id: endpointFixtureId(12), from_location: null, to_location: 'Other' }] as { id: string; from_location: string | null; to_location: string | null }[], failInsert: false };
  let snapshot: typeof state | null = null;
  const queries: string[] = [], parameters: unknown[][] = [], release = vi.fn();
  const query = vi.fn(async (sql: string, args: unknown[] = []): Promise<{ rows: Record<string, unknown>[] }> => {
    queries.push(sql); parameters.push(args); const p = args as string[];
    if (sql === 'BEGIN') { snapshot = structuredClone(state); return { rows: [] }; }
    if (sql === 'COMMIT') { if (state.commitFails) throw Error('private socket detail'); snapshot = null; return { rows: [] }; }
    if (sql === 'ROLLBACK') { if (state.rollbackFails) throw Error('private rollback detail'); if (snapshot) Object.assign(state, snapshot); snapshot = null; return { rows: [] }; }
    if (sql.startsWith('SET LOCAL') || sql.startsWith('INSERT INTO viewer_login_bindings')) return { rows: [] };
    if (sql.startsWith('SELECT id FROM projects')) return { rows: state.exists ? [{ id: f.aggregate.projectId }] : [] };
    if (sql.startsWith('SELECT is_admin')) return { rows: state.user ? [{ is_admin: state.admin }] : [] };
    if (sql.startsWith('SELECT user_id,expires_at')) return { rows: [{ user_id: who.userId, expires_at: new Date(who.loginExpiresAt), revoked_at: state.revoked ? new Date() : null }] };
    if (sql.startsWith('SELECT registry_revision')) return { rows: [{ revision: state.registry }] };
    if (sql.startsWith('SELECT active_model_version_id')) return { rows: [{ active_model_version_id: f.aggregate.modelVersionId, selection_revision: state.selectedRevision }] };
    if (sql.startsWith('SELECT state,health,content_fingerprint')) return { rows: [{ state: 'ready', health: 'healthy', content_fingerprint: f.aggregate.contentFingerprint }] };
    if (sql.startsWith('SELECT p.current_aggregate_id')) return { rows: state.prepared ? [{ current_aggregate_id: f.aggregate.id, current_artifact_id: f.aggregate.artifactId, geometry_revision: f.aggregate.geometryRevision, manifest: f.aggregate, snapshot_sha256: f.aggregate.projection.sha256 }] : [] };
    if (sql.startsWith('SELECT id FROM pf_preparation_aggregates') || sql.startsWith('SELECT id FROM pf_artifacts')) return { rows: [{ id: p[1] }] };
    if (sql.startsWith('SELECT id,manifest FROM pf_geometry_trace_sets')) return { rows: [{ id: f.traceId, manifest: built.manifest }] };
    if (sql.startsWith('SELECT o.record')) { const record = built.records.find(r => r.id === p[2] && r.traceId === p[1]); return { rows: record ? [{ record, record_sha256: built.summaries.find(s => s.id === record.id)!.recordSha256, manifest: built.manifest }] : [] }; }
    if (sql.startsWith('SELECT id FROM pf_geometry_object_revisions')) return { rows: built.records.some(r => r.geometry.role === 'object' && r.geometry.equipmentAnchor) ? [{ id: built.records[2].id }] : [] };
    if (sql.startsWith('SELECT id,from_location')) return { rows: state.cables };
    if (sql.startsWith('SELECT id,name,revision')) return { rows: state.locations.has(p[1]) ? [state.locations.get(p[1])!] : [] };
    if (sql.startsWith('SELECT revision::text FROM pf_locations')) return { rows: state.locations.has(p[1]) ? [{ revision: state.locations.get(p[1])!.revision }] : [] };
    if (sql.startsWith('SELECT display_alias')) return { rows: [...state.aliases.values()].filter(a => a.location_id === p[1]) };
    if (sql.startsWith('SELECT location_id FROM pf_location_aliases')) return { rows: [...state.aliases.values()].filter(a => a.location_id !== p[1] && (args[2] as string[]).includes(a.normalized_alias)) };
    if (sql.startsWith('SELECT h.binding_id')) { const binding = state.bindings.get(state.heads.get(p[1]) ?? ''); return { rows: binding ? [{ binding_id: binding.id, binding_revision: binding.bindingRevision, record_sha256: binding.contentSha256, record: binding }] : [] }; }
    if (sql.startsWith('SELECT h.location_id')) return { rows: [...state.heads.entries()].map(([id, bindingId]) => { const b = state.bindings.get(bindingId)!; return { location_id: id, location_revision: state.locations.get(id)!.revision, binding_id: b.id, binding_revision: b.bindingRevision, record_sha256: b.contentSha256, record: b }; }) };
    if (sql.startsWith('SELECT kind,request_sha256')) return { rows: state.commands.has(p[1] + ':' + p[2]) ? [state.commands.get(p[1] + ':' + p[2])!] : [] };
    if (sql.startsWith('INSERT INTO pf_endpoint_binding_commands')) { state.commands.set(p[1] + ':' + p[2], { kind: p[3], request_sha256: p[4], request: args[5], receipt: args[6] }); return { rows: [] }; }
    if (sql.startsWith('SELECT model_version_id,revision')) return { rows: state.legacy ? [state.legacy] : [] };
    if (sql.startsWith('SELECT row_to_json')) return { rows: state.legacy ? [{ row_text: JSON.stringify(state.legacy) }] : [] };
    if (sql.startsWith('SELECT id,record_sha256,record FROM pf_endpoint_legacy')) return { rows: [...state.observations.values()] };
    if (sql.startsWith('INSERT INTO pf_endpoint_legacy_observations')) { state.observations.set(p[0], { id: p[0], record_sha256: p[5], record: args[6] }); return { rows: [] }; }
    if (sql.startsWith('INSERT INTO pf_locations')) { state.locations.set(p[0], { id: p[0], name: p[2], revision: p[3] }); return { rows: [] }; }
    if (sql.startsWith('UPDATE pf_locations')) { state.locations.set(p[1], { id: p[1], name: p[2], revision: p[3] }); return { rows: [] }; }
    if (sql.startsWith('DELETE FROM pf_location_aliases')) { for (const [key, value] of state.aliases) if (value.location_id === p[1]) state.aliases.delete(key); return { rows: [] }; }
    if (sql.startsWith('INSERT INTO pf_location_aliases')) { state.aliases.set(p[1], { location_id: p[3], normalized_alias: p[1], display_alias: p[2] }); return { rows: [] }; }
    if (sql.startsWith('INSERT INTO pf_endpoint_binding_revisions')) { if (state.failInsert) throw Error('synthetic insertion failure'); state.bindings.set(p[0], args[9] as EndpointBinding); return { rows: [] }; }
    if (sql.startsWith('INSERT INTO pf_endpoint_binding_heads')) { state.heads.set(p[1], p[2]); return { rows: [] }; }
    if (sql.startsWith('UPDATE pf_project_state')) { state.registry = p[1]; return { rows: [] }; }
    if (sql.startsWith('SELECT count(*)')) return { rows: [{ count: String(state.locations.size) }] };
    if (sql.startsWith('SELECT id FROM pf_locations')) return { rows: [...state.locations.values()].slice(Number(args[2]), Number(args[2]) + Number(args[1])) };
    if (sql.startsWith('SELECT record FROM pf_endpoint_binding_revisions')) { if (sql.includes('ORDER BY')) return { rows: [...state.bindings.values()].filter(b => b.locationId === p[1] && (args[2] === null || BigInt(b.bindingRevision) < BigInt(p[2]))).sort((a, b) => Number(BigInt(b.bindingRevision) - BigInt(a.bindingRevision))).slice(0, Number(args[3])).map(record => ({ record })) }; return { rows: state.bindings.has(p[1]) ? [{ record: state.bindings.get(p[1]) }] : [] }; }
    if (sql.startsWith('SELECT record,record_sha256 FROM pf_endpoint_migration_decisions')) { const result = sql.includes('input_sha256') ? [...state.decisions.values()].find(d => d.input_sha256 === p[1]) : state.decisions.get(p[1]); return { rows: result ? [result] : [] }; }
    if (sql.startsWith('INSERT INTO pf_endpoint_migration_decisions')) { state.decisions.set(p[0], { id: p[0], input_sha256: p[5], record_sha256: p[6], record: args[7] }); return { rows: [] }; }
    throw Error('Unexpected mocked SQL: ' + sql.slice(0, 110));
  });
  const client = { query, release }, pool = { connect: vi.fn(async () => client) } as unknown as Pool, repo = createEndpointBindingRepository(pool);
  let commandId = 100;
  const command = (): EndpointBindingWrite => ({ schemaVersion: 'wfc.pf.endpoint-binding-write.v1', expectedRegistryRevision: state.registry, expectedLocationRevision: state.locations.get(locationId)?.revision ?? null, expectedHeadId: state.heads.get(locationId) ?? null, expectedSelectionRevision: state.selectedRevision, modelVersionId: f.aggregate.modelVersionId, aggregateId: f.aggregate.id, projectionSha256: f.aggregate.projection.sha256, captureFrameId: f.aggregate.coordinateFrameId, idempotencyKey: endpointFixtureId(commandId++), reason: 'Synthetic explicit endpoint confirmation', location: { name: 'Equipment', aliases: ['Alias'] }, mode: 'fixed-world', pointProjectMetres: [2, 3, 4], derivation: 'manual-world-point', provenanceObject: null });
  return { f, built, locationId, who, state, queries, parameters, query, release, client, pool, repo, command };
}
