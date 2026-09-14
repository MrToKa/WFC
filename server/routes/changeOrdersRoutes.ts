import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response, Router as ExpressRouter } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import type { ChangeOrderDocumentType } from '../models/changeOrder.js';
import { authenticate, type AuthenticatedRequest } from '../middleware.js';
import {
  ChangeOrderTemplateError,
  EmptyChangeOrderError,
  generateChangeOrderWorkbook,
  sanitizeChangeOrderFileName,
} from '../services/changeOrderExcelExportService.js';
import { CatalogMaterialNotFoundError } from '../services/changeOrderCatalogService.js';
import {
  applyChangeOrderMaterials,
  ChangeOrderConflictError,
  InvalidChangeOrderMaterialError,
  createChangeOrder,
  deleteChangeOrder,
  getChangeOrder,
  InvalidChangeOrderOrderError,
  listChangeOrders,
  updateChangeOrder,
} from '../services/changeOrderService.js';
import { ensureProjectExists } from '../services/projectService.js';
import {
  changeOrderMaterialsSchema,
  createChangeOrderSchema,
  updateChangeOrderSchema,
} from '../validators.js';

const uuidSchema = z.string().uuid();

const parseIds = (
  req: Request,
  res: Response,
  names: Array<'projectId' | 'changeOrderId' | 'itemId'>,
): boolean => {
  for (const name of names) {
    if (!uuidSchema.safeParse(req.params[name]).success) {
      res.status(400).json({ error: `${name} must be a valid UUID` });
      return false;
    }
  }
  return true;
};

const DOCUMENT_LABELS: Record<ChangeOrderDocumentType, { singular: string; plural: string }> = {
  'change-order': { singular: 'Change Order', plural: 'Change Orders' },
  'internal-ncr': { singular: 'Internal NCR', plural: 'Internal NCRs' },
};

export const createChangeOrdersRouter = (documentType: ChangeOrderDocumentType): ExpressRouter => {
  const router = Router({ mergeParams: true });
  const labels = DOCUMENT_LABELS[documentType];

  router.use(authenticate);
  router.use(async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!parseIds(req, res, ['projectId'])) return;
    try {
      if (!(await ensureProjectExists(req.params.projectId))) {
        res.status(404).json({ error: 'Project not found' });
        return;
      }
      next();
    } catch (error) {
      console.error(`Verify project for ${labels.plural} error`, error);
      res.status(500).json({ error: 'Failed to verify project' });
    }
  });

  router.get('/', async (req: Request, res: Response): Promise<void> => {
    try {
      res.json({
        changeOrders: await listChangeOrders(req.params.projectId, documentType),
      });
    } catch (error) {
      console.error(`List ${labels.plural} error`, error);
      res.status(500).json({ error: `Failed to fetch ${labels.plural}` });
    }
  });

  router.post('/', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
    const parsed = createChangeOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const changeOrder = await createChangeOrder(
        req.params.projectId,
        documentType,
        req.userId as string,
        parsed.data,
      );
      res.status(201).json({ changeOrder });
    } catch (error) {
      console.error(`Create ${labels.singular} error`, error);
      res.status(500).json({ error: `Failed to create ${labels.singular}` });
    }
  });

  router.get('/:changeOrderId', async (req: Request, res: Response): Promise<void> => {
    if (!parseIds(req, res, ['changeOrderId'])) return;
    try {
      const changeOrder = await getChangeOrder(
        req.params.projectId,
        documentType,
        req.params.changeOrderId,
      );
      if (!changeOrder) {
        res.status(404).json({ error: `${labels.singular} not found` });
        return;
      }
      res.json({ changeOrder });
    } catch (error) {
      console.error(`Get ${labels.singular} error`, error);
      res.status(500).json({ error: `Failed to fetch ${labels.singular}` });
    }
  });

  router.patch(
    '/:changeOrderId',
    async (req: AuthenticatedRequest, res: Response): Promise<void> => {
      if (!parseIds(req, res, ['changeOrderId'])) return;
      const parsed = updateChangeOrderSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      try {
        const changeOrder = await updateChangeOrder(
          req.params.projectId,
          documentType,
          req.params.changeOrderId,
          parsed.data,
          req.userId as string,
        );
        if (!changeOrder) {
          res.status(404).json({ error: `${labels.singular} not found` });
          return;
        }
        res.json({ changeOrder });
      } catch (error) {
        console.error(`Update ${labels.singular} error`, error);
        res.status(500).json({ error: `Failed to update ${labels.singular}` });
      }
    },
  );

  for (const preview of [true, false]) {
    router[preview ? 'post' : 'put'](
      preview ? '/:changeOrderId/materials/preview' : '/:changeOrderId/materials',
      async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        if (!parseIds(req, res, ['changeOrderId'])) return;
        const parsed = changeOrderMaterialsSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: parsed.error.flatten() });
          return;
        }
        try {
          const changeOrder = await applyChangeOrderMaterials(
            req.params.projectId,
            documentType,
            req.params.changeOrderId,
            req.userId as string,
            parsed.data,
            preview,
          );
          if (!changeOrder) {
            res.status(404).json({ error: `${labels.singular} not found` });
            return;
          }
          res.json({ changeOrder });
        } catch (error) {
          if (error instanceof ChangeOrderConflictError) {
            res.status(409).json({ error: error.message });
          } else if (
            error instanceof InvalidChangeOrderMaterialError ||
            error instanceof InvalidChangeOrderOrderError
          ) {
            res.status(400).json({ error: error.message });
          } else if (error instanceof CatalogMaterialNotFoundError) {
            res.status(404).json({ error: 'Source material not found' });
          } else {
            console.error(`Save ${labels.singular} materials error`, error);
            res.status(500).json({ error: `Failed to ${preview ? 'preview' : 'save'} materials` });
          }
        }
      },
    );
  }

  router.delete('/:changeOrderId', async (req: Request, res: Response): Promise<void> => {
    if (!parseIds(req, res, ['changeOrderId'])) return;
    try {
      if (
        !(await deleteChangeOrder(req.params.projectId, documentType, req.params.changeOrderId))
      ) {
        res.status(404).json({ error: `${labels.singular} not found` });
        return;
      }
      res.status(204).send();
    } catch (error) {
      console.error(`Delete ${labels.singular} error`, error);
      res.status(500).json({ error: `Failed to delete ${labels.singular}` });
    }
  });

  // Older clients use individual item endpoints. They still go through the same
  // atomic save and author/change-log handling as the materials editor.
  const itemRoutes: Array<{
    method: 'post' | 'patch' | 'delete' | 'put';
    path: string;
    operation: (req: Request) => unknown;
  }> = [
    {
      method: 'post',
      path: '/:changeOrderId/items',
      operation: (req) => ({ ...req.body, type: 'add', id: randomUUID() }),
    },
    {
      method: 'patch',
      path: '/:changeOrderId/items/:itemId',
      operation: (req) => ({ type: 'update', itemId: req.params.itemId, input: req.body }),
    },
    {
      method: 'post',
      path: '/:changeOrderId/items/:itemId/duplicate',
      operation: (req) => ({ type: 'duplicate', itemId: req.params.itemId, id: randomUUID() }),
    },
    {
      method: 'delete',
      path: '/:changeOrderId/items/:itemId',
      operation: (req) => ({ type: 'delete', itemId: req.params.itemId }),
    },
    {
      method: 'put',
      path: '/:changeOrderId/items/order',
      operation: (req) => ({ ...req.body, type: 'reorder' }),
    },
  ];
  for (const route of itemRoutes) {
    router[route.method](
      route.path,
      async (req: AuthenticatedRequest, res: Response): Promise<void> => {
        if (!parseIds(req, res, ['changeOrderId'])) return;
        const parsed = changeOrderMaterialsSchema.shape.operations.element.safeParse(
          route.operation(req),
        );
        if (!parsed.success) {
          res.status(400).json({ error: parsed.error.flatten() });
          return;
        }
        try {
          const before = await getChangeOrder(
            req.params.projectId,
            documentType,
            req.params.changeOrderId,
          );
          if (!before) {
            res.status(404).json({ error: labels.singular + ' not found' });
            return;
          }
          const changeOrder = await applyChangeOrderMaterials(
            req.params.projectId,
            documentType,
            req.params.changeOrderId,
            req.userId as string,
            {
              expectedUpdatedAt: before.updatedAt,
              newRevision: false,
              operations: [parsed.data],
            },
          );
          if (!changeOrder) {
            res.status(404).json({ error: labels.singular + ' not found' });
            return;
          }
          const operation = parsed.data;
          if (operation.type === 'delete') {
            res.status(204).send();
            return;
          }
          if (operation.type === 'reorder') {
            res.json({ items: changeOrder.items });
            return;
          }
          const item =
            operation.type === 'update'
              ? changeOrder.items.find((row) => row.id === operation.itemId)
              : changeOrder.items.find(
                  (row) =>
                    row.lineKind !== 'inherited' && !before.items.some((old) => old.id === row.id),
                );
          res.status(operation.type === 'update' ? 200 : 201).json({ item, changeOrder });
        } catch (error) {
          if (error instanceof ChangeOrderConflictError)
            res.status(409).json({ error: error.message });
          else if (error instanceof CatalogMaterialNotFoundError)
            res.status(404).json({ error: 'Source material not found' });
          else if (
            error instanceof InvalidChangeOrderMaterialError ||
            error instanceof InvalidChangeOrderOrderError
          )
            res.status(400).json({ error: error.message });
          else {
            console.error('Update document material error', error);
            res.status(500).json({ error: 'Failed to update materials' });
          }
        }
      },
    );
  }

  router.get('/:changeOrderId/export', async (req: Request, res: Response): Promise<void> => {
    if (!parseIds(req, res, ['changeOrderId'])) return;
    try {
      const changeOrder = await getChangeOrder(
        req.params.projectId,
        documentType,
        req.params.changeOrderId,
      );
      if (!changeOrder) {
        res.status(404).json({ error: `${labels.singular} not found` });
        return;
      }
      const workbook = await generateChangeOrderWorkbook(changeOrder, undefined, documentType);
      const fileName = sanitizeChangeOrderFileName(changeOrder.title, documentType);
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.send(workbook);
    } catch (error) {
      if (error instanceof EmptyChangeOrderError) {
        res.status(400).json({ error: error.message });
        return;
      }
      if (error instanceof ChangeOrderTemplateError) {
        console.error(`Generate ${labels.singular} workbook template error`, error);
        res
          .status(500)
          .json({ error: `The ${labels.singular} export template is unavailable or invalid` });
        return;
      }
      console.error(`Export ${labels.singular} error`, error);
      res.status(500).json({ error: `Failed to export ${labels.singular}` });
    }
  });

  return router;
};

const changeOrdersRouter = createChangeOrdersRouter('change-order');
const internalNcrsRouter = createChangeOrdersRouter('internal-ncr');

export { changeOrdersRouter, internalNcrsRouter };
