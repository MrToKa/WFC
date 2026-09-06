// @vitest-environment node

import { Router, type Request, type Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

const connect = vi.hoisted(() => vi.fn());
vi.mock('../db.js', () => ({ pool: { connect } }));

import { registerStandardMaterialMutationRoutes } from './standardMaterialRoutes.js';

type Handler = (req: Request, res: Response) => Promise<void>;
type Layer = { route?: { methods: Record<string, boolean>; stack: { handle: Handler }[] } };

afterEach(() => vi.restoreAllMocks());

describe('standard material mutations', () => {
  it.each(['post', 'patch', 'delete'])(
    'returns JSON when a %s connection fails',
    async (method) => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      connect.mockRejectedValue(new Error('Database unavailable'));
      const router = Router();
      registerStandardMaterialMutationRoutes(router, 'tray', '/:trayId', 'trayId');
      const layers = (router as unknown as { stack: Layer[] }).stack;
      const handler = layers
        .find((layer) => layer.route?.methods[method])
        ?.route?.stack.at(-1)?.handle;
      if (!handler) throw new Error(`Missing ${method} handler`);
      const request = {
        params: {
          trayId: '00000000-0000-4000-8000-000000000001',
          assignmentId: '00000000-0000-4000-8000-000000000002',
        },
        body: {
          referencedMaterialId: '00000000-0000-4000-8000-000000000003',
          quantity: 2,
          unit: 'pcs',
        },
      } as unknown as Request;
      const response = { status: vi.fn(), json: vi.fn() };
      response.status.mockReturnValue(response);

      await handler(request, response as unknown as Response);

      expect(response.status).toHaveBeenCalledWith(500);
      expect(response.json).toHaveBeenCalledWith({ error: expect.any(String) });
    },
  );
});
