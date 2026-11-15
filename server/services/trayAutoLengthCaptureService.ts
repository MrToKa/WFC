import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { trayAutoLengthCaptureContextSchema, trayAutoLengthMeasurementSchema,
  type TrayAutoLengthCaptureContext, type TrayAutoLengthMeasurement } from '../../shared/trayAutoLength.js';
import { preparationPlanSchema, preparationResolutionSchema } from '../../shared/pathfinderPreparation.js';
import { fittedTraceEngineSchema } from '../../shared/pathfinderGeometryTrace.js';
import { canonicalPurposeJson } from '../../shared/pathfinderPurposePolicy.js';
import { modelCaptureScopeBytes } from '../../viewer-runtime/capture-input.mjs';
import { snapshotSchema, type ComputationalSnapshot } from '../pathfinder/contracts.js';
import { validateSnapshotStructure } from '../pathfinder/matching.js';
import type { GeometryTraceAdapters } from '../pathfinder/geometryTraceRepository.js';
import { withFittedExportAllowance, readFittedExport, discardAdoptedFittedExportReference } from '../pathfinder/geometryTraceStorage.js';
import { storeSnapshot, discardSnapshot } from '../pathfinder/storage.js';
import { TrayAutoLengthError } from './trayAutoLengthErrors.js';

type Client = Pick<PoolClient, 'query'>;
const digest = (value: unknown) => createHash('sha256').update(canonicalPurposeJson(value)).digest('hex');
const equal = (a: unknown, b: unknown) => canonicalPurposeJson(a) === canonicalPurposeJson(b);
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const captureProofSchema = z.object({ snapshotSha256: hashSchema, fittedSha256: hashSchema, engine: fittedTraceEngineSchema,
  rulesSha256: hashSchema, measurementVersion: z.literal('wfc.pf.fitted-polyline-length.v1'), elements: z.array(z.object({
    objectId: z.string().regex(/^dbid:[1-9][0-9]*$/), pointsMetres: z.array(z.tuple([z.number().finite(), z.number().finite(), z.number().finite()])).min(2).max(50000),
    geometricLengthMetres: z.number().finite().nonnegative(),
  }).strict()).min(1).max(10000) }).strict();
const fail = (code = 'TRAY_AUTO_LENGTH_CAPTURE_INVALID', message = 'The selected tray geometry could not be verified. Choose Auto-length again.', status = 409): never => {
  throw new TrayAutoLengthError(code, message, status);
};
export const TRAY_AUTO_LENGTH_CAPTURE_BYTES = 16 * 1024 * 1024;
export const TRAY_AUTO_LENGTH_CAPTURE_SQL = `
CREATE TABLE IF NOT EXISTS tray_auto_length_measurements (
  tray_id uuid PRIMARY KEY REFERENCES trays(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  context jsonb NOT NULL, measurement jsonb NOT NULL, proof jsonb NOT NULL,
  content_sha256 text NOT NULL CHECK(content_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(octet_length(context::text)<=65536 AND octet_length(measurement::text)<=4096 AND octet_length(proof::text)<=1048576)
);`;

/** Only the selected tray's actual root assignment and model affect this key.
 * Changing another tray's purpose or a cable endpoint must not stale a length. */
export async function readTrayAutoLengthCaptureContext(client: Client, projectId: string, trayId: string): Promise<TrayAutoLengthCaptureContext> {
  const row = (await client.query<{ tray_name: string; active_model_version_id: string; selection_revision: string;
    content_fingerprint: string; state: string; health: string }>(`/* tray-auto-length:capture-model */
    SELECT tr.name AS tray_name,sel.active_model_version_id,sel.selection_revision::text,ver.content_fingerprint,ver.state,ver.health
    FROM trays tr JOIN project_model_selections sel ON sel.project_id=tr.project_id
    JOIN model_versions ver ON ver.project_id=sel.project_id AND ver.id=sel.active_model_version_id
    WHERE tr.project_id=$1 AND tr.id=$2 FOR SHARE OF sel,ver`, [projectId, trayId])).rows[0];
  if (!row || row.state !== 'ready' || row.health !== 'healthy') return fail('TRAY_AUTO_LENGTH_MODEL_UNAVAILABLE', 'Load the active project model before calculating this tray length.');
  // This latch also fences resolution changes through a caller's Save transaction.
  await client.query('/* tray-auto-length:capture-preparation-fence */ SELECT project_id FROM pf_project_preparations WHERE project_id=$1 FOR SHARE', [projectId]);
  const assignment = (await client.query<{ resolution: unknown; plan: unknown }>(`/* tray-auto-length:capture-assignment */
    SELECT r.resolution,s.plan FROM trays tr
    LEFT JOIN pf_preparation_resolutions r ON r.project_id=tr.project_id AND r.project_tray_id=tr.id
    LEFT JOIN pf_project_preparations p ON p.project_id=tr.project_id
    LEFT JOIN pf_preparation_aggregates a ON a.project_id=p.project_id AND a.id=p.current_aggregate_id
    LEFT JOIN pf_preparation_sessions s ON s.project_id=a.project_id AND s.id=a.session_id
    WHERE tr.project_id=$1 AND tr.id=$2`, [projectId, trayId])).rows[0];
  let roots: string[] | undefined;
  if (assignment?.resolution != null) {
    const parsed = preparationResolutionSchema.safeParse(assignment.resolution);
    if (!parsed.success || parsed.data.mode !== 'roots' || parsed.data.projectTrayId !== trayId
      || parsed.data.scope.modelVersionId !== row.active_model_version_id || parsed.data.scope.contentFingerprint !== row.content_fingerprint
      || parsed.data.scope.selectionRevision !== row.selection_revision)
      return fail('TRAY_AUTO_LENGTH_ASSIGNMENT_REQUIRED', 'Assign this tray to objects in the active model before choosing Auto-length.');
    roots = parsed.data.rootObjectIds;
  } else {
    const parsed = preparationPlanSchema.safeParse(assignment?.plan);
    if (parsed.success && parsed.data.projectId === projectId && parsed.data.modelVersionId === row.active_model_version_id
      && parsed.data.contentFingerprint === row.content_fingerprint && parsed.data.selectionRevision === row.selection_revision)
      roots = parsed.data.requestedScope.trays.find(tray => tray.projectTrayId === trayId)?.orderedRootObjectIds;
  }
  if (!roots?.length) return fail('TRAY_AUTO_LENGTH_ASSIGNMENT_REQUIRED', 'Assign model objects to this tray in Path Finder before choosing Auto-length.');
  const rootObjectIds = [...new Set(roots.map(root => /^dbid:[1-9][0-9]*$/.test(root) ? Number(root.slice(5)) : NaN))].sort((a, b) => a - b);
  const identity = { projectId, trayId, modelVersionId: row.active_model_version_id, selectionRevision: row.selection_revision,
    contentFingerprint: row.content_fingerprint, rootObjectIds };
  const parsed = trayAutoLengthCaptureContextSchema.safeParse({ ...identity, assignmentSha256: digest({ ...identity, trayName: row.tray_name }) });
  if (!parsed.success) return fail('TRAY_AUTO_LENGTH_ASSIGNMENT_REQUIRED', 'This tray assignment exceeds the supported root scope or has changed. Assign it again.');
  return parsed.data;
}

/** No full preparation publication is required. A cached result is usable only
 * for the exact active model and selected roots that were measured. */
export async function readCapturedTrayAutoLength(client: Client, projectId: string, trayId: string): Promise<TrayAutoLengthMeasurement | null> {
  const row = (await client.query<{ context: unknown; measurement: unknown; proof: unknown; content_sha256: string }>(`/* tray-auto-length:capture-cache */
    SELECT context,measurement,CASE WHEN octet_length(proof::text)<=1048576 THEN proof END AS proof,content_sha256
    FROM tray_auto_length_measurements WHERE project_id=$1 AND tray_id=$2`, [projectId, trayId])).rows[0];
  if (!row) return null;
  const context = trayAutoLengthCaptureContextSchema.safeParse(row.context), measurement = trayAutoLengthMeasurementSchema.safeParse(row.measurement);
  const proof = captureProofSchema.safeParse(row.proof);
  if (!context.success || !measurement.success || !('source' in measurement.data) || measurement.data.source !== 'tray-capture'
    || !proof.success || row.content_sha256 !== digest({ context: row.context, measurement: row.measurement, proof: row.proof })) return null;
  let metres = 0;
  for (const element of proof.data.elements) {
    let length = 0;
    for (let at = 1; at < element.pointsMetres.length; at++) length += Math.hypot(...element.pointsMetres[at].map((n, axis) => n - element.pointsMetres[at - 1][axis]));
    if (Math.abs(length - element.geometricLengthMetres) > Math.max(1e-9, length * 1e-12)) return null;
    metres += length;
  }
  if (new Set(proof.data.elements.map(element => element.objectId)).size !== proof.data.elements.length
    || measurement.data.elementCount !== proof.data.elements.length || measurement.data.lengthMm !== Math.round(metres * 1_000_000) / 1000) return null;
  let current: TrayAutoLengthCaptureContext;
  try { current = await readTrayAutoLengthCaptureContext(client, projectId, trayId); }
  catch (error) { if (error instanceof TrayAutoLengthError) return null; throw error; }
  if (!equal(current, context.data) || measurement.data.modelVersionId !== current.modelVersionId
    || measurement.data.selectionRevision !== current.selectionRevision || measurement.data.assignmentSha256 !== current.assignmentSha256) return null;
  return measurement.data;
}

export const trayAutoLengthCaptureRequestSchema = z.object({ context: trayAutoLengthCaptureContextSchema, snapshot: z.unknown() }).strict();

/** Validate a complete selected-root capture, then label its leaves with the
 * project tray's name. Arbitrary assigned source names need no automatic match. */
export async function validateTrayAutoLengthCapture(context: TrayAutoLengthCaptureContext, raw: unknown, routeName: string): Promise<ComputationalSnapshot> {
  const parsed = snapshotSchema.safeParse(raw);
  if (!parsed.success) return fail();
  const snapshot = parsed.data;
  if (Buffer.byteLength(JSON.stringify(snapshot)) > TRAY_AUTO_LENGTH_CAPTURE_BYTES || snapshot.objects.length > 10000) return fail('TRAY_AUTO_LENGTH_CAPTURE_LIMIT', 'This tray contains too much geometry to measure in one capture.', 413);
  if (snapshot.model.projectId !== context.projectId || snapshot.model.modelVersionId !== context.modelVersionId
    || snapshot.model.contentSha256 !== context.contentFingerprint || snapshot.capture.sourceKind !== 'converted'
    || snapshot.capture.adapterVersion !== 'wfc.protected-selected-capture.v1' || snapshot.capture.lookupRouteCodes !== undefined
    || snapshot.capture.inventoryComplete || snapshot.capture.geometryComplete || snapshot.capture.unitsVerified || snapshot.capture.transformsVerified
    || snapshot.capture.planningVisibilityKnown || snapshot.capture.sourceLinkVerified) return fail();
  const scope = snapshot.capture.inputScope;
  const request = { equipmentNames: [], routeRules: [{ id: context.trayId, objectIds: context.rootObjectIds, allowedCategories: ['MV', 'LV', 'Control'] as ('MV' | 'LV' | 'Control')[] }] };
  const scopeBytes = modelCaptureScopeBytes(request), expectedScope = createHash('sha256').update(scopeBytes).digest('hex');
  if (!scope || scope.equipmentNameCount !== 0 || scope.chunkCount !== 0 || scope.inputUtf8Bytes !== scopeBytes.length
    || scope.scopeSha256 !== expectedScope || scope.equipmentNamesSha256 !== digest([])) return fail();
  validateSnapshotStructure(snapshot);
  const objects = new Map(snapshot.objects.map(object => [object.id, object])), roots = new Set(context.rootObjectIds.map(id => 'dbid:' + id));
  if ([...roots].some(root => !objects.has(root))) return fail();
  const used = new Set<string>(), needed = new Set<string>(); let leaves = 0;
  for (const object of snapshot.objects) {
    if (object.dbId == null || object.id !== 'dbid:' + object.dbId || object.nativeHidden !== null || object.planningExcluded || object.equipmentEligibility) return fail();
    if (object.geometryRole !== 'routing-leaf') {
      if (object.geometryRole !== 'hierarchy' || object.fragments.length || object.allowedCategories.length || object.categoryAssignmentSource !== 'unassigned') return fail();
      continue;
    }
    if (!object.routeBoundaryId || !roots.has(object.routeBoundaryId) || !equal(object.allowedCategories, ['MV', 'LV', 'Control'])
      || object.categoryAssignmentSource !== 'explicit-planning' || !object.fragments.length) return fail();
    const chain: typeof snapshot.objects = [], visited = new Set<string>(); let next: string | null | undefined = object.id;
    while (next != null) {
      if (visited.has(next) || visited.size >= 512) return fail();
      const node = objects.get(next); if (!node) return fail();
      visited.add(next); needed.add(next); chain.push(node); next = node.parentId;
    }
    const boundary = chain.findIndex(node => node.id === object.routeBoundaryId);
    if (boundary < 0 || !equal(object.leafToRootNames, chain.map(node => node.name))) return fail();
    for (const node of chain) if (roots.has(node.id)) used.add(node.id);
    object.routeName = routeName;
    object.shapeName = chain.slice(0, boundary + 1).find(node => /(?<![A-Za-z0-9])(?:BEND|ELBOW|FTUBE|TUBE|STRAIGHT)(?![A-Za-z0-9])/i.test(node.name))?.name ?? object.name;
    delete object.routeBoundaryId; leaves++;
  }
  if (!leaves || used.size !== roots.size || needed.size !== objects.size) return fail('TRAY_AUTO_LENGTH_CAPTURE_INCOMPLETE', 'The capture does not cover all assigned objects. Reload the model and try Auto-length again.');
  return snapshotSchema.parse(snapshot);
}

type CaptureStorage = { store: typeof storeSnapshot; discard: typeof discardSnapshot;
  readExport: typeof readFittedExport; discardExport: typeof discardAdoptedFittedExportReference };
const storage: CaptureStorage = { store: storeSnapshot, discard: discardSnapshot, readExport: readFittedExport, discardExport: discardAdoptedFittedExportReference };
export function createTrayAutoLengthCaptureService(pool: Pool, engine: GeometryTraceAdapters, files: CaptureStorage = storage) {
  return { async capture(projectId: string, trayId: string, raw: unknown, authorize: (client: PoolClient) => Promise<void>, signal: AbortSignal) {
    const input = trayAutoLengthCaptureRequestSchema.safeParse(raw); if (!input.success) return fail(undefined, undefined, 400);
    const context = input.data.context;
    if (context.projectId !== projectId || context.trayId !== trayId) return fail();
    const checked = await readTrayAutoLengthCaptureContext(pool, projectId, trayId);
    if (!equal(checked, context)) return fail('TRAY_AUTO_LENGTH_STALE', 'The model or tray assignment changed. Choose Auto-length again.');
    const tray = (await pool.query<{ name: string }>('SELECT name FROM trays WHERE project_id=$1 AND id=$2', [projectId, trayId])).rows[0];
    const routeName = '/' + (tray?.name ?? '').normalize('NFC').trim().replace(/^\/+|\/+$/g, '').toUpperCase();
    if (!/^\/[A-Z0-9][A-Z0-9_.-]*$/.test(routeName)) return fail('TRAY_AUTO_LENGTH_NAME_INVALID', 'The tray name cannot be used to label its centerline.');
    const snapshot = await validateTrayAutoLengthCapture(context, input.data.snapshot, routeName);
    signal.throwIfAborted();
    const snapshotId = randomUUID(), exportId = randomUUID();
    let snapshotSha: string | undefined, exportReference: Awaited<ReturnType<typeof readFittedExport>>['reference'] | undefined;
    try {
      const stored = await files.store(snapshotId, snapshot); snapshotSha = stored.sha256;
      return await withFittedExportAllowance(exportId, async () => {
        exportReference = await engine.exportFittedTrace({ projectId, modelVersionId: context.modelVersionId, snapshotId,
          snapshotSha256: stored.sha256, exportId, maxBytes: 16 * 1024 * 1024 }, signal);
        const exported = await files.readExport(exportId, exportReference), fitted = exported.payload;
        signal.throwIfAborted();
        const leaves = snapshot.objects.filter(object => object.geometryRole === 'routing-leaf');
        if (fitted.projectId !== projectId || fitted.modelVersionId !== context.modelVersionId || fitted.contentFingerprint !== context.contentFingerprint
          || fitted.snapshotSha256 !== stored.sha256 || fitted.objects.length !== snapshot.objects.length || fitted.segments.length !== leaves.length
          || !equal(fitted.segments.map(segment => segment.objectId), leaves.map(leaf => leaf.id))) return fail();
        let metres = 0;
        const elements = fitted.segments.map(segment => {
          if (segment.routeCode !== routeName || segment.name !== routeName) return fail();
          let length = 0;
          for (let at = 1; at < segment.pointsMetres.length; at++) length += Math.hypot(...segment.pointsMetres[at].map((n, axis) => n - segment.pointsMetres[at - 1][axis]));
          if (!Number.isFinite(length) || Math.abs(length - segment.geometricLengthMetres) > Math.max(1e-9, length * 1e-12)) return fail();
          metres += length;
          return { objectId: segment.objectId, pointsMetres: segment.pointsMetres, geometricLengthMetres: length };
        });
        const measurement = trayAutoLengthMeasurementSchema.parse({ source: 'tray-capture', modelVersionId: context.modelVersionId,
          selectionRevision: context.selectionRevision, assignmentSha256: context.assignmentSha256, measurementId: randomUUID(),
          lengthMm: Math.round(metres * 1_000_000) / 1000, elementCount: elements.length });
        const proof = captureProofSchema.parse({ snapshotSha256: stored.sha256, fittedSha256: exportReference.sha256, engine: fitted.engine,
          rulesSha256: fitted.rulesSha256, measurementVersion: fitted.measurementVersion, elements });
        if (Buffer.byteLength(canonicalPurposeJson(proof)) > 1024 * 1024) return fail('TRAY_AUTO_LENGTH_CAPTURE_LIMIT', 'This tray contains too much centerline data.', 413);
        const client = await pool.connect();
        try {
          await client.query('BEGIN'); await client.query("SET LOCAL lock_timeout='3000ms';SET LOCAL statement_timeout='15000ms'");
          await authorize(client); signal.throwIfAborted();
          const current = await readTrayAutoLengthCaptureContext(client, projectId, trayId);
          if (!equal(current, context)) return fail('TRAY_AUTO_LENGTH_STALE', 'The model or assignment changed while measuring. Choose Auto-length again.');
          await client.query(`/* tray-auto-length:capture-store */ INSERT INTO tray_auto_length_measurements(tray_id,project_id,context,measurement,proof,content_sha256)
            VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tray_id) DO UPDATE SET project_id=EXCLUDED.project_id,context=EXCLUDED.context,
            measurement=EXCLUDED.measurement,proof=EXCLUDED.proof,content_sha256=EXCLUDED.content_sha256,created_at=now()`,
          [trayId, projectId, context, measurement, proof, digest({ context, measurement, proof })]);
          signal.throwIfAborted(); await client.query('COMMIT'); return measurement;
        } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
      });
    } finally {
      await Promise.all([
        ...(exportReference ? [files.discardExport(exportReference)] : []),
        ...(snapshotSha ? [files.discard(snapshotId, snapshotSha)] : []),
      ]);
    }
  } };
}
