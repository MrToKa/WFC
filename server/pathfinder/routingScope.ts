import type { PoolClient } from 'pg';
import { z } from 'zod';
import { policyHashSchema, policyRevisionSchema } from '../../shared/pathfinderPurposePolicy.js';
import { PathFinderError } from './errors.js';
import { readRoutingPolicyScope } from './purposePolicy.js';
import { hasCurrentEndpointCalculationProvenance } from './endpointCalculationProvenance.js';
import { hasCurrentComparisonCalculationProvenance } from './comparisonCalculationProvenance.js';
import { createHash } from 'node:crypto';
import { verifyEngineIdentity } from '../../shared/pathfinderEngineIdentity.js';

/** This projection deliberately cannot carry drawing or private full-source facts. */
export const routingScopeSchema = z.object({
  catalogRevision: policyRevisionSchema, routingContentSha256: policyHashSchema,
  routingPolicyRevision: policyRevisionSchema, routingPolicySha256: policyHashSchema,
}).strict();
export type RoutingScope = z.infer<typeof routingScopeSchema>;

/** R3 owns the producer. No R2 API may bless an old artifact by attaching current tokens. */
export async function initializeArtifactRoutingScope(client: PoolClient): Promise<void> {
  await client.query(`CREATE TABLE IF NOT EXISTS pf_artifact_routing_scopes (
    project_id UUID NOT NULL, artifact_id UUID NOT NULL,
    producer_version TEXT NOT NULL CHECK(producer_version='pathfinder.catalog-preparation.v1'),
    routing_scope JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(project_id,artifact_id),
    FOREIGN KEY(project_id,artifact_id) REFERENCES pf_artifacts(project_id,id) ON DELETE CASCADE
  );
  CREATE OR REPLACE FUNCTION protect_pf_artifact_routing_scope() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM pf_artifacts WHERE project_id=OLD.project_id AND id=OLD.artifact_id) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'Artifact routing scope is immutable'; END $$;
  DROP TRIGGER IF EXISTS pf_artifact_routing_scope_immutable ON pf_artifact_routing_scopes;
  CREATE TRIGGER pf_artifact_routing_scope_immutable BEFORE UPDATE OR DELETE ON pf_artifact_routing_scopes
    FOR EACH ROW EXECUTE FUNCTION protect_pf_artifact_routing_scope();`);
}

export function equalRoutingScope(a: RoutingScope, b: RoutingScope): boolean {
  return a.catalogRevision === b.catalogRevision && a.routingContentSha256 === b.routingContentSha256
    && a.routingPolicyRevision === b.routingPolicyRevision && a.routingPolicySha256 === b.routingPolicySha256;
}

/** Called under the normal project mutex; current policy locks stay held until commit. */
export async function requirePreparedRoutingScope(client: PoolClient, projectId: string, artifactId: string): Promise<RoutingScope> {
  const current = routingScopeSchema.parse(await readRoutingPolicyScope(client, projectId));
  const row = (await client.query<{producer_version: string; routing_scope: unknown}>(
    'SELECT producer_version,routing_scope FROM pf_artifact_routing_scopes WHERE project_id=$1 AND artifact_id=$2 FOR SHARE',
    [projectId, artifactId])).rows[0];
  const prepared = routingScopeSchema.safeParse(row?.routing_scope);
  if (!row || row.producer_version !== 'pathfinder.catalog-preparation.v1' || !prepared.success || !equalRoutingScope(current, prepared.data))
    throw new PathFinderError('ROUTING_PREPARATION_REQUIRED', 409,
      'Prepare the project network against the current tray catalog and routing permissions before calculating. Existing diagnostic snapshots remain available for Path lookup.');
  return current;
}

/** Historical v1 job inputs never acquire current permissions through a cast or replay. */
export function requireVersionedCalculationScope(value: unknown): void {
  const input = value as {schemaVersion?: unknown; routing?: unknown} | null;
  if (!input || !['pathfinder.dependencies.v2', 'pathfinder.dependencies.v3', 'pathfinder.dependencies.v4', 'pathfinder.dependencies.v5'].includes(String(input.schemaVersion)) || !routingScopeSchema.safeParse(input.routing).success)
    throw new PathFinderError('ROUTING_PREPARATION_REQUIRED', 409, 'This calculation predates catalog routing permissions. Prepare and calculate a fresh proposal.');
  if (!hasCurrentEndpointCalculationProvenance(value))
    throw new PathFinderError('ENDPOINT_BINDING_UPGRADE_REQUIRED', 409, 'Confirm current shared endpoint bindings, then calculate and review a fresh proposal. Historical endpoint values do not authorize new calculations.');
  if (!hasCurrentComparisonCalculationProvenance(value))
    throw new PathFinderError('COMPARISON_UPGRADE_REQUIRED', 409, 'This proposal predates revision comparison provenance. Calculate and review a fresh proposal against the current prepared model and comparison decisions.');
  if(input.schemaVersion!=='pathfinder.dependencies.v5'||!verifyEngineIdentity((value as {engineIdentity?:unknown}).engineIdentity,
    text=>createHash('sha256').update(text).digest('hex')))
    throw new PathFinderError('ENGINE_IDENTITY_UPGRADE_REQUIRED',409,'This proposal predates actual calculation implementation provenance. Calculate and review a fresh proposal with the current engine.');
}
