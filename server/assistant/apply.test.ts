// @vitest-environment node
import express from 'express';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
const seams = vi.hoisted(() => ({
  query: vi.fn(),
  checkModel: vi.fn(),
  bind: vi.fn(),
  provider: vi.fn(),
  impact: vi.fn(),
  local: vi.fn(),
  matched: vi.fn(),
  heads: vi.fn(),
  resolve: vi.fn(),
  prep: vi.fn(),
  preflight: vi.fn(),
}));
vi.mock('../db.js', () => ({ pool: { query: seams.preflight } }));
vi.mock('./providerModelReview.js', () => ({ requestModelDecisions: seams.provider }));
vi.mock('./jobs.js', () => ({ resolveFindings: seams.resolve }));
vi.mock('./localRackIndex.js', () => ({ prepareLocalRackIndex: seams.prep }));
vi.mock('./localModelEvidence.js', () => ({ assistantLocalModelEvidence: seams.local }));
vi.mock('../pathfinder/transactions.js', () => ({
  transaction: (_pool: unknown, run: (c: unknown) => unknown) => run({ query: seams.query }),
}));
vi.mock('../services/objectStorageService.js', () => ({
  getProjectBucket: vi.fn(),
  getObjectStream: vi.fn(),
}));
vi.mock('../middleware.js', () => ({
  requireProjectEdit: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('../pathfinder/endpointBindingRepository.js', () => ({
  endpointBindingTransaction: (
    _pool: unknown,
    _proj: unknown,
    _principal: unknown,
    op: (c: unknown) => unknown,
  ) => op({ query: seams.query }),
  readCurrentEndpointBindingContext: seams.checkModel,
  endpointBindingHash: JSON.stringify,
  confirmEndpointBindingChangeInTransaction: seams.bind,
  confirmMatchedEndpointInTransaction: seams.matched,
  readNeededEndpointBindingHeads: seams.heads,
}));
vi.mock('../pathfinder/locationImpactRepository.js', () => ({
  appendLocationImpactInTransaction: seams.impact,
}));
import { assistantRouter } from './routes.js';
const id = randomUUID(),
  project = randomUUID(),
  job = randomUUID();
const scope = { modelVersionId: randomUUID(), traceId: randomUUID() };
const proposal = {
  id,
  tag: 'T1',
  aliases: [],
  locationId: randomUUID(),
  ref: { objectRevisionId: randomUUID() },
  revision: '2',
};
let receipt: Record<string, string>;
let admin = true;
let server: Server, base: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json(), (req, _res, next) => {
    req.isAdmin = admin;
    req.userId = randomUUID();
    req.loginId = randomUUID();
    req.loginExpiresAt = Date.now() + 60000;
    next();
  });
  app.use('/:projectId/assistant', assistantRouter);
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base =
    'http://127.0.0.1:' +
    (server.address() as { port: number }).port +
    '/' +
    project +
    '/assistant/jobs/' +
    job +
    '/apply';
});
afterAll(
  () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    }),
);
beforeEach(() => {
  vi.clearAllMocks();
  receipt = {};
  admin = true;
  seams.checkModel.mockResolvedValue(scope);
  seams.impact.mockResolvedValue({ id: 'impact-1' });
  seams.bind.mockResolvedValue({ id: 'binding-1' });
  seams.query.mockImplementation(async (sql: string, args: unknown[]) => {
    if (sql.startsWith('SELECT scope'))
      return { rows: [{ scope, proposals: [proposal], applied: receipt, status: 'review' }] };
    if (sql.startsWith('SELECT id FROM cables')) return { rows: [{ id: 'cable' }] };
    if (sql.startsWith('SELECT registry')) return { rows: [{ revision: '4' }] };
    if (sql.startsWith('UPDATE assistant_jobs'))
      Object.assign(receipt, JSON.parse(String(args[1])));
    return { rows: [], rowCount: 0 };
  });
});
const apply = () =>
  fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
it('reconciles repeated approval to the original binding and routing impact', async () => {
  expect((await apply()).status).toBe(200);
  expect(await (await apply()).json()).toEqual({ impact: 'impact-1' });
  expect(seams.bind).toHaveBeenCalledTimes(1);
  expect(seams.impact).toHaveBeenCalledTimes(1);
  // Location-wide binding impacts have no originating cable. Native v1 requires both fields absent.
  expect(seams.impact.mock.calls[0][1]).not.toHaveProperty('automaticPairPolicy');
  expect(seams.impact.mock.calls[0][1]).not.toHaveProperty('originCableId');
  expect(seams.bind.mock.calls[0][4]).toMatchObject({
    idempotencyKey: id,
    expectedLocationRevision: '2',
    expectedHeadId: null,
  });
});
it('requires a fresh review after model selection changes', async () => {
  seams.checkModel.mockResolvedValue({ ...scope, traceId: randomUUID() });
  expect((await apply()).status).toBe(409);
  expect(seams.bind).not.toHaveBeenCalled();
});
it('replaces proven conflicting bindings for a pilot and then in bulk, only while each prior head and rack proof still match', async () => {
  const otherId = randomUUID();
  const proof = {
    dbId: 31,
    rackDbId: 45,
    modelName: 'T1_1',
    rackName: 'R',
    bounds: { minimum: [0, 0, 0], maximum: [2, 2, 2] },
    point: [1, 1, 0],
    visibilityScopeSha256: 'a'.repeat(64),
  };
  const pending = [id, otherId].map((value, index) => ({
    ...proposal,
    id: value,
    tag: 'T' + (index + 1),
    target: 'R',
    locationId: randomUUID(),
    ref: null,
    localModel: proof,
    existingModelObjectId: 28,
    replaceHeadId: randomUUID(),
    reason: 'Unique visible instrument on documented rack',
  }));
  seams.resolve.mockImplementation(async (_c, _pid, _scope, items) =>
    pending.filter((p) => items.some((f: { tag: string }) => f.tag === p.tag)),
  );
  seams.preflight.mockResolvedValue({
    rows: [{ active_model: scope.modelVersionId, prior_model: scope.modelVersionId }],
  });
  seams.local.mockResolvedValue(proof);
  seams.heads.mockImplementation(async (_c, { locationIds }) => {
    const p = pending.find((p) => p.locationId === locationIds[0])!;
    return new Map([
      [
        p.locationId,
        { ready: true, binding: { id: p.replaceHeadId, autoMatchEvidence: { sdkObjectId: 28 } } },
      ],
    ]);
  });
  seams.matched.mockResolvedValue({ id: 'verified-binding' });
  seams.query.mockImplementation(async (sql: string, args: unknown[]) => {
    if (sql.includes('SELECT j.status'))
      return {
        rows: [
          {
            status: 'review',
            scope,
            observations: pending,
            proposals: pending,
            applied: receipt,
            follow_up_mode: 'documents',
            rules_revision: 1,
            active_rules_revision: 1,
          },
        ],
      };
    if (sql.startsWith('SELECT scope'))
      return { rows: [{ scope, proposals: pending, applied: receipt, status: 'review' }] };
    if (sql.startsWith('SELECT registry')) return { rows: [{ revision: '4' }] };
    if (sql.startsWith('SELECT id FROM cables')) return { rows: [{ id: 'cable' }] };
    if (sql.startsWith('UPDATE assistant_jobs SET applied'))
      Object.assign(receipt, JSON.parse(String(args[1])));
    return { rows: [], rowCount: 0 };
  });
  const recheck = (tag?: string) =>
    fetch(base.replace(/apply$/, 'recheck'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ autoApply: true, replaceConflicting: true, tag }),
    });
  expect((await apply()).status).toBe(409);
  admin = false;
  expect((await recheck('T1')).status).toBe(403);
  admin = true;
  const first = await recheck('T1');
  expect(first.status).toBe(200);
  expect(await first.json()).toMatchObject({ checked: 1, assigned: 1, replaced: 1, failed: 0 });
  expect(await (await recheck()).json()).toMatchObject({
    checked: 2,
    assigned: 1,
    replaced: 1,
    preserved: 1,
    failed: 0,
  });
  expect(seams.matched.mock.calls[0][3]).toMatchObject({
    expectedHeadId: pending[0].replaceHeadId,
    replaceVerifiedRackBinding: { expectedObjectId: 28 },
    evidence: { sdkObjectId: 31 },
  });
  expect(seams.impact).toHaveBeenCalledTimes(2);
  receipt = {};
  seams.heads.mockResolvedValue(new Map());
  expect(await (await recheck('T1')).json()).toMatchObject({
    checked: 1,
    assigned: 0,
    replaced: 0,
    failed: 1,
  });
  expect(seams.matched).toHaveBeenCalledTimes(2);
});
it('records the provider decision and requires agreement with the local object on every write path', async () => {
  let stored = [
    { ...proposal, dbId: 31, logicalTag: 'T1', target: 'R', reason: 'Ready for review' },
  ] as Array<Record<string, unknown>>;
  const findings = [{ tag: 'T1' }];
  seams.resolve.mockImplementation(async () => [
    {
      ...proposal,
      id: randomUUID(),
      dbId: 31,
      logicalTag: 'T1',
      target: 'R',
      reason: 'Ready for review',
    },
  ]);
  seams.preflight.mockResolvedValue({
    rows: [{ active_model: scope.modelVersionId, prior_model: scope.modelVersionId }],
  });
  seams.query.mockImplementation(async (sql: string, args: unknown[]) => {
    if (sql.includes('SELECT j.status'))
      return {
        rows: [
          {
            status: 'review',
            scope,
            observations: findings,
            proposals: stored,
            applied: receipt,
            follow_up_mode: 'documents',
            rules_revision: 1,
            active_rules_revision: 1,
          },
        ],
      };
    if (sql.startsWith('SELECT scope'))
      return {
        rows: [{ scope, proposals: structuredClone(stored), applied: receipt, status: 'review' }],
      };
    if (sql.startsWith('SELECT registry')) return { rows: [{ revision: '4' }] };
    if (sql.startsWith('SELECT id FROM cables')) return { rows: [{ id: 'cable' }] };
    if (sql.startsWith('UPDATE assistant_jobs SET scope')) stored = JSON.parse(String(args[3]));
    if (sql.startsWith('UPDATE assistant_jobs SET proposals')) stored = JSON.parse(String(args[2]));
    if (sql.startsWith('UPDATE assistant_jobs SET applied'))
      Object.assign(receipt, JSON.parse(String(args[1])));
    return { rows: [], rowCount: 0 };
  });
  const recheck = (providerReview: boolean) =>
    fetch(base.replace(/apply$/, 'recheck'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ autoApply: true, providerReview }),
    });
  const individual = () =>
    fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: stored[0].id }),
    });
  admin = false;
  expect((await recheck(true)).status).toBe(403);
  expect(seams.provider).not.toHaveBeenCalled();
  admin = true;
  seams.provider.mockRejectedValueOnce(
    new (await import('../pathfinder/errors.js')).PathFinderError(
      'ASSISTANT_MODEL_REVIEW_UNAVAILABLE',
      422,
    ),
  );
  expect((await recheck(true)).status).toBe(422);
  expect((await individual()).status).toBe(409);
  expect(await (await recheck(false)).json()).toMatchObject({ review: 1, assigned: 0 });
  seams.provider.mockImplementation(async (_pid, _job, _scope, candidates) => {
    expect((await individual()).status).toBe(409);
    return { decisions: new Map([[candidates[0].id, { objectId: 24, reason: 'Conflicting candidate' }]]), requestUsage: { tokens: 612, estimatedUsd: 0.0033 } };
  });
  expect(await (await recheck(true)).json()).toMatchObject({ review: 1, assigned: 0, requestUsage: { tokens: 612, estimatedUsd: 0.0033 } });
  expect((await individual()).status).toBe(409);
  expect(await (await recheck(false)).json()).toMatchObject({ review: 1, assigned: 0 });
  expect(seams.bind).not.toHaveBeenCalled();
  seams.provider.mockImplementation(
    async (_pid, _job, _scope, candidates) =>
      ({ decisions: new Map([[candidates[0].id, { objectId: 31, reason: 'Confirmed visible instrument' }]]), requestUsage: { tokens: 612, estimatedUsd: 0.0033 } }),
  );
  seams.bind.mockRejectedValueOnce(
    new (await import('../pathfinder/errors.js')).PathFinderError('TEMPORARY_TEST_CONFLICT', 409),
  );
  expect(await (await recheck(true)).json()).toMatchObject({ review: 0, assigned: 0, failed: 1 });
  const paidReviews = seams.provider.mock.calls.length;
  expect(await (await recheck(true)).json()).toMatchObject({ review: 0, assigned: 1, requestUsage: { tokens: 0, estimatedUsd: 0 } });
  expect(seams.provider).toHaveBeenCalledTimes(paidReviews);
  expect(seams.bind).toHaveBeenCalledTimes(2);
});
