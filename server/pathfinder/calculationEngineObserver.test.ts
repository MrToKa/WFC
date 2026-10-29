// @vitest-environment node
import type { Pool, PoolClient } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RECALCULATION_LIMITS } from '../../shared/pathfinderRecalculation.js';
import { barrierCalculationEngineIdentity as calculationEngineIdentity } from './calculationEngineIdentity.js';
import { createCalculationEngineObserver } from './calculationEngineObserver.js';
import { syntheticBarrierEngineIdentity as syntheticEngineIdentity } from './calculationFixtures.js';
import { PathFinderError } from './errors.js';
import { createRecalculationProducer } from './recalculationProducer.js';
import {
  markRecalculationEngineIdentity,
  markRecalculationEngineUnavailable,
} from './recalculationSchema.js';

vi.mock('./calculationEngineIdentity.js', () => ({ barrierCalculationEngineIdentity: vi.fn() }));
vi.mock('./recalculationSchema.js', () => ({
  markRecalculationEngineIdentity: vi.fn(),
  markRecalculationEngineUnavailable: vi.fn(),
}));

type Connection = {
  client: PoolClient;
  statements: string[];
  query: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
};

/** Database transports and implementation bytes are entirely mocked. */
function fixture(count = 2) {
  const projects = Array.from({ length: count }, (_, index) => ({
    project_id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  }));
  const order: string[] = [];
  const connections: Connection[] = [];
  const query = vi.fn(async (_sql: string, _parameters?: unknown[]) => {
    order.push('discover-projects');
    return { rows: projects };
  });
  let onStatement: (sql: string, index: number) => void | Promise<void> = () => undefined;
  const connect = vi.fn(async () => {
    const index = connections.length;
    const statements: string[] = [];
    const release = vi.fn();
    const clientQuery = vi.fn(async (sql: string) => {
      statements.push(sql);
      order.push(`connection-${index}:${sql}`);
      await onStatement(sql, index);
      return { rows: [] };
    });
    const client = { query: clientQuery, release } as unknown as PoolClient;
    connections.push({ client, statements, query: clientQuery, release });
    return client;
  });
  return {
    pool: { query, connect } as unknown as Pool,
    query,
    connect,
    connections,
    projects,
    order,
    onStatement: (operation: typeof onStatement) => { onStatement = operation; },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(calculationEngineIdentity).mockResolvedValue(syntheticEngineIdentity());
  vi.mocked(markRecalculationEngineIdentity).mockResolvedValue(true);
  vi.mocked(markRecalculationEngineUnavailable).mockResolvedValue(true);
});

describe('calculation engine observer with mocked database and implementation facts', () => {
  it.each([
    'WORKER_OWNER_CONNECTION_LOST',
    'WORKER_OWNER_CLOSE_FAILED',
    'ENGINE_IMPLEMENTATION_RESTART_REQUIRED',
  ])('keeps worker refusal %s visible without a binary identity read or engine claim', async code => {
    const db = fixture(5), unavailable = vi.fn(() => code);
    const claimNext = vi.fn(async () => null), enrollClaim = vi.fn();
    const producer = createRecalculationProducer({ claimNext, enrollClaim }, {
      beforeTick: createCalculationEngineObserver(db.pool, unavailable),
    });

    await producer.tick();

    expect(unavailable).toHaveBeenCalledTimes(1);
    expect(calculationEngineIdentity).not.toHaveBeenCalled();
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.query.mock.calls[0][1]).toEqual([
      null, code, RECALCULATION_LIMITS.producerProjectsPerTick,
    ]);
    expect(db.query.mock.calls[0][0]).toContain('engine_unavailable_code IS DISTINCT FROM $2');
    expect(markRecalculationEngineUnavailable).toHaveBeenCalledTimes(5);
    expect(markRecalculationEngineIdentity).not.toHaveBeenCalled();
    expect(db.connections).toHaveLength(5);
    db.connections.forEach((connection, index) => {
      expect(markRecalculationEngineUnavailable).toHaveBeenNthCalledWith(
        index + 1, connection.client, db.projects[index].project_id, code,
      );
      expect(connection.statements[0]).toBe('BEGIN');
      expect(connection.statements).toContain(
        "SET LOCAL lock_timeout='1000ms';SET LOCAL statement_timeout='3000ms'",
      );
      expect(connection.statements.at(-1)).toBe('COMMIT');
      expect(connection.release).toHaveBeenCalledExactlyOnceWith(undefined);
    });
    expect(producer.lastErrorCode).toBe(code);
    expect(claimNext).not.toHaveBeenCalled();
    expect(enrollClaim).not.toHaveBeenCalled();
    await producer.stop();
  });

  it('bounds project discovery to five with predicates that omit already observed identities', async () => {
    const db = fixture(5), value = syntheticEngineIdentity();
    await createCalculationEngineObserver(db.pool)(new AbortController().signal);

    const [sql, parameters] = db.query.mock.calls[0];
    expect(sql).toContain('engine_identity_sha256 IS DISTINCT FROM $1');
    expect(sql).toContain('engine_unavailable_code IS NOT NULL');
    expect(sql).toContain('ORDER BY project_id LIMIT $3');
    expect(parameters).toEqual([value.contentSha256, null, 5]);
    expect(calculationEngineIdentity).toHaveBeenCalledTimes(1);
    expect(db.connect).toHaveBeenCalledTimes(5);
    expect(markRecalculationEngineIdentity).toHaveBeenCalledTimes(5);
    expect(markRecalculationEngineUnavailable).not.toHaveBeenCalled();
  });

  it('does not open bookkeeping transactions when the database reports no changed project', async () => {
    const db = fixture(0);
    await createCalculationEngineObserver(db.pool)(new AbortController().signal);

    expect(calculationEngineIdentity).toHaveBeenCalledTimes(1);
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.connect).not.toHaveBeenCalled();
    expect(markRecalculationEngineIdentity).not.toHaveBeenCalled();
    expect(markRecalculationEngineUnavailable).not.toHaveBeenCalled();
  });

  it('commits each new identity before the producer can claim or enroll work', async () => {
    const db = fixture(2), value = syntheticEngineIdentity();
    vi.mocked(markRecalculationEngineIdentity).mockImplementation(async (client, projectId, digest) => {
      const index = db.connections.findIndex(connection => connection.client === client);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(digest).toBe(value.contentSha256);
      expect(projectId).toBe(db.projects[index].project_id);
      expect(db.connections[index].statements).not.toContain('COMMIT');
      db.order.push(`identity-${index}`);
      return true;
    });
    const claimNext = vi.fn(async () => {
      db.order.push('claim');
      expect(db.connections).toHaveLength(2);
      db.connections.forEach(connection => {
        expect(connection.statements.at(-1)).toBe('COMMIT');
        expect(connection.release).toHaveBeenCalledExactlyOnceWith(undefined);
      });
      return null;
    });
    const enrollClaim = vi.fn();
    const producer = createRecalculationProducer({ claimNext, enrollClaim }, {
      beforeTick: createCalculationEngineObserver(db.pool),
    });
    await producer.tick();

    expect(claimNext).toHaveBeenCalledTimes(1);
    expect(enrollClaim).not.toHaveBeenCalled();
    expect(db.order.indexOf('identity-0')).toBeLessThan(db.order.indexOf('connection-0:COMMIT'));
    expect(db.order.indexOf('connection-0:COMMIT')).toBeLessThan(db.order.indexOf('identity-1'));
    expect(db.order.indexOf('connection-1:COMMIT')).toBeLessThan(db.order.indexOf('claim'));
    expect(producer.lastErrorCode).toBeNull();
    await producer.stop();
  });

  it('records recovery through committed identity updates before resuming claims', async () => {
    const db = fixture(1);
    let refusal: string | null = 'ENGINE_IMPLEMENTATION_RESTART_REQUIRED';
    const unavailable = vi.fn(() => refusal), claimNext = vi.fn(async () => null), enrollClaim = vi.fn();
    const producer = createRecalculationProducer({ claimNext, enrollClaim }, {
      beforeTick: createCalculationEngineObserver(db.pool, unavailable),
    });
    await producer.tick();
    expect(producer.lastErrorCode).toBe(refusal);
    expect(claimNext).not.toHaveBeenCalled();
    expect(calculationEngineIdentity).not.toHaveBeenCalled();

    refusal = null;
    await producer.tick();

    expect(unavailable).toHaveBeenCalledTimes(2);
    expect(calculationEngineIdentity).toHaveBeenCalledTimes(1);
    expect(markRecalculationEngineUnavailable).toHaveBeenCalledExactlyOnceWith(
      db.connections[0].client, db.projects[0].project_id, 'ENGINE_IMPLEMENTATION_RESTART_REQUIRED',
    );
    expect(markRecalculationEngineIdentity).toHaveBeenCalledExactlyOnceWith(
      db.connections[1].client, db.projects[0].project_id, syntheticEngineIdentity().contentSha256,
    );
    expect(db.connections.map(connection => connection.statements.at(-1))).toEqual(['COMMIT', 'COMMIT']);
    expect(claimNext).toHaveBeenCalledTimes(1);
    expect(enrollClaim).not.toHaveBeenCalled();
    expect(producer.lastErrorCode).toBeNull();
    await producer.stop();
  });

  it.each([
    { error: new PathFinderError('CALCULATION_ENGINE_CHANGED', 503), code: 'CALCULATION_ENGINE_CHANGED' },
    { error: new Error('Private implementation filename and transport details.'), code: 'CALCULATION_ENGINE_UNAVAILABLE' },
  ])('persists the safe identity refusal $code before refusing the tick', async ({ error, code }) => {
    const db = fixture(1);
    vi.mocked(calculationEngineIdentity).mockRejectedValue(error);
    await expect(createCalculationEngineObserver(db.pool)(new AbortController().signal))
      .rejects.toMatchObject({ code, status: 503, message: code });

    expect(db.query.mock.calls[0][1]).toEqual([null, code, 5]);
    expect(markRecalculationEngineUnavailable).toHaveBeenCalledExactlyOnceWith(
      db.connections[0].client, db.projects[0].project_id, code,
    );
    expect(markRecalculationEngineIdentity).not.toHaveBeenCalled();
    expect(db.connections[0].statements.at(-1)).toBe('COMMIT');
  });

  it('still refuses unavailable computation when no project needs a status update', async () => {
    const db = fixture(0), code = 'WORKER_OWNER_CONNECTION_LOST';
    await expect(createCalculationEngineObserver(db.pool, () => code)(new AbortController().signal))
      .rejects.toMatchObject({ code, status: 503 });

    expect(calculationEngineIdentity).not.toHaveBeenCalled();
    expect(db.connect).not.toHaveBeenCalled();
    expect(markRecalculationEngineUnavailable).not.toHaveBeenCalled();
  });

  it('honors cancellation before observing worker availability or reading implementation facts', async () => {
    const db = fixture(), unavailable = vi.fn(() => null), controller = new AbortController();
    const reason = new Error('Synthetic stop before observation.');
    controller.abort(reason);
    await expect(createCalculationEngineObserver(db.pool, unavailable)(controller.signal)).rejects.toBe(reason);

    expect(unavailable).not.toHaveBeenCalled();
    expect(calculationEngineIdentity).not.toHaveBeenCalled();
    expect(db.query).not.toHaveBeenCalled();
    expect(db.connect).not.toHaveBeenCalled();
  });

  it('does not start a write after cancellation during project discovery', async () => {
    const db = fixture(), controller = new AbortController(), reason = new Error('Synthetic discovery cancellation.');
    db.query.mockImplementation(async () => { controller.abort(reason); return { rows: db.projects }; });
    await expect(createCalculationEngineObserver(db.pool)(controller.signal)).rejects.toBe(reason);

    expect(db.connect).not.toHaveBeenCalled();
    expect(markRecalculationEngineIdentity).not.toHaveBeenCalled();
    expect(markRecalculationEngineUnavailable).not.toHaveBeenCalled();
  });

  it.each(['identity', 'unavailable'] as const)('rolls back %s bookkeeping cancelled before commit and never visits the next project', async mode => {
    const db = fixture(2), controller = new AbortController(), reason = new Error('Synthetic observation cancellation.');
    const abort = async () => { controller.abort(reason); return true; };
    if (mode === 'identity') vi.mocked(markRecalculationEngineIdentity).mockImplementation(abort);
    else vi.mocked(markRecalculationEngineUnavailable).mockImplementation(abort);

    await expect(createCalculationEngineObserver(db.pool, () => mode === 'unavailable' ? 'WORKER_FATAL' : null)(controller.signal))
      .rejects.toBe(reason);

    expect(db.connections).toHaveLength(1);
    expect(db.connections[0].statements).not.toContain('COMMIT');
    expect(db.connections[0].statements.at(-1)).toBe('ROLLBACK');
    expect(db.connections[0].release).toHaveBeenCalledExactlyOnceWith(undefined);
    expect(mode === 'identity' ? markRecalculationEngineIdentity : markRecalculationEngineUnavailable).toHaveBeenCalledTimes(1);
  });

  it('does not claim work when the first project identity could not be persisted', async () => {
    const db = fixture(2);
    vi.mocked(markRecalculationEngineIdentity).mockRejectedValue(
      new PathFinderError('RECALCULATION_DATABASE_BUSY', 503),
    );
    const claimNext = vi.fn(async () => null), enrollClaim = vi.fn();
    const producer = createRecalculationProducer({ claimNext, enrollClaim }, {
      beforeTick: createCalculationEngineObserver(db.pool),
    });
    await producer.tick();

    expect(producer.lastErrorCode).toBe('RECALCULATION_DATABASE_BUSY');
    expect(db.connections).toHaveLength(1);
    expect(db.connections[0].statements).not.toContain('COMMIT');
    expect(db.connections[0].statements.at(-1)).toBe('ROLLBACK');
    expect(db.connections[0].release).toHaveBeenCalledExactlyOnceWith(undefined);
    expect(markRecalculationEngineIdentity).toHaveBeenCalledTimes(1);
    expect(claimNext).not.toHaveBeenCalled();
    expect(enrollClaim).not.toHaveBeenCalled();
    await producer.stop();
  });

  it('retains an unknown bookkeeping commit as a refusal and never enters claims', async () => {
    const db = fixture(2);
    db.onStatement(sql => { if (sql === 'COMMIT') throw new Error('Synthetic lost commit acknowledgement.'); });
    const claimNext = vi.fn(async () => null), enrollClaim = vi.fn();
    const producer = createRecalculationProducer({ claimNext, enrollClaim }, {
      beforeTick: createCalculationEngineObserver(db.pool),
    });
    await producer.tick();

    expect(producer.lastErrorCode).toBe('SCHEDULER_COMMIT_OUTCOME_UNKNOWN');
    expect(db.connections).toHaveLength(1);
    expect(db.connections[0].statements.slice(-2)).toEqual(['COMMIT', 'ROLLBACK']);
    expect(db.connections[0].release).toHaveBeenCalledExactlyOnceWith(true);
    expect(markRecalculationEngineIdentity).toHaveBeenCalledTimes(1);
    expect(claimNext).not.toHaveBeenCalled();
    expect(enrollClaim).not.toHaveBeenCalled();
    await producer.stop();
  });
});
