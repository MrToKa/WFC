import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';

export const materialAuditActor = new AsyncLocalStorage<string>();

export const withMaterialAuditActor = (req: Request, _res: Response, next: NextFunction): void => {
  // Mounted after authentication. Identity never comes from the submitted material.
  if (!req.userId) throw new Error('Material audit requires an authenticated user');
  materialAuditActor.run(req.userId, next);
};
