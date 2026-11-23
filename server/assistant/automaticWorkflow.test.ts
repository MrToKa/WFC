// @vitest-environment node
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { it, expect, vi } from 'vitest';

const seams = vi.hoisted(() => ({
  query: vi.fn(),
  release: vi.fn(),
  auth: vi.fn(),
  model: vi.fn(),
  document: vi.fn(),
}));
vi.mock('../db.js', () => ({
  pool: { connect: async () => ({ query: seams.query, release: seams.release }) },
}));
vi.mock('../pathfinder/endpointBindingRepository.js', () => ({
  endpointBindingTransaction: seams.auth,
}));
vi.mock('./assignmentWorkflow.js', () => ({ runLocalAssignment: seams.model }));
vi.mock('./workerTransport.js', () => ({ analyzeDocument: seams.document }));
vi.mock('../services/objectStorageService.js', () => ({
  getObjectStream: async () => Readable.from('PDF'),
  getProjectBucket: () => 'project',
}));
vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs/promises')>()),
  readFile: vi.fn().mockResolvedValue('local-test-token'),
}));
import { startAssistantJobs } from './jobs.js';

it('follows an opted-in upload from document observations through verified model selection and binding without a second user action', async () => {
  const previousUrl = process.env.WFC_ASSISTANT_URL;
  process.env.WFC_ASSISTANT_URL = 'http://localhost:1';
  let tick!: () => void;
  const timer = vi.spyOn(globalThis, 'setInterval').mockImplementationOnce(((f: () => void) => {
    tick = f;
    return { unref() {} };
  }) as typeof setInterval);
  try {
    const job = {
      id: randomUUID(),
      project_id: randomUUID(),
      author: randomUUID(),
      instructions: '',
      rules: '',
      previous_job_id: null,
      follow_up_mode: 'documents',
      status: 'queued',
      scope: {},
      files: [{ name: 'rack.pdf', key: 'test-project/test.pdf' }],
      progress: 0,
      workflow_grant: {
        loginId: randomUUID(),
        loginExpiresAt: Date.now() + 60_000,
        replaceConflicting: true,
      },
    };
    const saved: unknown[] = [];
    let summary: unknown;
    seams.query.mockImplementation(async (sql: string, args: unknown[]) => {
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ ok: true }] };
      if (sql.startsWith('SELECT * FROM assistant_jobs')) return { rows: [job] };
      if (sql.includes('FROM users u')) return { rowCount: 1 };
      if (sql.includes('observations=observations')) {
        saved.push(...JSON.parse(String(args[1])));
        job.progress++;
      }
      if (sql.includes('SELECT workflow_mutations'))
        return { rows: [{ workflow_mutations: { T1: false, T2: true } }] };
      if (sql.includes("workflow_state='complete'")) summary = args[1];
      return { rows: [], rowCount: 1 };
    });
    seams.auth.mockImplementation(async (_pool, _pid, _who, action) => action({}));
    seams.document.mockResolvedValue({
      status: 200,
      result: {
        pages: [
          {
            page: 1,
            findings: [
              {
                tag: 'T1',
                target: 'R1',
                branch: '',
                property: '',
                review: false,
                relationKind: 'instrument-on-rack',
                evidence: 'schedule',
              },
            ],
            estimatedUsd: 0,
            usage: { totalTokens: 1 },
          },
        ],
        usage: { tokens: 1, estimatedUsd: 0 },
      },
    });
    seams.model.mockImplementation(async () => {
      expect(saved).toMatchObject([{ tag: 'T1', target: 'R1', page: 1, sourceIndex: 0 }]);
      return { checked: 3, assigned: 2, replaced: 1, review: 1, failed: 0, preserved: 0 };
    });
    startAssistantJobs();
    tick();
    await vi.waitFor(() => expect(seams.release).toHaveBeenCalledTimes(1));
    tick();
    await vi.waitFor(() => expect(seams.release).toHaveBeenCalledTimes(2));
    expect(seams.document).toHaveBeenCalledTimes(1);
    expect(seams.model).toHaveBeenCalledWith(
      job.project_id,
      job.id,
      {
        userId: job.author,
        loginId: job.workflow_grant.loginId,
        loginExpiresAt: job.workflow_grant.loginExpiresAt,
      },
      { autoApply: true, providerReview: true, replaceConflicting: true },
      true,
    );
    expect(summary).toEqual({
      checked: 3,
      assigned: 2,
      replaced: 1,
      review: 1,
      failed: 0,
      preserved: 0,
    });
  } finally {
    timer.mockRestore();
    if (previousUrl === undefined) delete process.env.WFC_ASSISTANT_URL;
    else process.env.WFC_ASSISTANT_URL = previousUrl;
  }
});

it('requires the original active login for deferred grants and never recreates a missing login', async () => {
  const { requireCurrentLogin } = await import('../pathfinder/auth.js');
  const who = { userId: randomUUID(), loginId: randomUUID(), loginExpiresAt: Date.now() + 60000 };
  const query = vi.fn();
  const client = { query } as unknown as import('pg').PoolClient;
  query.mockResolvedValue({ rows: [] });
  await expect(requireCurrentLogin(client, who, 'persisted-grant')).rejects.toMatchObject({
    status: 401,
  });
  query.mockResolvedValue({
    rows: [
      { user_id: who.userId, expires_at: new Date(who.loginExpiresAt), revoked_at: new Date() },
    ],
  });
  await expect(requireCurrentLogin(client, who, 'persisted-grant')).rejects.toMatchObject({
    status: 401,
  });
  query.mockResolvedValue({
    rows: [{ user_id: who.userId, expires_at: new Date(who.loginExpiresAt), revoked_at: null }],
  });
  await requireCurrentLogin(client, who, 'persisted-grant');
  expect(query.mock.calls.every(([sql]) => sql.startsWith('SELECT'))).toBe(true);
});
