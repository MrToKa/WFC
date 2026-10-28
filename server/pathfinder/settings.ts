import type { PoolClient } from 'pg';
import type { EngineOptions, ProjectSettings } from './jobContracts.js';
import { PathFinderError } from './errors.js';
import { createHash } from 'node:crypto';
import { canonicalPurposeJson } from '../../shared/pathfinderPurposePolicy.js';

/** Project Details is authoritative even when an old job/client supplies different options. */
export async function projectRoutingSettings(client:PoolClient,projectId:string,requested:EngineOptions):Promise<{settings:ProjectSettings;options:EngineOptions}> {
  const row=(await client.query<{connection_gap:string;secondary_tray_length:string|null;end_connection_length:string;additional_bending_percent:string;pf_settings_revision:string;cable_layout_settings?:Record<string,unknown>|null}>(
    'SELECT connection_gap::text,secondary_tray_length::text,end_connection_length::text,additional_bending_percent::text,pf_settings_revision::text,cable_layout_settings FROM projects WHERE id=$1',[projectId])).rows[0];
  const gap=Number(row?.connection_gap);
  if (!row || !Number.isFinite(gap) || gap<=0 || gap>100) throw new PathFinderError('PROJECT_SETTINGS_INVALID',409,'Set a connection gap greater than 0 and at most 100 metres in Project Details.');
  const layout=row.cable_layout_settings;
  const layoutSha256=createHash('sha256').update(canonicalPurposeJson(layout??null)).digest('hex');
  const minimum=layout?.minFreeSpacePercent;
  const trayCapacity:ProjectSettings['trayCapacity']=layout?.autoRerouteForFreeSpace===true?{enabled:true,
    minimumFreeSpacePercent:typeof minimum==='number'&&Number.isFinite(minimum)&&minimum>=1&&minimum<=100?minimum:null,
    tolerancePercentagePoints:3,layoutSha256}:undefined;
  return {settings:{revision:row.pf_settings_revision,connectionGap:row.connection_gap,secondaryTrayLength:row.secondary_tray_length,
    endConnectionLength:row.end_connection_length,additionalBendingPercent:row.additional_bending_percent,
    routingBalance:{mode:'destination-groups-v1',layoutSha256},...(trayCapacity?{trayCapacity}:{})},options:{...requested,connectionToleranceMeters:gap}};
}

/** Preserve the existing strict C# DTO: connection gap belongs to RoutingOptions, not decimal design allowances. */
export function engineProjectSettings(settings:ProjectSettings):Pick<ProjectSettings,'revision'|'secondaryTrayLength'|'endConnectionLength'|'additionalBendingPercent'> {
  const {revision,secondaryTrayLength,endConnectionLength,additionalBendingPercent}=settings;
  return {revision,secondaryTrayLength,endConnectionLength,additionalBendingPercent};
}
