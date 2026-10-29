/** Source-only runner. Only the designated local executor may invoke this module. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { pool } from '../db.js';
import { signAccessToken } from '../auth.js';
import {
  policyUuidSchema,
  routePurposePolicySchema,
} from '../../shared/pathfinderPurposePolicy.js';
import {
  preparationContextSchema,
  preparationSessionSchema,
  preparationPartReceiptSchema,
  preparationPublicationSchema,
  type PreparationPlan,
  type PreparationDiscovery,
} from '../../shared/pathfinderPreparation.js';
import { mergePreparationParts, validatePreparationPart } from '../../shared/preparationMerge.js';
import type { ComputationalSnapshot, SnapshotObject } from './contracts.js';

type Json = Record<string, any>;
type Check = { name: string; status: 'PASS' | 'FAIL'; details?: unknown; message?: string };
export type PreparationFixtureIntent = {
  projectId: string;
  actorId: string;
  modelId: string;
  importId: string;
  password: string;
};
function resolveFixtureIntent(
  input: PreparationFixtureIntent | undefined,
  sourceProjectId: string,
  sourceModelId: string,
): PreparationFixtureIntent {
  const value = input ?? {
    projectId: randomUUID(),
    actorId: randomUUID(),
    modelId: randomUUID(),
    importId: randomUUID(),
    password: randomUUID() + '!a9',
  };
  for (const id of [value.projectId, value.actorId, value.modelId, value.importId])
    policyUuidSchema.parse(id);
  assert.equal(new Set([value.projectId, value.actorId, value.modelId, value.importId]).size, 4);
  assert.notEqual(value.projectId, sourceProjectId);
  assert.notEqual(value.modelId, sourceModelId);
  assert.ok(
    typeof value.password === 'string' &&
      value.password.length >= 16 &&
      value.password.length <= 256 &&
      !/[\u0000-\u001f\u007f-\u009f]/u.test(value.password),
  );
  return value;
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
/** Two connected segments deliberately straddle the server's 512-object partition.
 * The other 511 complete straight leaves are remote synthetic geometry, never
 * omitted fragments or degenerate padding. Every category remains server-owned.
 */
export function preparationIntegrationDiscovery(context: {
  scope: { modelVersionId: string; contentFingerprint: string; selectionRevision: string };
  trays: { projectTrayId: string; rawName: string }[];
}): PreparationDiscovery {
  assert.equal(context.trays.length, 2);
  const trays = [...context.trays].sort((a, b) => a.rawName.localeCompare(b.rawName));
  const objects: PreparationDiscovery['objects'] = [
    {
      objectId: 'dbid:1',
      parentId: null,
      name: trays[0].rawName,
      hasGeometry: false,
      isPhysicalLeaf: false,
      orderIndex: 0,
    },
  ];
  for (let index = 0; index < 512; index++)
    objects.push({
      objectId: `dbid:${index + 10}`,
      parentId: 'dbid:1',
      name: `STRAIGHT ${index}`,
      hasGeometry: true,
      isPhysicalLeaf: true,
      orderIndex: objects.length,
    });
  objects.push({
    objectId: 'dbid:2',
    parentId: null,
    name: trays[1].rawName,
    hasGeometry: false,
    isPhysicalLeaf: false,
    orderIndex: objects.length,
  });
  objects.push({
    objectId: 'dbid:1000',
    parentId: 'dbid:2',
    name: 'STRAIGHT final',
    hasGeometry: true,
    isPhysicalLeaf: true,
    orderIndex: objects.length,
  });
  return {
    schemaVersion: 'wfc.pf.discovery-report.v1',
    modelVersionId: context.scope.modelVersionId,
    contentFingerprint: context.scope.contentFingerprint,
    selectionRevision: context.scope.selectionRevision,
    matchingPolicyVersion: 'wfc.pf.project-exact-candidates.v1',
    complete: true,
    propertyScan: null,
    objects,
    trays: trays.map((tray, index) => ({
      projectTrayId: tray.projectTrayId,
      candidateRootObjectIds: [`dbid:${index + 1}`],
    })),
    endpointCandidates: [],
  };
}
export function preparationIntegrationPart(
  plan: PreparationPlan,
  partId: string,
): ComputationalSnapshot {
  const part = plan.partPlan.find((value) => value.partId === partId);
  assert.ok(part);
  const manifest = new Map(plan.objectManifest.map((value) => [value.objectId, value]));
  const objects: SnapshotObject[] = [];
  for (const leaf of part.objects) {
    const id = `dbid:${leaf.objectId}`,
      source = manifest.get(id)!;
    const x = leaf.objectId === 1000 ? 10.5 : 0,
      y = leaf.objectId === 10 || leaf.objectId === 1000 ? 0 : leaf.objectId * 100;
    objects.push({
      id,
      dbId: leaf.objectId,
      parentId: source.parentId,
      name: source.name,
      geometryRole: 'routing-leaf',
      leafToRootNames: [source.name, manifest.get(source.parentId!)!.name],
      properties: [],
      nativeHidden: null,
      planningExcluded: false,
      routeName: leaf.routeName,
      shapeName: leaf.shapeName,
      categoryAssignmentSource: 'explicit-planning',
      allowedCategories: leaf.allowedCategories,
      bounds: { minimum: [x, y - 0.5, 0], maximum: [x + 10, y + 0.5, 1] },
      fragments: [
        {
          id: `fragment:${leaf.objectId}`,
          vertices: [
            [x, y - 0.5, 0],
            [x + 10, y - 0.5, 0],
            [x, y + 0.5, 0],
          ],
          triangleIndices: [0, 1, 2],
          fragmentToWorldMetres: identity,
          transformAlreadyApplied: true,
        },
      ],
    });
  }
  for (const id of part.ancestorObjectIds) {
    const source = manifest.get(id)!;
    objects.push({
      id,
      dbId: Number(id.slice(5)),
      parentId: source.parentId,
      name: source.name,
      geometryRole: 'hierarchy',
      leafToRootNames: [source.name],
      properties: [],
      nativeHidden: null,
      planningExcluded: false,
      categoryAssignmentSource: 'unassigned',
      allowedCategories: [],
      bounds: { minimum: [0, -0.5, 0], maximum: [20.5, 52100.5, 1] },
      fragments: [],
    });
  }
  const payload: ComputationalSnapshot = {
    schemaVersion: 'pathfinder.model.snapshot.v1',
    model: {
      projectId: plan.projectId,
      modelVersionId: plan.modelVersionId,
      contentSha256: plan.contentFingerprint,
    },
    capture: {
      adapterVersion: 'pf-r3-synthetic-integration-v1',
      sourceKind: 'synthetic',
      inventoryComplete: false,
      geometryComplete: false,
      unitsVerified: false,
      transformsVerified: false,
      planningVisibilityKnown: false,
      sourceLinkVerified: false,
      evidenceSha256: [],
    },
    coordinates: {
      vertexFrame: 'canonical-world-metres',
      sourceUnits: 'm',
      metresPerSourceUnit: 1,
      sourceToWorldMetres: null,
      globalOffsetMetres: [0, 0, 0],
      displayToWorldMetres: identity,
    },
    objects,
  };
  return validatePreparationPart(plan, part, payload);
}

export async function runPreparationIntegration({
  sourceProjectId,
  expectedOwner,
  keepForUi = false,
  fixtureIntent,
}: {
  sourceProjectId: string;
  expectedOwner?: string;
  keepForUi?: boolean;
  fixtureIntent?: PreparationFixtureIntent;
}) {
  assert.equal(process.env.PF_LOCAL_DEMO, 'true', 'Explicit isolated local demo required');
  policyUuidSchema.parse(sourceProjectId);
  const origin = process.env.PF_TEST_API_ORIGIN ?? 'http://127.0.0.1:4000',
    url = new URL(origin);
  assert.equal(url.origin, 'http://127.0.0.1:4000');
  assert.equal(url.pathname, '/');
  assert.equal(url.search, '');
  assert.equal(url.hash, '');
  assert.equal(url.username, '');
  assert.equal(url.password, '');
  const database = (await pool.query('SELECT current_database() AS name,current_user AS owner'))
    .rows[0];
  assert.equal(database.name, 'wfc_pathfinder_local');
  if (expectedOwner !== undefined) assert.equal(database.owner, expectedOwner);
  const source = (
    await pool.query(
      `SELECT to_jsonb(v) AS version,to_jsonb(j) AS job,to_jsonb(s) AS selection FROM model_versions v JOIN project_model_selections s ON s.project_id=v.project_id AND s.active_model_version_id=v.id JOIN model_import_jobs j ON j.id=v.owner_import_id AND j.project_id=v.project_id WHERE v.project_id=$1 AND v.state='ready' AND v.health='healthy'`,
      [sourceProjectId],
    )
  ).rows[0];
  assert.ok(source, 'A ready healthy source model is required; no conversion is performed.');
  const sourceBefore = hash(source);
  const { projectId, actorId, modelId, importId, password } = resolveFixtureIntent(
    fixtureIntent,
    sourceProjectId,
    source.version.id,
  );
  const marker = `PF-R3-${projectId}`,
    email = `${actorId}@pf-r3-integration.invalid`,
    checks: Check[] = [],
    cleanup: Check[] = [];
  let createdUser = false,
    createdProject = false,
    token = '';
  const passwordHash = await bcrypt.hash(password, 10);
  const base = `/api/projects/${projectId}/pathfinder`,
    preparations = base + '/preparations';
  async function request(method: string, route: string, body?: unknown, bearer = token) {
    assert.ok(route.startsWith(base + '/'));
    const response = await fetch(origin + route, {
      method,
      redirect: 'error',
      headers: {
        Authorization: `Bearer ${bearer}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(180000),
    });
    return { status: response.status, value: (await response.json()) as Json };
  }
  async function api(method: string, route: string, body?: unknown) {
    const response = await request(method, route, body);
    assert.ok(
      response.status >= 200 && response.status < 300,
      `${method} synthetic endpoint returned ${response.status} ${response.value.code ?? ''}`,
    );
    return response.value;
  }
  async function check(name: string, run: () => Promise<unknown>) {
    const details = await run();
    checks.push({ name, status: 'PASS', ...(details === undefined ? {} : { details }) });
  }
  async function pointer() {
    return (
      await pool.query(
        'SELECT geometry_revision::text,current_aggregate_id,current_artifact_id FROM pf_project_preparations WHERE project_id=$1',
        [projectId],
      )
    ).rows[0];
  }
  async function context() {
    return preparationContextSchema.parse(await api('GET', preparations + '/context'));
  }
  async function create() {
    const current = await context();
    const body = {
      schemaVersion: 'wfc.pf.preparation-create.v1',
      expected: current.scope,
      idempotencyKey: randomUUID(),
      discovery: preparationIntegrationDiscovery(current),
    };
    return {
      body,
      session: preparationSessionSchema.parse(await api('POST', preparations + '/', body)),
    };
  }
  async function waitPreview(id: string) {
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      const value = await api('GET', base + '/previews/' + id);
      if (value.status === 'complete') return value;
      if (['failed', 'cancelled'].includes(value.status))
        throw Error(`Synthetic preview ${value.status}: ${JSON.stringify(value.failure)}`);
      await delay(100);
    }
    throw Error('Synthetic preview exceeded deadline.');
  }
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET CONSTRAINTS ALL DEFERRED');
      await client.query(
        "INSERT INTO users(id,email,password_hash,is_admin,role) VALUES($1,$2,$3,true,'admin')",
        [actorId, email, passwordHash],
      );
      createdUser = true;
      await client.query(
        "INSERT INTO projects(id,project_number,name,customer,connection_gap,secondary_tray_length,end_connection_length,additional_bending_percent) VALUES($1,$2,$2,'Synthetic local control',1,0,0,0)",
        [projectId, marker],
      );
      createdProject = true;
      const job = {
        ...source.job,
        id: importId,
        project_id: projectId,
        requested_by: actorId,
        idempotency_key: randomUUID(),
        owner_token: randomUUID(),
        model_version_id: modelId,
      };
      await client.query(
        'INSERT INTO model_import_jobs SELECT * FROM jsonb_populate_record(NULL::model_import_jobs,$1::jsonb)',
        [JSON.stringify(job)],
      );
      const version = {
        ...source.version,
        id: modelId,
        project_id: projectId,
        owner_import_id: importId,
        imported_by: actorId,
        storage_prefix: `projects/${projectId}/versions/${modelId}/`,
      };
      await client.query(
        'INSERT INTO model_versions SELECT * FROM jsonb_populate_record(NULL::model_versions,$1::jsonb)',
        [JSON.stringify(version)],
      );
      await client.query(
        'UPDATE project_model_selections SET active_model_version_id=$2,selection_revision=1 WHERE project_id=$1',
        [projectId, modelId],
      );
      for (const name of ['/R301', '/R302'])
        await client.query(
          "INSERT INTO trays(id,project_id,name,purpose,width_mm,height_mm,length_mm) VALUES($1,$2,$3,'Synthetic Control',1000,100,10000)",
          [randomUUID(), projectId, name],
        );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    token = signAccessToken(actorId, email, true).token;
    await check(
      'unique synthetic metadata fixture; source model resources remain read-only',
      async () => ({
        projectId,
        modelId,
        sourceModelId: source.version.id,
        resourceCount: source.version.resource_count,
        objectWrites: 0,
        conversions: 0,
      }),
    );
    await api('GET', base + '/catalog');
    const policy = routePurposePolicySchema.parse(await api('GET', base + '/routing-permissions'));
    await api('PUT', base + '/routing-permissions', {
      schemaVersion: 'pathfinder.routing-purpose-policy.write.v1',
      expectedCatalogRevision: policy.catalogRevision,
      expectedRevision: policy.routingPolicyRevision,
      idempotencyKey: randomUUID(),
      changes: [
        { purposeKey: 'Synthetic Control', operation: 'set', allowedCategories: ['Control'] },
      ],
    });
    const planned = await create();
    assert.equal(planned.session.plan.partPlan.length, 2);
    assert.deepEqual(planned.session.plan.diagnostics, []);
    await check(
      'server freezes exactly two ordered parts with authoritative Control masks and replays create',
      async () => {
        const replay = preparationSessionSchema.parse(
          await api('POST', preparations + '/', planned.body),
        );
        assert.equal(replay.id, planned.session.id);
        assert.ok(
          replay.plan.partPlan.every((part) =>
            part.objects.every(
              (object) => JSON.stringify(object.allowedCategories) === '["Control"]',
            ),
          ),
        );
        return {
          sessionId: replay.id,
          parts: replay.plan.partPlan.length,
          physicalLeaves: replay.plan.requestedScope.orderedPhysicalLeafIds.length,
        };
      },
    );
    const payloads = planned.session.plan.partPlan.map((part) => ({
      partId: part.partId,
      payload: preparationIntegrationPart(planned.session.plan, part.partId),
    }));
    for (const part of [...payloads].reverse())
      await api('PUT', `${preparations}/${planned.session.id}/parts/${part.partId}`, {
        schemaVersion: 'wfc.pf.preparation-part.upload.v1',
        sessionPlanSha256: planned.session.plan.orderedPlanSha256,
        payload: part.payload,
      });
    await check(
      'reverse arrival commits exact receipts; replay is stable and conflicting bytes refuse',
      async () => {
        const part = payloads[0],
          body = {
            schemaVersion: 'wfc.pf.preparation-part.upload.v1',
            sessionPlanSha256: planned.session.plan.orderedPlanSha256,
            payload: part.payload,
          };
        const replay = preparationPartReceiptSchema.parse(
          await api('PUT', `${preparations}/${planned.session.id}/parts/${part.partId}`, body),
        );
        assert.equal(replay.duplicate, true);
        const changed = structuredClone(body);
        changed.payload.capture.adapterVersion += '-conflict';
        assert.equal(
          (
            await request(
              'PUT',
              `${preparations}/${planned.session.id}/parts/${part.partId}`,
              changed,
            )
          ).status,
          409,
        );
        return { partId: part.partId, payloadSha256: replay.part.payloadSha256 };
      },
    );
    const collected = preparationSessionSchema.parse(
      await api('GET', `${preparations}/${planned.session.id}`),
    );
    const publishBody = {
      schemaVersion: 'wfc.pf.preparation-mutation.v1',
      expectedSessionRevision: collected.sessionRevision,
      idempotencyKey: randomUUID(),
      reason: 'Synthetic whole-union two-part control',
    };
    const published = preparationPublicationSchema.parse(
      await api('POST', `${preparations}/${collected.id}/publish`, publishBody),
    );
    await check(
      'whole-union C# preparation atomically publishes one aggregate/artifact/trusted pointer',
      async () => {
        const current = await pointer();
        assert.equal(current.current_aggregate_id, published.aggregate.id);
        assert.equal(current.current_artifact_id, published.aggregate.artifactId);
        assert.equal(current.geometry_revision, published.aggregate.geometryRevision);
        assert.equal(published.aggregate.partReferences.length, 2);
        assert.equal(published.aggregate.engineeringAccepted, false);
        const counts = (
          await pool.query(
            'SELECT (SELECT count(*)::int FROM pf_preparation_aggregates WHERE project_id=$1) AS aggregates,(SELECT count(*)::int FROM pf_artifacts WHERE project_id=$1) AS artifacts',
            [projectId],
          )
        ).rows[0];
        assert.deepEqual(counts, { aggregates: 1, artifacts: 1 });
        return {
          aggregateId: published.aggregate.id,
          artifactId: published.aggregate.artifactId,
          counts,
        };
      },
    );
    await check(
      'manual-coordinate calculation crosses segments in different committed parts',
      async () => {
        const state = await api('GET', base + '/state');
        const accepted = await api('POST', base + '/previews', {
          from: { name: 'Synthetic start', point: [0, 0, 0.5] },
          to: { name: 'Synthetic end', point: [20.5, 0, 0.5] },
          category: 'Control',
          reverse: false,
          artifactId: published.aggregate.artifactId,
          expectedSelectionRevision: state.activeModel.selectionRevision,
          expectedSettingsRevision: state.settings.revision,
          expectedRegistryRevision: state.registryRevision,
          secondaryDistanceMeters: 2,
          preferVerticalApproach: true,
        });
        const result = await waitPreview(accepted.jobId);
        assert.equal(result.result.status, 'calculated');
        assert.equal(result.result.route.lengthMeters, 20.5);
        assert.equal(result.result.canApply, false);
        return { lengthMeters: result.result.route.lengthMeters, jobId: result.id };
      },
    );
    const trusted = await pointer();
    await check(
      'manual diagnostic artifact cannot supersede trusted project preparation',
      async () => {
        const merged = mergePreparationParts(planned.session.plan, payloads).snapshot;
        merged.capture.adapterVersion += '-manual';
        const state = await api('GET', base + '/state');
        await api('POST', base + '/artifacts', {
          modelVersionId: modelId,
          expectedSelectionRevision: state.activeModel.selectionRevision,
          expectedRegistryRevision: state.registryRevision,
          snapshot: merged,
        });
        assert.deepEqual(await pointer(), trusted);
      },
    );
    await check(
      'cancelled replacement retains previous whole aggregate; cancellation replays exactly',
      async () => {
        const replacement = await create(),
          body = {
            schemaVersion: 'wfc.pf.preparation-mutation.v1',
            expectedSessionRevision: replacement.session.sessionRevision,
            idempotencyKey: randomUUID(),
            reason: 'Synthetic cancellation control',
          };
        const cancelled = await api(
          'POST',
          `${preparations}/${replacement.session.id}/cancel`,
          body,
        );
        assert.equal(cancelled.state, 'cancelled');
        assert.deepEqual(
          await api('POST', `${preparations}/${replacement.session.id}/cancel`, body),
          cancelled,
        );
        assert.deepEqual(await pointer(), trusted);
      },
    );
    await check(
      'dependency mutation refuses old capture but historical publication receipt remains available',
      async () => {
        const replacement = await create();
        await pool.query(
          'UPDATE pf_project_state SET registry_revision=registry_revision+1 WHERE project_id=$1',
          [projectId],
        );
        const stale = await request('POST', `${preparations}/${replacement.session.id}/publish`, {
          schemaVersion: 'wfc.pf.preparation-mutation.v1',
          expectedSessionRevision: replacement.session.sessionRevision,
          idempotencyKey: randomUUID(),
          reason: 'Synthetic stale dependency control',
        });
        assert.equal(stale.status, 409);
        assert.equal(stale.value.code, 'PREPARATION_SCOPE_STALE');
        const replay = preparationPublicationSchema.parse(
          await api('POST', `${preparations}/${collected.id}/publish`, publishBody),
        );
        assert.equal(replay.duplicate, true);
        assert.equal(replay.aggregate.id, published.aggregate.id);
        assert.deepEqual(await pointer(), trusted);
      },
    );
    await check(
      'current nonadministrator and revoked login cannot read or replay preparation',
      async () => {
        await pool.query("UPDATE users SET is_admin=false,role='engineer' WHERE id=$1", [actorId]);
        assert.equal((await request('GET', preparations + '/context')).status, 403);
        await pool.query("UPDATE users SET is_admin=true,role='admin' WHERE id=$1", [actorId]);
        await api('GET', preparations + '/context');
        const loginId = (jwt.decode(token) as jwt.JwtPayload).jti;
        await pool.query(
          'UPDATE viewer_login_bindings SET revoked_at=now() WHERE user_id=$1 AND login_id=$2',
          [actorId, loginId],
        );
        assert.equal(
          (await request('POST', `${preparations}/${collected.id}/publish`, publishBody)).status,
          401,
        );
      },
    );
    await check('no cable Apply was attempted or persisted', async () => {
      assert.equal(
        (
          await pool.query(
            'SELECT count(*)::int AS count FROM pf_apply_receipts WHERE project_id=$1',
            [projectId],
          )
        ).rows[0].count,
        0,
      );
    });
  } catch (error) {
    checks.push({
      name: 'synthetic preparation sequence',
      status: 'FAIL',
      message: error instanceof Error ? error.message : 'Unknown failure',
    });
  } finally {
    try {
      if ((createdProject || createdUser) && !keepForUi)
        await cleanupPreparationFixture({ projectId, actorId, marker, email });
      if (keepForUi && createdUser) {
        await pool.query("UPDATE users SET is_admin=true,role='admin' WHERE id=$1 AND email=$2", [
          actorId,
          email,
        ]);
        token = signAccessToken(actorId, email, true).token;
      }
      assert.equal(
        (await pool.query('SELECT count(*)::int AS count FROM projects WHERE id=$1', [projectId]))
          .rows[0].count,
        keepForUi ? 1 : 0,
      );
      assert.equal(
        (await pool.query('SELECT count(*)::int AS count FROM users WHERE id=$1', [actorId]))
          .rows[0].count,
        keepForUi ? 1 : 0,
      );
      const sourceAfter = (
        await pool.query(
          'SELECT to_jsonb(v) AS version,to_jsonb(j) AS job,to_jsonb(s) AS selection FROM model_versions v JOIN project_model_selections s ON s.project_id=v.project_id AND s.active_model_version_id=v.id JOIN model_import_jobs j ON j.id=v.owner_import_id AND j.project_id=v.project_id WHERE v.project_id=$1',
          [sourceProjectId],
        )
      ).rows[0];
      assert.equal(hash(sourceAfter), sourceBefore);
      cleanup.push({
        name: keepForUi
          ? 'generated fixture retained privately for UI; source metadata unchanged'
          : 'exact generated project/user SQL cleanup; source metadata unchanged; no model-delete API or filesystem deletion',
        status: 'PASS',
      });
    } catch (error) {
      cleanup.push({
        name: 'owned SQL cleanup',
        status: 'FAIL',
        message: error instanceof Error ? error.message : 'Unknown cleanup failure',
      });
    }
  }
  return {
    schemaVersion: 'wfc.pf.preparation.integration.v1',
    recordedAtUtc: new Date().toISOString(),
    status:
      checks.every((check) => check.status === 'PASS') &&
      cleanup.every((check) => check.status === 'PASS')
        ? 'PASS'
        : 'FAIL',
    sourceProjectId,
    projectId,
    actorId,
    modelId,
    checks,
    cleanup,
    privateFixture: keepForUi
      ? { projectId, actorId, modelId, marker, email, password, token }
      : null,
    retainedEvidence:
      'Generated preparation/artifact files are retained; this runner performs SQL-only cleanup.',
    nativeParity: 'NOT_PERFORMED',
    realApply: 'NOT_PERFORMED',
  };
}

/** Private local UI fixture. Returned credentials must never be printed or put in Git. */
export async function createPreparationUiFixture({
  sourceProjectId,
  sourceTrayName,
  expectedOwner,
  fixtureIntent,
}: {
  sourceProjectId: string;
  sourceTrayName: string;
  expectedOwner?: string;
  fixtureIntent?: PreparationFixtureIntent;
}) {
  assert.equal(process.env.PF_LOCAL_DEMO, 'true');
  policyUuidSchema.parse(sourceProjectId);
  assert.ok(sourceTrayName.length > 0 && sourceTrayName.length <= 256);
  const origin = process.env.PF_TEST_API_ORIGIN ?? 'http://127.0.0.1:4000';
  assert.equal(origin, 'http://127.0.0.1:4000');
  const database = (await pool.query('SELECT current_database() AS name,current_user AS owner'))
    .rows[0];
  assert.equal(database.name, 'wfc_pathfinder_local');
  if (expectedOwner !== undefined) assert.equal(database.owner, expectedOwner);
  const source = (
    await pool.query(
      `SELECT to_jsonb(v) AS version,to_jsonb(j) AS job FROM model_versions v JOIN project_model_selections s ON s.project_id=v.project_id AND s.active_model_version_id=v.id JOIN model_import_jobs j ON j.id=v.owner_import_id AND j.project_id=v.project_id WHERE v.project_id=$1 AND v.state='ready' AND v.health='healthy'`,
      [sourceProjectId],
    )
  ).rows[0];
  assert.ok(source);
  assert.equal(
    (
      await pool.query('SELECT count(*)::int AS count FROM trays WHERE project_id=$1 AND name=$2', [
        sourceProjectId,
        sourceTrayName,
      ])
    ).rows[0].count,
    1,
    'Select one exact source tray name.',
  );
  const { projectId, actorId, modelId, importId, password } = resolveFixtureIntent(
    fixtureIntent,
    sourceProjectId,
    source.version.id,
  );
  const trayId = randomUUID(),
    marker = `PF-R3-UI-${projectId}`,
    email = `${actorId}@pf-r3-ui.invalid`,
    passwordHash = await bcrypt.hash(password, 10);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET CONSTRAINTS ALL DEFERRED');
    await client.query(
      "INSERT INTO users(id,email,password_hash,is_admin,role) VALUES($1,$2,$3,true,'admin')",
      [actorId, email, passwordHash],
    );
    await client.query(
      "INSERT INTO projects(id,project_number,name,customer,connection_gap,secondary_tray_length,end_connection_length,additional_bending_percent) VALUES($1,$2,$2,'Synthetic private UI control',1,0,0,0)",
      [projectId, marker],
    );
    const job = {
      ...source.job,
      id: importId,
      project_id: projectId,
      requested_by: actorId,
      idempotency_key: randomUUID(),
      owner_token: randomUUID(),
      model_version_id: modelId,
    };
    await client.query(
      'INSERT INTO model_import_jobs SELECT * FROM jsonb_populate_record(NULL::model_import_jobs,$1::jsonb)',
      [JSON.stringify(job)],
    );
    const version = {
      ...source.version,
      id: modelId,
      project_id: projectId,
      owner_import_id: importId,
      imported_by: actorId,
      storage_prefix: `projects/${projectId}/versions/${modelId}/`,
    };
    await client.query(
      'INSERT INTO model_versions SELECT * FROM jsonb_populate_record(NULL::model_versions,$1::jsonb)',
      [JSON.stringify(version)],
    );
    await client.query(
      'UPDATE project_model_selections SET active_model_version_id=$2,selection_revision=1 WHERE project_id=$1',
      [projectId, modelId],
    );
    await client.query(
      "UPDATE model_versions SET health='unavailable' WHERE project_id=$1 AND id=$2",
      [projectId, modelId],
    );
    await client.query(
      "INSERT INTO trays(id,project_id,name,purpose,width_mm,height_mm,length_mm) VALUES($1,$2,$3,'PF-R3 synthetic UI permission',1000,100,10000)",
      [trayId, projectId, sourceTrayName],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  const token = signAccessToken(actorId, email, true).token,
    base = `${origin}/api/projects/${projectId}/pathfinder`;
  const request = async (method: string, suffix: string, body?: unknown) => {
    const response = await fetch(base + suffix, {
      method,
      redirect: 'error',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
    assert.ok(response.ok, `Private UI fixture setup ${response.status}`);
    return response.json();
  };
  try {
    await request('GET', '/catalog');
    const policy = routePurposePolicySchema.parse(await request('GET', '/routing-permissions'));
    await request('PUT', '/routing-permissions', {
      schemaVersion: 'pathfinder.routing-purpose-policy.write.v1',
      expectedCatalogRevision: policy.catalogRevision,
      expectedRevision: policy.routingPolicyRevision,
      idempotencyKey: randomUUID(),
      changes: [
        {
          purposeKey: 'PF-R3 synthetic UI permission',
          operation: 'set',
          allowedCategories: ['Control'],
        },
      ],
    });
  } catch (error) {
    await cleanupPreparationFixture({ projectId, actorId, marker, email });
    throw error;
  }
  return {
    projectId,
    actorId,
    modelId,
    trayId,
    marker,
    email,
    password,
    token,
    sourceProjectId,
    sourceStoragePrefix: source.version.storage_prefix,
    targetStoragePrefix: `projects/${projectId}/versions/${modelId}/`,
    manifest: source.version.manifest,
    resourceCount: source.version.resource_count,
    totalBytes: source.version.total_bytes,
    modelHealth: 'unavailable-until-executor-verifies-owned-copy',
    resourcePolicy: 'metadata only; source resources read-only; no object writes or conversion',
  };
}
/** Exact-ID SQL-only cleanup; deliberately never invokes model/object deletion. */
export async function cleanupPreparationFixture({
  projectId,
  actorId,
  marker,
  email,
}: {
  projectId: string;
  actorId: string;
  marker: string;
  email: string;
}) {
  assert.equal(process.env.PF_LOCAL_DEMO, 'true');
  policyUuidSchema.parse(projectId);
  policyUuidSchema.parse(actorId);
  assert.ok(marker === `PF-R3-${projectId}` || marker === `PF-R3-UI-${projectId}`);
  assert.ok(
    email === `${actorId}@pf-r3-integration.invalid` || email === `${actorId}@pf-r3-ui.invalid`,
  );
  assert.equal(
    (await pool.query('SELECT current_database() AS name')).rows[0].name,
    'wfc_pathfinder_local',
  );
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET CONSTRAINTS ALL DEFERRED');
    const project = (
      await client.query('SELECT project_number FROM projects WHERE id=$1 FOR NO KEY UPDATE', [
        projectId,
      ])
    ).rows[0];
    const actor = (await client.query('SELECT email FROM users WHERE id=$1 FOR UPDATE', [actorId]))
      .rows[0];
    assert.ok(!project || project.project_number === marker, 'Project ownership marker mismatch');
    assert.ok(!actor || actor.email === email, 'Actor ownership marker mismatch');
    assert.ok(!project || actor, 'Owned project requires its matching generated actor');
    assert.equal(
      (
        await client.query(
          "SELECT count(*)::int AS count FROM pf_jobs WHERE project_id=$1 AND state IN ('queued','running')",
          [projectId],
        )
      ).rows[0].count,
      0,
      'Refuse cleanup while owned jobs remain queued or running',
    );
    assert.equal(
      (
        await client.query(
          "SELECT count(*)::int AS count FROM pf_preparation_sessions WHERE project_id=$1 AND state='validating'",
          [projectId],
        )
      ).rows[0].count,
      0,
      'Refuse cleanup while preparation validation is in progress',
    );
    if (project)
      await client.query('DELETE FROM projects WHERE id=$1 AND project_number=$2', [
        projectId,
        marker,
      ]);
    if (actor) {
      await client.query('DELETE FROM viewer_login_bindings WHERE user_id=$1', [actorId]);
      await client.query('DELETE FROM users WHERE id=$1 AND email=$2', [actorId, email]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
