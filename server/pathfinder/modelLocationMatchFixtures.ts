import { endpointBindingFixture, endpointFixtureId as id } from './endpointBindingFixtures.js';
import { createModelLocationMatchRepository } from './modelLocationMatch.js';
import type { ModelLocationMatchAssign } from '../../shared/pathfinderModelLocationMatch.js';
import { normalizeEndpointLocation } from '../../shared/pathfinderEndpointBindings.js';

/** Synthetic SQL protocol fixture; production PostgreSQL remains a separate qualification. */
export async function modelLocationMatchFixture() {
  const f = endpointBindingFixture(), original = f.query.getMockImplementation()!;
  f.query.mockImplementation(async (sql: string, args: unknown[] = []) => {
    const p = args as string[];
    if (sql.startsWith('BEGIN ISOLATION')) return original('BEGIN', args);
    if (sql.startsWith('/* model-location-match:registry */')) return { rows: [{ revision: f.state.registry }] };
    if (sql.startsWith('/* model-location-match:names */')) return { rows: [...new Set(f.state.cables.flatMap(c => [c.from_location, c.to_location]).filter((n): n is string => n !== null && n.trim() !== ''))].sort().map(name => ({ name })) };
    if (sql.startsWith('/* model-location-match:location */')) {
      const alias = f.state.aliases.get(p[1]), location = alias && f.state.locations.get(alias.location_id);
      return { rows: location ? [{ ...location, binding_id: f.state.heads.get(location.id) ?? null, has_legacy: f.state.legacy !== null }] : [] };
    }
    if (sql.startsWith('/* model-location-match:aliases */')) return { rows: [...f.state.aliases.values()].filter(a => a.location_id === p[1]) };
    if (sql.startsWith('/* model-location-match:head */')) return { rows: f.state.bindings.has(p[1]) ? [{ record: f.state.bindings.get(p[1]) }] : [] };
    if (sql.startsWith('/* model-location-match:replay */')) return { rows: f.state.commands.has(p[1] + ':' + p[2]) ? [f.state.commands.get(p[1] + ':' + p[2])!] : [] };
    if (sql.startsWith('/* model-location-match:store */')) {
      f.state.commands.set(p[1] + ':' + p[2], { kind: 'confirm', request_sha256: p[3], request: args[4], receipt: args[5] }); return { rows: [] };
    }
    if (sql.startsWith('/* model-location-match:display */')) {
      const command = f.state.commands.get(p[1] + ':' + p[2]);
      return { rows: command ? [{ ...command, actor_id: p[1], idempotency_key: p[2] }] : [] };
    }
    return original(sql, args);
  });
  const repo = createModelLocationMatchRepository(f.pool), projectId = f.f.aggregate.projectId;
  const context = await repo.context(projectId, f.who);
  const command = (): ModelLocationMatchAssign => ({ schemaVersion: 'wfc.pf.model-location-match-assign.v1', current: context.current,
    namesSha256: context.namesSha256, expectedRegistryRevision: f.state.registry, idempotencyKey: id(700), names: context.names,
    scan: { matchingPolicyVersion: 'wfc.pf.project-exact-candidates.v3', visibilityScope: { schemaVersion: 'wfc.pf.sdk-display-visibility.v1', basis: 'sdk-display-before-pf-appearance', contentSha256: 'b'.repeat(64) },
      indexedObjectCount: 900, propertyScan: { attemptedObjectCount: 900, returnedObjectCount: 900, omittedObjectCount: 0, complete: true }, complete: true,
      candidates: context.names.map((name, i) => ({ objectId: i + 1, name: 'SDK ' + name, matchedNames: [name], bounds: { minimum: [1, 2, 3], maximum: [3, 4, 5] }, bottomCentre: [2, 3, 3] })) } });
  const resolved = (name: string) => f.state.aliases.get(normalizeEndpointLocation(name))!.location_id;
  return { ...f, repo, projectId, context, command, resolved };
}
