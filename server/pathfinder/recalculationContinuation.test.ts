// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createRecalculationRepository } from './recalculationRepository.js';
import { recalculationFixture, RECALCULATION_FIXTURE as f } from './recalculationFixtures.js';
import { AUTOMATIC_PAIR_POLICY } from '../../shared/pathfinderAutomaticPair.js';

const nextKey = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const enable = { schemaVersion: 'wfc.pf.recalculation-command.v2' as const, action: 'enable' as const,
  expectedControlRevision: '1', idempotencyKey: f.key, reason: 'Enable finite automatic output.',
  preferences: { secondaryDistanceMeters: 2, preferVerticalApproach: true }, timeoutMilliseconds: 60000, automaticPairPolicy: AUTOMATIC_PAIR_POLICY };
async function fixture(enabled = true) {
  const x = recalculationFixture(), repo = createRecalculationRepository(x.pool, x.adapter);
  const original = x.query.getMockImplementation()!;
  x.query.mockImplementation(async (raw, args = []) => {
    const sql = typeof raw === 'string' ? raw : raw.text;
    if (sql.includes('automatic-generation:continuation-enable-command')) {
      const row = x.db.commands.get(args[2]); return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    return original(raw, args);
  });
  const receipt = enabled ? await repo.command(f.projectId, x.who, enable) : null;
  const command = (action: 'resume' | 'retry' = 'retry') => ({ schemaVersion: 'wfc.pf.recalculation-command.v2' as const, action,
    expectedControlRevision: x.db.state.control_revision, idempotencyKey: nextKey, reason: 'Continue original output permission.', automaticPairPolicy: AUTOMATIC_PAIR_POLICY });
  return { ...x, repo, receipt, command };
}
describe('nonrenewing automatic output continuation', () => {
  it.each(['resume', 'retry'] as const)('continues %s only with the original exact finite output proof', async action => {
    const x = await fixture(), original = structuredClone(x.receipt!.automaticPairAuthorization);
    if (action === 'resume') x.db.state.paused = true;
    const receipt = await x.repo.command(f.projectId, x.who, x.command(action));
    expect(receipt.automaticPairAuthorization).toEqual(original);
    expect(x.db.state.automatic_pair_authority).toEqual(original);
    expect(receipt.context.automaticPairPolicy).toEqual(AUTOMATIC_PAIR_POLICY);
  });
  it.each(['missing', 'expired', 'wrong-login', 'changed-command', 'changed-receipt', 'admin-revision', 'installation'] as const)('refuses %s original output instead of launching a proposal-only generation', async kind => {
    const x = await fixture(kind !== 'missing'), before = structuredClone(x.db.state);
    const originalQuery = x.query.getMockImplementation()!;
    if (kind === 'expired') vi.spyOn(Date, 'now').mockReturnValue(Date.parse(x.receipt!.automaticPairAuthorization!.authorityExpiresAt) + 1);
    if (kind === 'wrong-login') x.db.state.automatic_pair_authority.loginId = nextKey;
    if (kind === 'changed-command') x.db.commands.get(f.key)!.request.reason = 'Substituted';
    if (kind === 'changed-receipt') x.db.commands.get(f.key)!.receipt.automaticPairAuthorization = undefined;
    if (kind === 'admin-revision' || kind === 'installation') x.query.mockImplementation(async (sql, args) => {
      if (String(sql).includes('automatic-generation:enable-principal')) return { rows: [{ is_admin: true,
        admin_revision: kind === 'admin-revision' ? '999' : '1', installation_epoch: kind === 'installation' ? nextKey : f.owner }], rowCount: 1 };
      return originalQuery(sql, args);
    });
    try {
      await expect(x.repo.command(f.projectId, x.who, x.command())).rejects.toMatchObject({ code: 'AUTOMATIC_OUTPUT_ENABLE_REQUIRED', status: 409 });
      expect(x.db.state.control_revision).toBe(before.control_revision);
      expect(x.db.state.desired_generation).toBe(before.desired_generation);
      expect(x.db.commands.has(nextKey)).toBe(false);
    } finally { vi.restoreAllMocks(); }
  });
  it('replays an exact successful historical continuation after output expiry without renewing anything', async () => {
    const x = await fixture(), command = x.command(), first = await x.repo.command(f.projectId, x.who, command), state = structuredClone(x.db.state);
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(first.automaticPairAuthorization!.authorityExpiresAt) + 1);
    try {
      expect(await x.repo.command(f.projectId, x.who, command)).toEqual({ ...first, duplicate: true });
      expect(x.db.state).toEqual(state);
    } finally { vi.restoreAllMocks(); }
  });
  it.each(['final-proof-read', 'receipt-insert'] as const)('rolls back when original output expires during %s', async phase => {
    const x = await fixture(), before = structuredClone(x.db.state), original = x.query.getMockImplementation()!;
    const realNow = Date.now(), expires = Date.parse(x.receipt!.automaticPairAuthorization!.authorityExpiresAt), clock = vi.spyOn(Date, 'now').mockReturnValue(realNow);
    let proofReads = 0;
    x.query.mockImplementation(async (raw, args = []) => {
      const sql = typeof raw === 'string' ? raw : raw.text, result = await original(raw, args);
      if (sql.includes('automatic-generation:continuation-enable-command') && ++proofReads === 2 && phase === 'final-proof-read'
        || sql.startsWith('INSERT INTO pf_recalculation_commands') && args[2] === nextKey && phase === 'receipt-insert') clock.mockReturnValue(expires + 1);
      return result;
    });
    try {
      await expect(x.repo.command(f.projectId, x.who, x.command())).rejects.toMatchObject({ code: 'AUTOMATIC_OUTPUT_ENABLE_REQUIRED' });
      expect(JSON.parse(JSON.stringify(x.db.state))).toEqual(JSON.parse(JSON.stringify(before))); expect(x.db.commands.has(nextKey)).toBe(false);
    } finally { vi.restoreAllMocks(); }
  });
});
