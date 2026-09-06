// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';

const connect = vi.hoisted(() => vi.fn());
vi.mock('../db.js', () => ({ pool: { connect } }));

import { withTransaction } from './transaction.js';

afterEach(() => vi.restoreAllMocks());

describe('withTransaction', () => {
  it('keeps the original failure and releases the client even when rollback also fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const originalError = new Error('Mutation failed');
    const rollbackError = new Error('Connection closed');
    const client = {
      query: vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(rollbackError),
      release: vi.fn(),
    };
    connect.mockResolvedValue(client);

    await expect(
      withTransaction(async () => {
        throw originalError;
      }),
    ).rejects.toBe(originalError);

    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.query).not.toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('releases the client when opening the transaction fails', async () => {
    const error = new Error('Database unavailable');
    const operation = vi.fn();
    const client = {
      query: vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce(undefined),
      release: vi.fn(),
    };
    connect.mockResolvedValue(client);

    await expect(withTransaction(operation)).rejects.toBe(error);

    expect(operation).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalledOnce();
  });
});
