import type { NextFunction, Request, Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import type { ChangeOrderSourceCatalog } from '../models/changeOrder.js';
import { authenticate, type AuthenticatedRequest } from '../middleware.js';
import {
  ChangeOrderTemplateError,
  EmptyChangeOrderError,
  generateChangeOrderWorkbook,
  sanitizeChangeOrderFileName,
} from '../services/changeOrderExcelExportService.js';
import { CatalogMaterialNotFoundError } from '../services/changeOrderCatalogService.js';
import {
  addChangeOrderItem,
  createChangeOrder,
  deleteChangeOrder,
  deleteChangeOrderItem,
  duplicateChangeOrderItem,
  getChangeOrder,
  InvalidChangeOrderOrderError,
  listChangeOrders,
  reorderChangeOrderItems,
  updateChangeOrder,
  updateChangeOrderItem,
} from '../services/changeOrderService.js';
import { ensureProjectExists } from '../services/projectService.js';
import {
  addChangeOrderItemSchema,
  createChangeOrderSchema,
  reorderChangeOrderItemsSchema,
  updateChangeOrderItemSchema,
  updateChangeOrderSchema,
} from '../validators.js';

const changeOrdersRouter = Router({ mergeParams: true });
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

changeOrdersRouter.use(authenticate);
changeOrdersRouter.use(async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  if (!parseIds(req, res, ['projectId'])) return;
  try {
    if (!(await ensureProjectExists(req.params.projectId))) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    next();
  } catch (error) {
    console.error('Verify project for Change Orders error', error);
    res.status(500).json({ error: 'Failed to verify project' });
  }
});

changeOrdersRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    res.json({ changeOrders: await listChangeOrders(req.params.projectId) });
  } catch (error) {
    console.error('List Change Orders error', error);
    res.status(500).json({ error: 'Failed to fetch Change Orders' });
  }
});

changeOrdersRouter.post('/', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const parsed = createChangeOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const changeOrder = await createChangeOrder(
      req.params.projectId,
      req.userId as string,
      parsed.data,
    );
    res.status(201).json({ changeOrder });
  } catch (error) {
    console.error('Create Change Order error', error);
    res.status(500).json({ error: 'Failed to create Change Order' });
  }
});

changeOrdersRouter.get('/:changeOrderId', async (req: Request, res: Response): Promise<void> => {
  if (!parseIds(req, res, ['changeOrderId'])) return;
  try {
    const changeOrder = await getChangeOrder(req.params.projectId, req.params.changeOrderId);
    if (!changeOrder) {
      res.status(404).json({ error: 'Change Order not found' });
      return;
    }
    res.json({ changeOrder });
  } catch (error) {
    console.error('Get Change Order error', error);
    res.status(500).json({ error: 'Failed to fetch Change Order' });
  }
});

changeOrdersRouter.patch('/:changeOrderId', async (req: Request, res: Response): Promise<void> => {
  if (!parseIds(req, res, ['changeOrderId'])) return;
  const parsed = updateChangeOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const changeOrder = await updateChangeOrder(
      req.params.projectId,
      req.params.changeOrderId,
      parsed.data,
    );
    if (!changeOrder) {
      res.status(404).json({ error: 'Change Order not found' });
      return;
    }
    res.json({ changeOrder });
  } catch (error) {
    console.error('Update Change Order error', error);
    res.status(500).json({ error: 'Failed to update Change Order' });
  }
});

changeOrdersRouter.delete('/:changeOrderId', async (req: Request, res: Response): Promise<void> => {
  if (!parseIds(req, res, ['changeOrderId'])) return;
  try {
    if (!(await deleteChangeOrder(req.params.projectId, req.params.changeOrderId))) {
      res.status(404).json({ error: 'Change Order not found' });
      return;
    }
    res.status(204).send();
  } catch (error) {
    console.error('Delete Change Order error', error);
    res.status(500).json({ error: 'Failed to delete Change Order' });
  }
});

changeOrdersRouter.post(
  '/:changeOrderId/items',
  async (req: Request, res: Response): Promise<void> => {
    if (!parseIds(req, res, ['changeOrderId'])) return;
    const parsed = addChangeOrderItemSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const item = await addChangeOrderItem(
        req.params.projectId,
        req.params.changeOrderId,
        parsed.data.sourceCatalog as ChangeOrderSourceCatalog,
        parsed.data.sourceMaterialId,
      );
      if (!item) {
        res.status(404).json({ error: 'Change Order not found' });
        return;
      }
      const changeOrder = await getChangeOrder(req.params.projectId, req.params.changeOrderId);
      if (!changeOrder) {
        res.status(404).json({ error: 'Change Order not found' });
        return;
      }
      res.status(201).json({ item, changeOrder });
    } catch (error) {
      if (error instanceof CatalogMaterialNotFoundError) {
        res.status(404).json({ error: 'Source material not found' });
        return;
      }
      console.error('Add Change Order item error', error);
      res.status(500).json({ error: 'Failed to add material to Change Order' });
    }
  },
);

changeOrdersRouter.patch(
  '/:changeOrderId/items/:itemId',
  async (req: Request, res: Response): Promise<void> => {
    if (!parseIds(req, res, ['changeOrderId', 'itemId'])) return;
    const parsed = updateChangeOrderItemSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const item = await updateChangeOrderItem(
        req.params.projectId,
        req.params.changeOrderId,
        req.params.itemId,
        parsed.data,
      );
      if (!item) {
        res.status(404).json({ error: 'Change Order item not found' });
        return;
      }
      res.json({ item });
    } catch (error) {
      console.error('Update Change Order item error', error);
      res.status(500).json({ error: 'Failed to update Change Order item' });
    }
  },
);

changeOrdersRouter.post(
  '/:changeOrderId/items/:itemId/duplicate',
  async (req: Request, res: Response): Promise<void> => {
    if (!parseIds(req, res, ['changeOrderId', 'itemId'])) return;
    try {
      const item = await duplicateChangeOrderItem(
        req.params.projectId,
        req.params.changeOrderId,
        req.params.itemId,
      );
      if (!item) {
        res.status(404).json({ error: 'Change Order item not found' });
        return;
      }
      const changeOrder = await getChangeOrder(req.params.projectId, req.params.changeOrderId);
      if (!changeOrder) {
        res.status(404).json({ error: 'Change Order not found' });
        return;
      }
      res.status(201).json({ item, changeOrder });
    } catch (error) {
      console.error('Duplicate Change Order item error', error);
      res.status(500).json({ error: 'Failed to duplicate Change Order item' });
    }
  },
);

changeOrdersRouter.delete(
  '/:changeOrderId/items/:itemId',
  async (req: Request, res: Response): Promise<void> => {
    if (!parseIds(req, res, ['changeOrderId', 'itemId'])) return;
    try {
      const deleted = await deleteChangeOrderItem(
        req.params.projectId,
        req.params.changeOrderId,
        req.params.itemId,
      );
      if (!deleted) {
        res.status(404).json({ error: 'Change Order item not found' });
        return;
      }
      res.status(204).send();
    } catch (error) {
      console.error('Delete Change Order item error', error);
      res.status(500).json({ error: 'Failed to delete Change Order item' });
    }
  },
);

changeOrdersRouter.put(
  '/:changeOrderId/items/order',
  async (req: Request, res: Response): Promise<void> => {
    if (!parseIds(req, res, ['changeOrderId'])) return;
    const parsed = reorderChangeOrderItemsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const items = await reorderChangeOrderItems(
        req.params.projectId,
        req.params.changeOrderId,
        parsed.data.orderedItemIds,
      );
      if (!items) {
        res.status(404).json({ error: 'Change Order not found' });
        return;
      }
      res.json({ items });
    } catch (error) {
      if (error instanceof InvalidChangeOrderOrderError) {
        res.status(400).json({ error: error.message });
        return;
      }
      console.error('Reorder Change Order items error', error);
      res.status(500).json({ error: 'Failed to reorder Change Order items' });
    }
  },
);

changeOrdersRouter.get(
  '/:changeOrderId/export',
  async (req: Request, res: Response): Promise<void> => {
    if (!parseIds(req, res, ['changeOrderId'])) return;
    try {
      const changeOrder = await getChangeOrder(req.params.projectId, req.params.changeOrderId);
      if (!changeOrder) {
        res.status(404).json({ error: 'Change Order not found' });
        return;
      }
      const workbook = await generateChangeOrderWorkbook(changeOrder);
      const fileName = sanitizeChangeOrderFileName(changeOrder.title);
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
        console.error('Generate Change Order workbook template error', error);
        res
          .status(500)
          .json({ error: 'The Change Order export template is unavailable or invalid' });
        return;
      }
      console.error('Export Change Order error', error);
      res.status(500).json({ error: 'Failed to export Change Order' });
    }
  },
);

export { changeOrdersRouter };
