// @vitest-environment node
import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const remove = vi.hoisted(() => vi.fn());
vi.mock('../services/catalogCompositionService.js', () => ({ deleteCatalogOwner: remove }));
vi.mock('../db.js', () => ({ pool: { connect: vi.fn() } }));
import { catalogOwnerDeleteHandler } from './catalogOwnerRoutes.js';
import { MutationError } from '../services/mutationService.js';

const ownerId = '00000000-0000-4000-8000-000000000001';
const actorId = '00000000-0000-4000-8000-000000000002';
const invoke = async (headers: Record<string, string> = { 'If-Match': '"4"', 'Idempotency-Key': 'delete-one' }) => {
  const request = { params: { ownerId }, userId: actorId, header: (name: string) => headers[name] } as unknown as Request;
  const response = { status: vi.fn(), json: vi.fn(), setHeader: vi.fn() };
  response.status.mockReturnValue(response);
  await catalogOwnerDeleteHandler('cable-type', 'ownerId')(request, response as unknown as Response, vi.fn());
  return response;
};

beforeEach(() => { remove.mockReset(); });
describe('catalog owner deletion contract', () => {
  it('requires the revision viewed by the caller before entering the deletion service', async () => {
    const response = await invoke({ 'Idempotency-Key': 'delete-one' });
    expect(response.status).toHaveBeenCalledWith(428);
    expect(remove).not.toHaveBeenCalled();
  });
  it('returns the committed graph revision for subsequent displayed-row actions', async () => {
    remove.mockResolvedValue({ value: { deleted: true }, revision: 5, replayed: false });
    const response = await invoke();
    expect(remove).toHaveBeenCalledWith({ actorId, idempotencyKey: 'delete-one', expectedRevision: 4 }, 'cable-type', ownerId);
    expect(response.json).toHaveBeenCalledWith({ obsolete: true, mutationRevision: 5 });
    expect(response.setHeader).toHaveBeenCalledWith('ETag', '"5"');
  });
  it('preserves revision conflicts for reload and review', async () => {
    remove.mockRejectedValue(new MutationError(409, 'REVISION_CONFLICT', 'Reload first.'));
    const response = await invoke();
    expect(response.status).toHaveBeenCalledWith(409);
    expect(response.json).toHaveBeenCalledWith({ error: 'Reload first.', code: 'REVISION_CONFLICT' });
  });
  it.each(['23503', '23001'])('reports PostgreSQL foreign-key protection %s as a conflict', async (code) => {
    remove.mockRejectedValue({ code });
    const response = await invoke();
    expect(response.status).toHaveBeenCalledWith(409);
  });
});
