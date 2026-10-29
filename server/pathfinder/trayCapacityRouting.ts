import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { canonicalPurposeJson, normalizeCatalogKey } from '../../shared/pathfinderPurposePolicy.js';
import { DEFAULT_DRAWING_MODES } from '../../shared/pathfinderDrawingPolicy.js';
import { AUTOMATIC_PAIR_LIMITS, automaticPairMandateHashInput, automaticPairMandateSchema } from '../../shared/pathfinderAutomaticPair.js';
import { assessTrayCapacity, effectiveTrayCapacityMinimum, TRAY_CAPACITY_DIAGNOSTICS_VERSION,
  TRAY_CAPACITY_TOLERANCE_PERCENTAGE_POINTS, trayCapacityDiagnosticsSchema,
  type TrayCapacityDiagnostics } from '../../shared/pathfinderTrayCapacity.js';
import { drawingRoutingContainsTray, type TrayDrawingPlacementData } from '../../shared/trayDrawingInputs.js';
import { trayBundleOverrideSchema } from '../../shared/trayDrawingSnapshot.js';
import { mapProjectRow, type ProjectRow } from '../models/project.js';
import { mapTrayRow, type TrayRow } from '../models/tray.js';
import { mapCableRow, type CableWithTypeRow, type PublicCable } from '../models/cable.js';
import { readDrawingPolicy } from './drawingPolicy.js';
import { normalizeLocation } from './matching.js';

const LIMIT = 100000;
const ASSESSMENT_CODES = 128;
const ASSESSMENT_CODE_LENGTH = 256;
const COST_TRAYS = 4096;
const digest = (value: unknown) => createHash('sha256').update(canonicalPurposeJson(value)).digest('hex');
const routeKey = (value: string) => value.normalize('NFC').trim().replace(/^\/+/, '').trim().toUpperCase();
const routeCode = (value: string) => '/' + routeKey(value);
const logical = (value: string | null) => value == null ? '' : normalizeLocation(value);
const groupKey = (cable: Pick<PublicCable, 'fromLocation' | 'toLocation' | 'mto'>) =>
  logical(cable.fromLocation) && logical(cable.toLocation)
    ? canonicalPurposeJson([logical(cable.fromLocation), logical(cable.toLocation), cable.mto]) : null;
const destinationKey = (cable: Pick<PublicCable, 'toLocation' | 'mto'>) => logical(cable.toLocation)
  ? canonicalPurposeJson([logical(cable.toLocation), cable.mto]) : null;
function orderedCodes(routing: string | string[] | null): string[] {
  const values = (Array.isArray(routing) ? routing : routing?.split('/') ?? []).map(routeCode)
    .filter(value => value !== '/' && value !== '/SECONDARY');
  return values.filter((value, index) => index === 0 || value !== values[index - 1]);
}
function commonSuffix(left: string[], right: string[]): string[] {
  let length = 0; while (length < left.length && length < right.length && left[left.length - length - 1] === right[right.length - length - 1]) length++;
  return length ? left.slice(-length) : [];
}
const unionRouting = (current: string | null, proposed: string | null): string | null => {
  const codes = [...new Set([current, proposed].flatMap(value => value?.split('/').map(routeKey).filter(Boolean) ?? []))];
  return codes.length ? codes.map(routeCode).join('') : null;
};

type PolicyIssue = TrayCapacityDiagnostics['policyIssue'];
export type TrayCapacityRoutingContext = {
  policy: { enabled: boolean; minimumFreeSpacePercent: number | null; effectiveMinimumFreeSpacePercent: number | null;
    tolerancePercentagePoints: 3; policyIssue?: PolicyIssue };
  minimumFreeSpacePercent: number | null; effectiveMinimumFreeSpacePercent: number | null;
  tolerancePercentagePoints: 3; occupancySha256: string; groupKey: string; groupCableCount: number; groupCableIds: string[];
  restrictionEnabled: boolean; routeCostMultipliers: Array<{ routeCode: string; multiplier: number }>;
  sameToGroupKey: string; sameToGroupCableIds: string[]; preferredCorridors: string[][];
  settledSource: { id: string; proposalHash: string; cableId: string; dependencies: unknown; result: unknown } | null;
  evaluate: (routeCodes: string[]) => TrayCapacityDiagnostics;
  score: (routeCodes: string[]) => { assessment: TrayCapacityDiagnostics; bottleneckOccupiedPercent: number | null;
    meanOccupiedPercent: number | null; knownTrayCount: number; unknownTrayCount: number; sharedSuffixRouteCodes: string[] };
};

/** Project-locked caller owns admission/commit. This reader starts no transaction and writes no state.
 * This job's finished proposals reserve their planned routes alongside stored routes
 * until the normal writer has actually replaced or cleared the stored route.
 */
export async function readTrayCapacityRouting(client: PoolClient, input: {
  projectId: string; jobId: string; cableId: string;
}): Promise<TrayCapacityRoutingContext | null> {
  const { projectId, jobId, cableId } = input;
  const row = (await client.query<ProjectRow>('/* tray-capacity:project */ SELECT p.* FROM projects p WHERE p.id=$1', [projectId])).rows[0];
  if (!row) return null;
  const restrictionEnabled = row.cable_layout_settings?.autoRerouteForFreeSpace === true;
  const project = mapProjectRow(row), minimum = project.cableLayout.minFreeSpacePercent;
  const effectiveMinimum = effectiveTrayCapacityMinimum(minimum);
  const trayRows = (await client.query<TrayRow>('/* tray-capacity:trays */ SELECT * FROM trays WHERE project_id=$1 ORDER BY name,id LIMIT 100001', [projectId])).rows;
  const cableRows = (await client.query<CableWithTypeRow & { cable_write_revision: string }>(`/* tray-capacity:cables */ SELECT c.*,c.cable_write_revision::text,
    ct.name AS type_name,ct.purpose AS type_purpose,ct.diameter_mm AS type_diameter_mm,ct.weight_kg_per_m AS type_weight_kg_per_m
    FROM cables c JOIN cable_types ct ON ct.id=c.cable_type_id AND ct.project_id=c.project_id
    WHERE c.project_id=$1 ORDER BY c.cable_id,c.id LIMIT 100001`, [projectId])).rows;
  const trays = trayRows.slice(0, LIMIT).map(mapTrayRow), cables = cableRows.slice(0, LIMIT).map(mapCableRow);
  const source = cables.find(value => value.id === cableId), sourceKey = source ? groupKey(source) : null;
  const toKey = source ? destinationKey(source) : null;
  const toGroup = toKey ? cables.filter(value => destinationKey(value) === toKey) : [];
  const group = source ? cables.filter(value => value.id === cableId || sourceKey !== null && groupKey(value) === sourceKey) : [];
  const groupIds = new Set(group.map(value => value.id));
  const fallbackGroupIds = group.length ? group.map(value => value.id) : [cableId];
  const groups = new Map<string, PublicCable[]>();
  for (const cable of cables) {
    const key = groupKey(cable); if (!key) continue;
    const previous = groups.get(key); if (previous) previous.push(cable); else groups.set(key, [cable]);
  }
  const completed = (await client.query<{ cable_id: string; status: string; route_codes: unknown; cable_inputs: unknown }>(`/* tray-capacity:completed */
    SELECT p.cable_id,p.status,p.dependencies->'cableInputs' AS cable_inputs,
      CASE WHEN octet_length((p.result->'route'->'routeCodes')::text)<=262144 THEN p.result->'route'->'routeCodes' ELSE NULL END AS route_codes
    FROM pf_proposals p
    JOIN pf_job_items i ON i.project_id=p.project_id AND i.job_id=p.job_id AND i.cable_id=p.cable_id
    WHERE p.project_id=$1 AND p.job_id=$2 AND i.state='complete' AND p.status IN ('calculated','no_path')
      AND i.status=p.status AND (p.status='no_path' OR p.result->'route'->>'success'='true')
    ORDER BY p.created_at,p.id LIMIT 100001`, [projectId, jobId])).rows;
  // A retained, admitted automatic-pair mandate is a planning indication only.
  // It cannot authorize a write, renew a login, or override the normal writer's checks.
  const mandateRows = (await client.query<{ project_id: string; job_id: string; cable_id: string; id: string; actor_id: string;
    login_id: string; record_sha256: string; record: unknown }>(`/* tray-capacity:mandates */
    SELECT project_id,job_id,cable_id,id,actor_id,login_id,record_sha256,
      CASE WHEN octet_length(record::text)<=65536 THEN record ELSE NULL END AS record
    FROM pf_automatic_pair_mandates WHERE project_id=$1 AND job_id=$2 ORDER BY cable_id LIMIT 10001`, [projectId, jobId])).rows;
  const currentRevisions = new Map(cableRows.map(value => [value.id, value.cable_write_revision]));
  const replaceableRouting = new Set<string>();
  for (const row of mandateRows.slice(0, AUTOMATIC_PAIR_LIMITS.cables)) {
    const parsed = automaticPairMandateSchema.safeParse(row.record); if (!parsed.success) continue;
    const mandate = parsed.data;
    if (mandate.projectId !== projectId || mandate.jobId !== jobId || mandate.projectId !== row.project_id || mandate.jobId !== row.job_id
      || mandate.cableId !== row.cable_id || mandate.id !== row.id || mandate.actorId !== row.actor_id || mandate.loginId !== row.login_id
      || mandate.contentSha256 !== row.record_sha256 || digest(automaticPairMandateHashInput(mandate)) !== mandate.contentSha256
      || currentRevisions.get(mandate.cableId) !== mandate.cableWriteRevision) continue;
    replaceableRouting.add(mandate.cableId);
  }
  const occupancy = new Map(cables.map(value => [value.id, { ...value }]));
  const originalRouting = new Map(cables.map(value => [value.id, value.routing]));
  const observedPaths = new Map<string, string[]>();
  for (const member of toGroup) {
    const key = groupKey(member), codes = orderedCodes(member.routing);
    if (key && !observedPaths.has(key) && codes.length && codes.length <= ASSESSMENT_CODES && codes.every(code => code.length <= ASSESSMENT_CODE_LENGTH)) observedPaths.set(key, codes);
  }
  for (const proposal of completed.slice(0, LIMIT)) {
    if (proposal.status !== 'no_path' && proposal.status !== 'calculated') continue;
    const donor = occupancy.get(proposal.cable_id); if (!donor) continue;
    const dependency = proposal.cable_inputs as { fromLocation?: unknown; toLocation?: unknown; mto?: unknown } | null;
    if (dependency && (dependency.mto !== donor.mto
      || typeof dependency.fromLocation !== 'string' || logical(dependency.fromLocation) !== logical(donor.fromLocation)
      || typeof dependency.toLocation !== 'string' || logical(dependency.toLocation) !== logical(donor.toLocation))) continue;
    const rawCodes = proposal.route_codes;
    if (proposal.status === 'calculated' && (!Array.isArray(rawCodes) || !rawCodes.every(value => typeof value === 'string'))) continue;
    const routing = proposal.status === 'no_path' ? null : (rawCodes as string[]).map(routeCode).join('');
    const key = groupKey(donor), recipients = key ? groups.get(key) ?? [donor] : [donor];
    if (key && destinationKey(donor) === toKey) {
      const codes = proposal.status === 'calculated' ? orderedCodes(rawCodes as string[]) : [];
      if (codes.length && codes.length <= ASSESSMENT_CODES && codes.every(code => code.length <= ASSESSMENT_CODE_LENGTH)) observedPaths.set(key, codes);
      else if (recipients.every(value => replaceableRouting.has(value.id))) observedPaths.delete(key);
    }
    for (const recipient of recipients) {
      // A mandate permits planning replacement of the active group, but is not
      // evidence that another group's writer committed. Retain its stored route
      // as well as its proposal, deduplicated per cable and tray.
      occupancy.get(recipient.id)!.routing = unionRouting(originalRouting.get(recipient.id) ?? null, routing);
    }
  }
  // Only observed paths with different From legs can establish a shared To corridor.
  // A same-destination member never inherits another member's unverified From prefix.
  const observations = [...observedPaths.entries()].slice(-64), suffixes = new Map<string, string[]>();
  for (let left = 0; left < observations.length; left++) for (let right = left + 1; right < observations.length; right++) {
    const suffix = commonSuffix(observations[left][1], observations[right][1]);
    if (suffix.length) suffixes.set(canonicalPurposeJson(suffix), suffix);
  }
  const preferredCorridors: string[][] = [];
  for (const suffix of [...suffixes.values()].sort((a, b) => b.length - a.length
    || (canonicalPurposeJson(a) < canonicalPurposeJson(b) ? -1 : canonicalPurposeJson(a) > canonicalPurposeJson(b) ? 1 : 0))) {
    if (!preferredCorridors.some(existing => commonSuffix(existing, suffix).length === suffix.length)) preferredCorridors.push(suffix);
    if (preferredCorridors.length === 16) break;
  }
  const settledRows = (await client.query<{ id: string; cable_id: string; proposal_hash: string; dependencies: unknown; result: unknown }>(`/* tray-capacity:settled-source */
    SELECT p.id,p.cable_id,p.proposal_hash,p.dependencies,
      CASE WHEN octet_length(p.result::text)<=8388608 THEN p.result ELSE NULL END AS result
    FROM pf_proposals p JOIN pf_job_items i ON i.project_id=p.project_id AND i.job_id=p.job_id AND i.cable_id=p.cable_id
    WHERE p.project_id=$1 AND p.job_id=$2 AND p.cable_id=ANY($3::uuid[])
      AND i.state='complete' AND i.status=p.status
      AND ((p.status='calculated' AND p.result->'route'->>'success'='true')
        OR (p.status='no_path' AND p.result->'trayCapacity'->>'outcome'='no-capacity'
          AND jsonb_typeof(p.result->'trayCapacity'->'query')='object'))
    ORDER BY p.created_at DESC,p.id DESC LIMIT 1`, [projectId, jobId, fallbackGroupIds])).rows;
  const settled = settledRows[0];
  const settledSource = settled?.result && groupIds.has(settled.cable_id)
    ? { id: settled.id, proposalHash: settled.proposal_hash, cableId: settled.cable_id, dependencies: settled.dependencies, result: settled.result } : null;
  const overrideRows = (await client.query<{ tray_id: string; revision: string; value: unknown }>(
    '/* tray-capacity:overrides */ SELECT tray_id,revision::text,value FROM pf_tray_drawing_settings WHERE project_id=$1 ORDER BY tray_id LIMIT 100001', [projectId])).rows;
  const materialRows = (await client.query<{ id: string; tray_type: string; rung_height_mm: string | number | null }>(`/* tray-capacity:materials */
    SELECT id,tray_type,rung_height_mm FROM material_trays
    WHERE lower(trim(tray_type)) IN (SELECT DISTINCT lower(trim(tray_type)) FROM trays WHERE project_id=$1)
    ORDER BY id LIMIT 100001`, [projectId])).rows;
  const drawingPolicy = await readDrawingPolicy(client, projectId);
  const policyIssue: PolicyIssue = trayRows.length > COST_TRAYS || cableRows.length > LIMIT || completed.length > LIMIT || mandateRows.length > AUTOMATIC_PAIR_LIMITS.cables
    || overrideRows.length > LIMIT || materialRows.length > LIMIT ? 'CAPACITY_INPUT_LIMIT'
    : !source ? 'CAPACITY_GROUP_UNAVAILABLE' : restrictionEnabled && effectiveMinimum === null ? 'CAPACITY_MINIMUM_REQUIRED' : undefined;
  const occupancySha256 = digest({ projectId, layout: project.cableLayout,
    cables: cableRows.slice(0, LIMIT).map(value => ({ id: value.id, cableTypeId: value.cable_type_id,
      diameter: value.type_diameter_mm, purpose: value.type_purpose, mto: value.mto, from: value.from_location, to: value.to_location,
      routing: groupIds.has(value.id) ? null : occupancy.get(value.id)?.routing ?? null })),
    // Corridor affinity selects a native query; it is not physical occupancy.
    // In particular an owned no_path completion may remove an observation without
    // changing the other cables that must be reserved while clearing this group.
    // Business-write revisions and proposal/mandate provenance do not change
    // placement when the effective physical routing and cable data are equal.
    // Hash the mapped placement facts explicitly. Raw PostgreSQL tray rows also
    // contain Date objects and audit metadata, neither of which belongs to this
    // strict JSON-domain physical identity. Length and grounding-weight settings
    // are not consumed by the drawing placement/capacity calculation.
    group: fallbackGroupIds, trays: trays.map(tray => ({ id: tray.id, name: tray.name, type: tray.type, purpose: tray.purpose,
      widthMm: tray.widthMm, heightMm: tray.heightMm, useTrefoilClamps: tray.useTrefoilClamps })),
    overrides: overrideRows, materialRows, drawingPolicy });
  const byCode = new Map<string, typeof trays>();
  for (const tray of trays) { const key = routeKey(tray.name), old = byCode.get(key); if (old) old.push(tray); else byCode.set(key, [tray]); }
  const overrides = new Map(overrideRows.map(value => [value.tray_id, value.value]));
  const cableList = [...occupancy.values()].filter(value => !groupIds.has(value.id) || !replaceableRouting.has(value.id));
  const evaluated = new Map<string, TrayCapacityDiagnostics['trays'][number]>();
  const assess = (code: string): TrayCapacityDiagnostics['trays'][number] => {
    const known = evaluated.get(code); if (known) return known;
    const matches = byCode.get(routeKey(code));
    if (policyIssue || !matches || matches.length !== 1) {
      const value = { routeCode: code, freeSpacePercent: null, status: 'unavailable' as const,
        occupancyPercent: null,
        diagnosticCodes: [policyIssue ?? (matches ? 'CAPACITY_TRAY_AMBIGUOUS' : 'CAPACITY_TRAY_NOT_FOUND')] };
      evaluated.set(code, value); return value;
    }
    const tray = matches[0], onTray = [...new Map([...cableList.filter(value => drawingRoutingContainsTray(value.routing, tray.name)), ...group]
      .map(value => [value.id, value])).values()]
      .sort((a, b) => a.cableId - b.cableId || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const materials = materialRows.filter(value => value.tray_type.trim().toLowerCase() === (tray.type ?? '').trim().toLowerCase());
    const purpose = tray.purpose ? normalizeCatalogKey(tray.purpose) : null;
    const modes = drawingPolicy.rules.find(value => value.purposeKey === purpose)?.categoryModes ?? { ...DEFAULT_DRAWING_MODES };
    const override = trayBundleOverrideSchema.nullable().safeParse(overrides.get(tray.id) ?? null);
    const data: TrayDrawingPlacementData = { project, tray, trayCables: onTray,
      materialTrays: materials.slice(0, 1).map(value => ({ id: value.id, type: value.tray_type,
        rungHeightMm: value.rung_height_mm === null ? null : Number(value.rung_height_mm) })) };
    const value = { routeCode: code, ...assessTrayCapacity({ data, override: override.success ? override.data : null, categoryModes: modes,
      minimumFreeSpacePercent: minimum, restrictionEnabled,
      ...(materials.length > 1 ? { unavailableDiagnostic: 'DRAWING_MATERIAL_AMBIGUOUS' }
        : !override.success ? { unavailableDiagnostic: 'CAPACITY_OVERRIDE_INVALID' } : {}) }) };
    evaluated.set(code, value); return value;
  };
  // The first other-From path can seed a soft destination affinity before two
  // paths establish a proven common suffix. These weights never copy its feeder
  // geometry or claim that its whole prefix is already a shared corridor.
  const destinationAffinityCodes = preferredCorridors.length ? [] : observations.find(([key]) => key !== sourceKey)?.[1] ?? [];
  const preferredCodes = new Set([...preferredCorridors.flat(), ...destinationAffinityCodes]);
  const routeCostMultipliers = trays.length > COST_TRAYS ? [] : [...byCode.keys()].map(key => routeCode(key))
    .filter(code => /^\/[A-Z0-9][A-Z0-9_.-]*$/.test(code) && code.length <= ASSESSMENT_CODE_LENGTH).sort().map(code => {
      const occupancy = assess(code).occupancyPercent;
      const base = occupancy == null ? 100 : 1 + 8 * (occupancy / 100) ** 2;
      return { routeCode: code, multiplier: Math.max(1, Math.min(1000, occupancy == null ? base : base * (preferredCodes.has(code) ? 0.85 : 1))) };
    });
  const evaluate = (routeCodes: string[]): TrayCapacityDiagnostics => {
    const allCodes = [...new Set(routeCodes.map(routeCode).filter(value => value !== '/SECONDARY'))];
    const oversized = allCodes.length > ASSESSMENT_CODES || allCodes.some(value => value.length > ASSESSMENT_CODE_LENGTH);
    const codes = allCodes.filter(value => value.length <= ASSESSMENT_CODE_LENGTH).slice(0, ASSESSMENT_CODES);
    const assessments = oversized ? codes.map(code => ({ routeCode: code, freeSpacePercent: null, occupancyPercent: null, status: 'unavailable' as const,
      diagnosticCodes: ['CAPACITY_INPUT_LIMIT'] })) : codes.map(assess);
    return trayCapacityDiagnosticsSchema.parse({ schemaVersion: TRAY_CAPACITY_DIAGNOSTICS_VERSION,
      minimumFreeSpacePercent: minimum, effectiveMinimumFreeSpacePercent: effectiveMinimum,
      tolerancePercentagePoints: TRAY_CAPACITY_TOLERANCE_PERCENTAGE_POINTS, occupancySha256, groupCableCount: fallbackGroupIds.length,
      restrictionEnabled,
      blockedRouteCodes: restrictionEnabled ? assessments.filter(value => value.status === 'below-minimum').map(value => value.routeCode) : [],
      unavailableRouteCodes: assessments.filter(value => value.status === 'unavailable').map(value => value.routeCode), trays: assessments,
      ...(oversized ? { policyIssue: 'CAPACITY_INPUT_LIMIT' } : policyIssue ? { policyIssue } : {}) });
  };
  return {
    policy: { enabled: restrictionEnabled, minimumFreeSpacePercent: minimum, effectiveMinimumFreeSpacePercent: effectiveMinimum,
      tolerancePercentagePoints: TRAY_CAPACITY_TOLERANCE_PERCENTAGE_POINTS, ...(policyIssue ? { policyIssue } : {}) },
    minimumFreeSpacePercent: minimum, effectiveMinimumFreeSpacePercent: effectiveMinimum,
    tolerancePercentagePoints: TRAY_CAPACITY_TOLERANCE_PERCENTAGE_POINTS, occupancySha256,
    groupKey: sourceKey ?? cableId, groupCableCount: fallbackGroupIds.length, groupCableIds: fallbackGroupIds,
    restrictionEnabled, routeCostMultipliers, sameToGroupKey: toKey ?? cableId,
    sameToGroupCableIds: toGroup.map(value => value.id), preferredCorridors, settledSource, evaluate,
    score(routeCodes) {
      const assessment = evaluate(routeCodes), occupancies = assessment.trays.flatMap(value => value.occupancyPercent == null ? [] : [value.occupancyPercent]);
      const sharedSuffixRouteCodes = preferredCorridors.map(value => commonSuffix(orderedCodes(routeCodes), value)).sort((a, b) => b.length - a.length)[0] ?? [];
      return { assessment, bottleneckOccupiedPercent: occupancies.length ? Math.max(...occupancies) : null,
        meanOccupiedPercent: occupancies.length ? occupancies.reduce((total, value) => total + value, 0) / occupancies.length : null,
        knownTrayCount: occupancies.length, unknownTrayCount: assessment.trays.length - occupancies.length, sharedSuffixRouteCodes };
    },
  };
}
