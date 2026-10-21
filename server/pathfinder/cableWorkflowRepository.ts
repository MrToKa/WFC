import { randomBytes } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { CABLE_WORKFLOW_LIMITS, cableWorkflowPageSchema, cableWorkflowRowSchema, classifyCableWorkflow,
  type CableWorkflowCalculation, type CableWorkflowRow } from '../../shared/pathfinderCableWorkflow.js';
import { cableWorkflowQuerySchema, cableWorkflowDetailQuerySchema, cableWorkflowDetailSchema, cableWorkflowQueryHashInput,
  cableWorkflowDetailQueryHashInput, cableWorkflowRowMatchesSearch, CABLE_WORKFLOW_READ_LIMITS,
  parseCableWorkflowHttpQuery, parseCableWorkflowDetailHttpQuery,
  type CableWorkflowQuery, type CableWorkflowDetailQuery } from '../../shared/pathfinderCableWorkflowQueries.js';
import { calculationAvailabilitySchema, notEvaluatedCalculationAvailability, type CalculationAvailability } from '../../shared/pathfinderCalculationAvailability.js';
import { canonicalPurposeJson, policyUuidSchema } from '../../shared/pathfinderPurposePolicy.js';
import { defaultOptions, optionsSchema, type JobPrincipal, type DependencySnapshot } from './jobContracts.js';
import { collectCommonCalculationInputs, freezeCableDependenciesForVersion, hash, type CommonCalculationCollection } from './dependencies.js';
import { readCurrentEndpointBindingContext, readNeededEndpointBindingHeads } from './endpointBindingRepository.js';
import type { EndpointBindingContext } from '../../shared/pathfinderEndpointBindings.js';
import { readAutomaticEndpointCandidates } from './automaticEndpointCandidates.js';
import { endpointCalculationPoint, type CurrentEndpointCalculationPoint } from './endpointCalculationProvenance.js';
import { normalizeLocation } from './matching.js';
import { PathFinderError } from './errors.js';
import { cableWorkflowReadTransaction } from './cableWorkflowRead.js';
import { createCableWorkflowCursor } from './cableWorkflowCursor.js';
import { createCableWorkflowProofReader } from './cableWorkflowProof.js';

type Data = Record<string, any>;
export const CABLE_WORKFLOW_REPOSITORY_LIMITS = Object.freeze({ admissions: 10_000 });
const fail = (code: string, status = 409): never => { throw new PathFinderError(code, status, 'Cable diagnostics could not be read within their supported scope. Refresh the current project.'); };
const bounded = <T>(value: T): T => { if (Buffer.byteLength(canonicalPurposeJson(value)) > CABLE_WORKFLOW_READ_LIMITS.responseBytes) return fail('WORKFLOW_RESPONSE_LIMIT', 413); return value; };
const availability = (status: CalculationAvailability['status'], reasonCode: string, candidateObjectIds: string[] = []): CalculationAvailability =>
  calculationAvailabilitySchema.parse({ status, pointAvailable: false, source: null, approximate: false, candidateObjectIds, reasonCode, engineeringAccepted: false });
const outcome = (value: unknown): CableWorkflowCalculation['outcome'] => {
  const values: Record<string, CableWorkflowCalculation['outcome']> = { calculated: 'calculated', no_path: 'no-path', locations_required: 'locations-required', location_required: 'locations-required',
    settings_required: 'settings-required', category_required: 'category-required', model_required: 'model-required', model_unavailable: 'model-required',
    model_index_required: 'model-required', routing_preparation_required: 'model-required', endpoint_preparation_required: 'model-required', comparison_required: 'model-required', engine_required: 'model-required',
    stale: 'stale', failed: 'failed', invalid_request: 'failed', resource_limit: 'resource-limit', deadline_exceeded: 'deadline-exceeded' };
  return typeof value === 'string' ? values[value] ?? 'not-evaluated' : 'not-evaluated';
};
const code = (value: unknown): string | null => typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,95}$/.exec(value)?.[0] === value ? value : null;
function snapshot(value: Data): CableWorkflowRow['cable'] {
  if (value.input_oversize) return fail('WORKFLOW_CABLE_INPUT_LIMIT', 413);
  return { id: value.id, tag: value.tag, fromLocation: value.from_location, toLocation: value.to_location, routing: value.routing,
    designLength: value.design_length, installLength: value.install_length, cableWriteRevision: value.cable_write_revision };
}

/** Every context/page is a live coherent observation; item progress does not invalidate pagination. */
async function context(client: PoolClient, projectId: string) {
  const value = (await client.query<Data>(`/* cable-workflow:context */ SELECT s.active_model_version_id,s.selection_revision::text,
    (SELECT count(*)::int FROM(SELECT id FROM pf_revision_admissions WHERE project_id=$1 LIMIT 10001) bounded_admissions) AS admission_count,
    jsonb_build_object('selection',jsonb_build_object('id',s.active_model_version_id,'revision',s.selection_revision::text),
      'model',jsonb_build_object('fingerprint',m.content_fingerprint,'state',m.state,'health',m.health),
      'settings',jsonb_build_object('revision',p.pf_settings_revision::text,'gap',p.connection_gap::text,'secondary',p.secondary_tray_length::text,'end',p.end_connection_length::text,'bending',p.additional_bending_percent::text),
      'registry',r.registry_revision::text,'preparation',jsonb_build_object('aggregate',g.current_aggregate_id,'artifact',g.current_artifact_id,'revision',g.geometry_revision::text),
      'purpose',jsonb_build_object('catalog',u.catalog_revision::text,'routing',u.routing_policy_revision::text),
      'comparison',jsonb_build_object('id',v.current_comparison_id,'revision',v.comparison_revision::text,'sha',v.decision_set_sha256),
      'generation',q.desired_generation::text,
      'latestAdmission',(SELECT jsonb_build_object('id',a.id,'created',to_char(a.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) FROM pf_revision_admissions a WHERE a.project_id=$1 ORDER BY a.created_at DESC,a.id DESC LIMIT 1)) AS context
    FROM projects p LEFT JOIN project_model_selections s ON s.project_id=p.id LEFT JOIN model_versions m ON m.project_id=p.id AND m.id=s.active_model_version_id
    LEFT JOIN pf_project_state r ON r.project_id=p.id LEFT JOIN pf_project_preparations g ON g.project_id=p.id
    LEFT JOIN pf_purpose_project_state u ON u.project_id=p.id LEFT JOIN pf_recalculation_state q ON q.project_id=p.id
    LEFT JOIN pf_revision_comparison_targets v ON v.project_id=p.id AND v.target_aggregate_id=g.current_aggregate_id AND v.target_model_version_id=s.active_model_version_id WHERE p.id=$1`, [projectId])).rows[0];
  if (!value || !Number.isInteger(value.admission_count) || value.admission_count < 0) return fail('WORKFLOW_CONTEXT_UNAVAILABLE');
  if (value.admission_count > CABLE_WORKFLOW_REPOSITORY_LIMITS.admissions) return fail('WORKFLOW_ADMISSION_LIMIT', 413);
  return value;
}

const inputOversizeSql = `(COALESCE(octet_length(c.tag),0)>4096 OR COALESCE(octet_length(c.from_location),0)>4096 OR COALESCE(octet_length(c.to_location),0)>4096
 OR COALESCE(char_length(c.routing),0)>8000 OR COALESCE(octet_length(c.routing),0)>32000 OR COALESCE(octet_length(c.mto),0)>96)`;
/** SQL only excludes proven ASCII nonmatches; the exact Unicode matcher remains in JavaScript. */
function asciiSearchNeedle(search: string): string | null {
  const needle = search.toUpperCase();
  return /^[\x20-\x7e]+$/.test(needle) ? needle : null;
}
const candidatesSql = `/* cable-workflow:candidates */ SELECT c.id,c.cable_type_id,c.cable_write_revision::text,
 CASE WHEN octet_length(c.tag)<=4096 THEN c.tag ELSE NULL END AS tag,
 CASE WHEN octet_length(c.from_location)<=4096 THEN c.from_location ELSE NULL END AS from_location,
 CASE WHEN octet_length(c.to_location)<=4096 THEN c.to_location ELSE NULL END AS to_location,
 CASE WHEN char_length(c.routing)<=8000 AND octet_length(c.routing)<=32000 THEN c.routing ELSE NULL END AS routing,
 CASE WHEN octet_length(c.mto)<=96 THEN c.mto ELSE NULL END AS mto,c.design_length::text,c.install_length::text,
 ${inputOversizeSql} AS input_oversize
 FROM cables c WHERE c.project_id=$1 AND c.mto IS DISTINCT FROM 'MV' AND ($2::uuid IS NULL OR c.id>$2)
 AND ($3::uuid IS NULL OR c.id=$3)
 AND ($4::text IS NULL OR ${inputOversizeSql}
   OR strpos(translate(c.tag,'abcdefghijklmnopqrstuvwxyz','ABCDEFGHIJKLMNOPQRSTUVWXYZ'),$4)>0
   OR strpos(translate(c.from_location,'abcdefghijklmnopqrstuvwxyz','ABCDEFGHIJKLMNOPQRSTUVWXYZ'),$4)>0
   OR strpos(translate(c.to_location,'abcdefghijklmnopqrstuvwxyz','ABCDEFGHIJKLMNOPQRSTUVWXYZ'),$4)>0
   OR c.tag COLLATE "C" ~ '[^ -~]' OR c.from_location COLLATE "C" ~ '[^ -~]' OR c.to_location COLLATE "C" ~ '[^ -~]')
 ORDER BY c.id LIMIT 201`;

async function metadata(client: PoolClient, projectId: string, ids: string[]): Promise<Map<string, Data>> {
  if (!ids.length) return new Map();
  const rows = (await client.query<Data>(`/* cable-workflow:latest-admissions */ SELECT DISTINCT ON(b.cable_id) b.cable_id,b.status AS baseline_status,a.id AS admission_id,a.job_id,
    j.state AS job_status,j.cancel_requested,i.state AS item_state,i.status AS item_status,p.id AS proposal_id,p.proposal_hash,p.status AS proposal_status
    FROM pf_revision_baselines b JOIN pf_revision_admissions a ON a.project_id=b.project_id AND a.id=b.admission_id
    LEFT JOIN pf_jobs j ON j.project_id=a.project_id AND j.id=a.job_id LEFT JOIN pf_job_items i ON i.project_id=a.project_id AND i.job_id=a.job_id AND i.cable_id=b.cable_id
    LEFT JOIN pf_proposals p ON p.project_id=a.project_id AND p.job_id=a.job_id AND p.cable_id=b.cable_id
    WHERE b.project_id=$1 AND b.cable_id=ANY($2::uuid[]) ORDER BY b.cable_id,a.created_at DESC,a.id DESC`, [projectId, ids])).rows;
  const result = new Map<string, Data>();
  for (const row of rows) { if (!ids.includes(row.cable_id) || result.has(row.cable_id)) return fail('WORKFLOW_ADMISSION_INTEGRITY'); result.set(row.cable_id, row); }
  return result;
}

async function readRows(client: PoolClient, projectId: string, candidates: Data[], preferences: CableWorkflowDetailQuery, check: () => void,
  readContext: Awaited<ReturnType<typeof context>>, shared: { commonCache: Map<string, Promise<CommonCalculationCollection>>; current?: EndpointBindingContext['current'] }) {
  const requested = { ...defaultOptions, secondaryDistanceMeters: preferences.secondaryDistanceMeters,
    preferVerticalApproach: preferences.preferVerticalApproach }, { commonCache } = shared;
  const getCommon = (raw: unknown) => {
    const parsed = optionsSchema.safeParse(raw); if (!parsed.success) return Promise.resolve(null);
    const key = canonicalPurposeJson(parsed.data);
    if (!commonCache.has(key)) commonCache.set(key, collectCommonCalculationInputs(client, projectId, parsed.data));
    return commonCache.get(key)!;
  };
  let common: CommonCalculationCollection | null;
  try { common = await getCommon(requested); }
  catch (error) {
    check(); if (!(error instanceof PathFinderError)) throw error;
    common = { inputs: null, bindingContext: null, status: error.code === 'PROJECT_SETTINGS_INVALID' ? 'settings_required' : 'model_unavailable', message: '' };
    commonCache.set(canonicalPurposeJson(requested), Promise.resolve(common));
  }
  check(); if (!common) return fail('WORKFLOW_CONTEXT_UNAVAILABLE');
  if (common.inputs) commonCache.set(canonicalPurposeJson(common.inputs.options), Promise.resolve(common));
  let current = shared.current === undefined ? common.bindingContext ?? await readCurrentEndpointBindingContext(client, projectId) : shared.current;
  if (current && (current.modelVersionId !== readContext.active_model_version_id || current.selectionRevision !== readContext.selection_revision)) current = null;
  shared.current = current;
  const names = [...new Set(candidates.flatMap(cable => [cable.from_location, cable.to_location])
    .filter((name): name is string => typeof name === 'string' && normalizeLocation(name) !== '').map(normalizeLocation))].sort();
  const aliases = new Map<string, string>(), locations = new Map<string, Data>();
  if (names.length) {
    const rows = (await client.query<Data>(`/* cable-workflow:needed-locations */ SELECT a.normalized_alias,l.id,l.name,l.revision::text,
      EXISTS(SELECT 1 FROM pf_location_bindings b WHERE b.project_id=l.project_id AND b.location_id=l.id) AS has_legacy
      FROM pf_location_aliases a JOIN pf_locations l ON l.project_id=a.project_id AND l.id=a.location_id
      WHERE a.project_id=$1 AND a.normalized_alias=ANY($2::text[]) ORDER BY a.normalized_alias FOR SHARE OF a,l`, [projectId, names])).rows;
    for (const row of rows) { if (!names.includes(row.normalized_alias) || aliases.has(row.normalized_alias)) return fail('WORKFLOW_LOCATION_INTEGRITY'); aliases.set(row.normalized_alias, row.id); locations.set(row.id, row); }
  }
  const deadline = Date.now() + CABLE_WORKFLOW_READ_LIMITS.deadlineMilliseconds;
  const heads = await readNeededEndpointBindingHeads(client, { projectId, current, locationIds: [...locations.keys()], deadline }); check();
  const unbound = [...locations.values()].filter(value => !heads.has(value.id) && !value.has_legacy).map(value => value.id);
  const automatic = current && unbound.length ? await readAutomaticEndpointCandidates(client, { projectId, current, locationIds: unbound, deadline }) : new Map(); check();
  const endpoint = (name: string | null): { availability: CalculationAvailability; point: CurrentEndpointCalculationPoint | null } => {
    if (!name?.trim()) return { availability: availability('missing', 'ENDPOINT_NAME_REQUIRED'), point: null };
    const locationId = aliases.get(normalizeLocation(name));
    if (!locationId) return { availability: availability('missing', 'LOCATION_NOT_REGISTERED'), point: null };
    const head = heads.get(locationId);
    if (head) return head.ready ? { availability: calculationAvailabilitySchema.parse({ status: 'confirmed-ready', pointAvailable: true, source: 'confirmed-shared-location', approximate: false, candidateObjectIds: [], reasonCode: null, engineeringAccepted: false }), point: endpointCalculationPoint(head.binding) }
      : { availability: availability('saved-binding-required', 'SAVED_BINDING_REQUIRES_CONFIRMATION'), point: null };
    if (locations.get(locationId)?.has_legacy) return { availability: availability('saved-binding-required', 'LEGACY_BINDING_REQUIRES_CONFIRMATION'), point: null };
    if (!current) return { availability: availability('preparation-required', 'CURRENT_PREPARATION_REQUIRED'), point: null };
    const found = automatic.get(locationId);
    if (!found) return { availability: notEvaluatedCalculationAvailability(), point: null };
    return found.status === 'automatic-ready' && found.point ? { availability: calculationAvailabilitySchema.parse({ status: 'automatic-ready', pointAvailable: true, source: 'automatic-model-candidate', approximate: true, candidateObjectIds: found.candidateObjectIds, reasonCode: null, engineeringAccepted: false }), point: found.point }
      : { availability: availability(found.status, 'AUTOMATIC_ENDPOINT_' + found.status.replaceAll('-', '_').toUpperCase(), found.candidateObjectIds), point: null };
  };
  const latest = await metadata(client, projectId, candidates.map(value => value.id)); check();
  const acceptedIds = new Set(candidates.length ? (await client.query<{ cable_id: string }>(`/* cable-workflow:accepted-identities */ SELECT DISTINCT ON(cable_id) cable_id
    FROM pf_apply_receipts WHERE project_id=$1 AND cable_id=ANY($2::uuid[]) ORDER BY cable_id,applied_at DESC,id DESC`, [projectId, candidates.map(value => value.id)])).rows.map(value => value.cable_id) : []);
  if ([...acceptedIds].some(id => !candidates.some(value => value.id === id))) return fail('WORKFLOW_RECEIPT_SCOPE');
  const proof = createCableWorkflowProofReader(client, projectId, check);
  const contextHash = hash({ database: readContext.context, admissionCount: readContext.admission_count, common: common.inputs ?? { status: common.status } });
  return { contextHash, async row(cable: Data): Promise<CableWorkflowRow> {
    check(); const from = endpoint(cable.from_location), to = endpoint(cable.to_location), meta = latest.get(cable.id);
    const fresh = async (raw: unknown,version:DependencySnapshot['schemaVersion']): Promise<DependencySnapshot | null> => {
      const options = optionsSchema.safeParse(raw); if (!options.success) return null;
      if (options.data.secondaryDistanceMeters !== preferences.secondaryDistanceMeters || options.data.preferVerticalApproach !== preferences.preferVerticalApproach) return null;
      const coherent = await getCommon(options.data); check();
      return coherent?.inputs ? freezeCableDependenciesForVersion(coherent.inputs, cable, from.point, to.point,version).dependencies : null;
    };
    const rawState = meta?.item_state, itemState = ['waiting', 'running', 'complete', 'blocked'].includes(rawState) ? rawState as CableWorkflowCalculation['itemState'] : null;
    const jobStatus = ['queued', 'running', 'complete', 'cancelled', 'failed'].includes(meta?.job_status) ? meta!.job_status as CableWorkflowCalculation['jobStatus'] : null;
    let status = itemState === 'waiting' || itemState === 'running' ? 'not-evaluated' as const : outcome(meta?.proposal_status ?? meta?.item_status ?? meta?.baseline_status);
    if (!common.inputs && status === 'not-evaluated' && itemState !== 'waiting' && itemState !== 'running') status = outcome(common.status);
    const reasons: string[] = [];
    if (!common.inputs) reasons.push(code(common.status.toUpperCase()) ?? 'CURRENT_CALCULATION_CONTEXT_UNAVAILABLE');
    const recordedStatus = code(typeof (meta?.proposal_status ?? meta?.item_status ?? meta?.baseline_status) === 'string'
      ? String(meta?.proposal_status ?? meta?.item_status ?? meta?.baseline_status).toUpperCase() : null);
    if (recordedStatus && status !== 'calculated' && status !== 'not-evaluated') reasons.push(recordedStatus);
    if (meta?.cancel_requested) reasons.push('CALCULATION_CANCEL_REQUESTED');
    if (jobStatus === 'failed') reasons.push('CALCULATION_FAILED');
    let currentness: CableWorkflowCalculation['currentness'] = meta ? 'unavailable' : 'not-evaluated', reviewable = false;
    let itemApplicability:CableWorkflowCalculation['itemApplicability']=null;
    if (meta?.proposal_id && status === 'calculated') {
      // Read exact retained options only inside bounded proof; the fresh collector is cached per option set.
      const verified = await proof.verified(cable.id, meta.proposal_id); check();
      const result = await proof.reviewable(cable.id, meta.job_id, meta.proposal_id, verified ? await fresh(verified.dependencies.options,verified.dependencies.schemaVersion) : null);
      currentness = result.currentness; reviewable = result.reviewable; reasons.push(...result.reasonCodes);
      itemApplicability='itemApplicability' in result?result.itemApplicability:null;
    }
    const cableSnapshot = snapshot(cable), accepted = acceptedIds.has(cable.id) && await proof.accepted(cableSnapshot, fresh); check();
    if (accepted) currentness = 'current';
    return cableWorkflowRowSchema.parse({ projectId, cable: cableSnapshot, mto: cable.mto, from: from.availability, to: to.availability,
      calculation: { jobId: jobStatus && meta ? meta.job_id : null, jobStatus, itemState: jobStatus ? itemState : null, outcome: status,
        // Historical item/job tables retain status and free-form text, not a structured error code. Never parse private messages into codes.
        reasonCodes: [...new Set(reasons)].slice(0, CABLE_WORKFLOW_LIMITS.reasonCodes), errorCode: null, currentness,
        proposalId: meta?.proposal_id ?? null, proposalHash: meta?.proposal_hash ?? null, reviewable, acceptedMatchesCurrent: accepted,itemApplicability } });
  } };
}

export function createCableWorkflowRepository(pool: Pool, options: { cursorKey?: Buffer } = {}) {
  const cursors = createCableWorkflowCursor(options.cursorKey ?? randomBytes(32));
  return {
    async page(projectId: string, who: JobPrincipal, raw: unknown, signal?: AbortSignal, http = false) {
      return cableWorkflowReadTransaction(pool, projectId, who, async (client, check) => {
        const query: CableWorkflowQuery = http ? parseCableWorkflowHttpQuery(raw) : cableWorkflowQuerySchema.parse(raw), queryHash = hash(cableWorkflowQueryHashInput(query));
        const scope = await context(client, projectId), shared = { commonCache: new Map<string, Promise<CommonCalculationCollection>>() };
        const provisional = await readRows(client, projectId, [], query, check, scope, shared);
        const after = cursors.decode(query.cursor, projectId, queryHash, provisional.contextHash, who);
        const source = (await client.query<Data>(candidatesSql, [projectId, after, null, asciiSearchNeedle(query.search)])).rows; check();
        if (source.length > CABLE_WORKFLOW_LIMITS.maxScan + 1 || source.some((value, index) => after !== null && value.id <= after || index > 0 && source[index - 1].id >= value.id)) return fail('WORKFLOW_SCAN_INTEGRITY');
        const candidates = source.slice(0, CABLE_WORKFLOW_LIMITS.maxScan);
        for (const candidate of candidates) snapshot(candidate);
        const matching = candidates.filter(value => cableWorkflowRowMatchesSearch({ cable: snapshot(value) }, query.search));
        const reader = matching.length ? await readRows(client, projectId, matching, query, check, scope, shared) : provisional;
        if (reader.contextHash !== provisional.contextHash) return fail('WORKFLOW_CONTEXT_CHANGED');
        const rows: CableWorkflowRow[] = []; let scannedCount = 0, boundary: string | null = null;
        for (const candidate of candidates) {
          check(); scannedCount++; boundary = candidate.id;
          if (cableWorkflowRowMatchesSearch({ cable: snapshot(candidate) }, query.search)) {
            const row = await reader.row(candidate), state = classifyCableWorkflow(row).status;
            const matches = query.filter === 'all' || (query.filter === 'needs-routing' ? state === 'needs-routing' || state === 'blocked' : state === query.filter);
            if (matches) rows.push(row);
          }
          if (rows.length === query.limit) break;
        }
        const more = scannedCount < source.length;
        return bounded(cableWorkflowPageSchema.parse({ schemaVersion: 'wfc.pf.cable-workflow-page.v1', projectId, querySha256: queryHash,
          contextSha256: reader.contextHash, scannedCount, scannedThroughCableId: boundary, rows,
          nextCursor: more && boundary ? cursors.encode(projectId, boundary, queryHash, reader.contextHash, who) : null }));
      }, signal);
    },
    async detail(projectId: string, who: JobPrincipal, cableId: string, raw: unknown, signal?: AbortSignal, http = false) {
      return cableWorkflowReadTransaction(pool, projectId, who, async (client, check) => {
        policyUuidSchema.parse(cableId); const query = http ? parseCableWorkflowDetailHttpQuery(raw) : cableWorkflowDetailQuerySchema.parse(raw), queryHash = hash(cableWorkflowDetailQueryHashInput(query));
        const scope = await context(client, projectId), values = (await client.query<Data>(candidatesSql, [projectId, null, cableId, null])).rows;
        if (values.length !== 1) return fail('CABLE_NOT_FOUND', 404);
        const reader = await readRows(client, projectId, values, query, check, scope, { commonCache: new Map() });
        return bounded(cableWorkflowDetailSchema.parse({ schemaVersion: 'wfc.pf.cable-workflow-detail.v1', projectId, cableId, querySha256: queryHash, contextSha256: reader.contextHash, row: await reader.row(values[0]) }));
      }, signal);
    },
  };
}
export type CableWorkflowRepository = ReturnType<typeof createCableWorkflowRepository>;
