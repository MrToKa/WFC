// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
const fx = vi.hoisted(() => ({ query: vi.fn(), repair: vi.fn() }));
vi.mock('./schedulerTransaction.js', () => ({ schedulerTransaction: async (_pool: unknown, operation: (client: unknown) => unknown) => operation({ query: fx.query }) }));
vi.mock('./automaticRoutingMigrationRepair.js', () => ({ repairAutomaticRoutingMigrationControls: fx.repair }));
import { initializeCableRoutingControlSchema } from './cableRoutingControlSchema.js';

const fresh = (cableId: string, extra = {}) => ({ project_id: 'project', cable_id: cableId, manual_protected: true,
  execution_locked: false, migration_kind: 'routing-control-bootstrap.v1', ...extra });
beforeEach(() => { vi.clearAllMocks(); fx.repair.mockResolvedValue({ repaired: 1 }); });
describe('new routing controls retain proven automatic origin', () => {
  it('repairs only rows returned by the first bootstrap, preserving an existing control on restart', async () => {
    fx.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce([{ rows: [] }, { rows: [fresh('automatic')] }, { rows: [] }]);
    await initializeCableRoutingControlSchema({} as Pool);
    expect(fx.repair).toHaveBeenCalledWith(expect.anything(), { projectId: 'project', cableIds: ['automatic'], dryRun: false }, expect.any(Function));
    fx.repair.mockClear();
    fx.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce([{ rows: [] }, { rows: [] }]);
    await initializeCableRoutingControlSchema({} as Pool);
    expect(fx.repair).not.toHaveBeenCalled();
  });
  it('does not release execution protection or infer a repair from other query results', async () => {
    fx.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce([{ rows: [fresh('executed', { execution_locked: true }),
      fresh('unprotected', { manual_protected: false }), { project_id: 'project', cable_id: 'other' }] }]);
    await initializeCableRoutingControlSchema({} as Pool);
    expect(fx.repair).not.toHaveBeenCalled();
  });
  it('rolls the bootstrap transaction back through its caller if strict proof verification fails unexpectedly', async () => {
    fx.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce([{ rows: [fresh('automatic')] }]);
    fx.repair.mockRejectedValueOnce(new Error('database transport failed'));
    await expect(initializeCableRoutingControlSchema({} as Pool)).rejects.toThrow('database transport failed');
  });
});
