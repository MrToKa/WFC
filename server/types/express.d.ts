import type { AuthenticatedRequest } from '../middleware.js';

declare global {
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/no-empty-interface
    interface Request extends AuthenticatedRequest {}
  }
}

export {};
