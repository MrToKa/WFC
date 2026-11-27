import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { canonicalPurposeJson } from '../../shared/pathfinderPurposePolicy.js';
import type { TrayRow } from '../models/tray.js';
import { PathFinderError } from '../pathfinder/errors.js';
import { cadDesignEnabled } from './configuration.js';
import { projectTrayProfile } from './trayProfile.js';

const hash = (value: unknown) => createHash('sha256').update(canonicalPurposeJson(value)).digest('hex');
const fail = (code: string, message: string): never => { throw new PathFinderError(code, 409, message); };

export type ExportLink ={substitute_step?:boolean;project_id:string;design_id:string;route_group_id:string;tray_id:string;source_sha256:string;source_proof:unknown;projection:unknown};
export type Projection ={name:string;purpose:string|null;trayType:string|null;widthMm:number|null;heightMm:number|null;lengthMm:number|null;lengthSource:string;lengthCalculation:unknown};
export const numeric=(value:unknown):number|null=>value==null||!Number.isFinite(Number(value))?null:Number(value);
export function cadTrayProjection(row:TrayRow):Projection {
  return {name:row.name,purpose:row.purpose,trayType:row.tray_type,widthMm:numeric(row.width_mm),heightMm:numeric(row.height_mm),lengthMm:numeric(row.length_mm),
    lengthSource:row.length_source??'manual',lengthCalculation:row.length_calculation??null};
}
export function substitutePurpose(row: TrayRow): string {
  if (!row.purpose?.trim() || row.purpose.length > 500)
    return fail('CAD_ROUTE_PURPOSE_REQUIRED', 'Choose a valid Route purpose in Trays for this CAD route.');
  return row.purpose;
}

/** Keep the verified geometry source and replace only its shared catalog purpose. */
export function withExportPurpose(link: ExportLink, purpose: string) {
  const proof = link.source_proof as { source?: Record<string, unknown> };
  if (!proof?.source || hash(proof.source) !== link.source_sha256)
    return fail('CAD_ROUTE_TRAY_EXPORT_INTEGRITY', 'The saved CAD source could not be verified.');
  const source = { ...proof.source, purpose };
  return { proof: { ...proof, source }, sha: hash(source) };
}

export async function synchronizeSubstituteTrayProfile(client: PoolClient, previous: TrayRow, row: TrayRow, actorId: string) {
  if (!cadDesignEnabled()) return;
  const projection = cadTrayProjection(row);
  const before = cadTrayProjection(previous);
  if (projection.trayType === before.trayType && projection.widthMm === before.widthMm &&
      projection.heightMm === before.heightMm && projection.purpose === before.purpose) return;
  const link = (await client.query<ExportLink & { revision: number; status: string; publication: Record<string, unknown> | null }>(
    `SELECT e.*,g.revision,g.status,g.publication FROM cad_route_tray_exports e
     JOIN cad_route_groups g ON (g.project_id,g.design_id,g.id)=(e.project_id,e.design_id,e.route_group_id)
     WHERE e.project_id=$1 AND e.tray_id=$2 AND e.substitute_step FOR UPDATE OF e,g`, [row.project_id, row.id])).rows[0];
  if (!link) return;
  const purpose = substitutePurpose(row);
  const real = projectTrayProfile(row);
  const keys = [row.project_id, link.design_id, link.route_group_id];
  const { proof, sha } = withExportPurpose(link, purpose);
  const saved = link.projection as Projection;
  const shared = { ...real, purpose };
  await client.query(`UPDATE cad_route_tray_exports SET projection=$4,source_proof=$5,source_sha256=$6,updated_at=now()
    WHERE project_id=$1 AND design_id=$2 AND route_group_id=$3`, [...keys, { ...saved, ...shared }, proof, sha]);
  if (link.status === 'published' && link.publication) {
    const snapshot = link.publication.traySnapshot as { id?: string } | undefined;
    if (snapshot?.id !== row.id) return fail('CAD_ROUTE_TRAY_EXPORT_INTEGRITY', 'The published route links to a different Trays row.');
    const next = { ...link.publication, traySnapshot: { ...snapshot, ...shared }, trayExportSourceSha256: sha };
    await saveProfilePublication(client, keys, link.revision, link.publication, next, purpose, actorId);
    await client.query(`UPDATE cad_route_groups SET purpose=$4,revision_base_number=$5+1,revision=revision+1,updated_at=now()
      WHERE project_id=$1 AND design_id=$2 AND revision_of_route_id=$3 AND revision_base_number=$5`, [...keys, purpose, link.revision]);
  } else {
    await client.query(`UPDATE cad_route_groups SET purpose=$4,revision=revision+1,updated_at=now()
      WHERE project_id=$1 AND design_id=$2 AND id=$3`, [...keys, purpose]);
  }
}

export async function saveProfilePublication(client: PoolClient, keys: string[], revision: number,
  previous: Record<string, unknown>, next: Record<string, unknown>, purpose: string, actorId: string) {
  await client.query(`INSERT INTO cad_route_network_publication_history(id,project_id,design_id,route_group_id,previous_revision,
    base_artifact_id,previous_publication,publication,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [randomUUID(), ...keys, revision, previous.baseArtifactId, previous, next, actorId]);
  await client.query('UPDATE cad_route_groups SET publication=$4,purpose=$5,revision=revision+1,updated_at=now() WHERE project_id=$1 AND design_id=$2 AND id=$3',
    [...keys, next, purpose]);
}
