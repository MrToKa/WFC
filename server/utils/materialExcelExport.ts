import type { RequestHandler, Response, Router } from 'express';
import { z } from 'zod';

const selectionSchema = z.object({ ids: z.array(z.string().uuid()) });

export const registerMaterialExportRoutes = (
  router: Router,
  path: string,
  ...handlers: RequestHandler[]
) => {
  router.get(path, ...handlers);
  const middleware = handlers.slice(0, -1);
  const exportHandler = handlers[handlers.length - 1];
  router.post(
    path,
    ...middleware,
    (req, res, next) => {
      const selection = selectionSchema.safeParse(req.body);
      if (!selection.success) {
        res.status(400).json({ error: 'Invalid material export selection' });
        return;
      }
      res.locals.materialExportIds = new Set(selection.data.ids);
      next();
    },
    exportHandler,
  );
};

export const filterMaterialExportRows = <T extends { id: string }>(
  rows: T[],
  res: Response,
): T[] => {
  const ids = res.locals.materialExportIds as Set<string> | undefined;
  return ids ? rows.filter((row) => ids.has(row.id)) : rows;
};
