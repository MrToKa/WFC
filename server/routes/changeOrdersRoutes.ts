import type { NextFunction, Request, Response, Router as ExpressRouter } from 'express';
import { Router } from 'express';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { pool } from '../db.js';
import type {
  ChangeOrderDetails,
  ChangeOrderDocumentType,
  ChangeOrderSourceCatalog,
} from '../models/changeOrder.js';
import { authenticate } from '../middleware.js';
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
import {
  getMutationRevision,
  MutationError,
  readMutationHeaders,
  respondToMutationError,
  withVersionedMutation,
} from '../services/mutationService.js';
import { ensureProjectExists } from '../services/projectService.js';
import {
  addChangeOrderItemSchema,
  createChangeOrderSchema,
  reorderChangeOrderItemsSchema,
  updateChangeOrderItemSchema,
  updateChangeOrderSchema,
} from '../validators.js';

const uuidSchema = z.string().uuid();
const parseIds = (req: Request, res: Response, names: string[]): boolean => {
  for (const name of names) {
    if (!uuidSchema.safeParse(req.params[name]).success) {
      res.status(400).json({ error: `${name} must be a valid UUID` });
      return false;
    }
  }
  return true;
};

const DOCUMENT_LABELS = {
  'change-order': { singular: 'Change Order', plural: 'Change Orders' },
  'internal-ncr': { singular: 'Internal NCR', plural: 'Internal NCRs' },
} as const;

export const createChangeOrdersRouter = (documentType: ChangeOrderDocumentType): ExpressRouter => {
  const router = Router({ mergeParams: true });
  const labels = DOCUMENT_LABELS[documentType];
  const notFound = (item = false): never => {
    throw new MutationError(
      404,
      'DOCUMENT_NOT_FOUND',
      `${labels.singular}${item ? ' item' : ''} not found`,
    );
  };
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
      console.error('Verify document project error', error);
      res.status(500).json({ error: 'Failed to verify project' });
    }
  });

  router.get('/', async (req: Request, res: Response): Promise<void> => {
    try {
      res.json({
        changeOrders: await listChangeOrders(req.params.projectId, documentType),
        mutationRevision: await getMutationRevision(
          pool,
          'change-order-collection',
          req.params.projectId,
        ),
      });
    } catch (error) {
      console.error('List documents error', error);
      res.status(500).json({ error: `Failed to fetch ${labels.plural}` });
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
      if (!changeOrder) notFound();
      res.json({ changeOrder });
    } catch (error) {
      if (respondToMutationError(error, res)) return;
      console.error('Read document error', error);
      res.status(500).json({ error: `Failed to fetch ${labels.singular}` });
    }
  });

  // Every document mutation uses the same resource lock, revision, receipt and
  // complete snapshot transaction. Business revision text remains independent.
  const registerMutation = <Input>(
    method: 'post' | 'patch' | 'delete' | 'put',
    route: string,
    schema: z.ZodType<Input>,
    operation: string,
    mutate: (req: Request, client: PoolClient, input: Input) => Promise<Record<string, unknown>>,
    status = 200,
  ): void => {
    router[method](route, async (req: Request, res: Response): Promise<void> => {
      const ids = ['changeOrderId', 'itemId'].filter((name) => req.params[name] !== undefined);
      if (!parseIds(req, res, ids)) return;
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.flatten() });
        return;
      }
      try {
        const headers = readMutationHeaders(req);
        const create = operation === 'create';
        const result = await withVersionedMutation(
          {
            ...headers,
            actorId: req.userId as string,
            resourceType: create ? 'change-order-collection' : 'change-order',
            resourceId: create ? req.params.projectId : req.params.changeOrderId,
            request: {
              operation,
              documentType,
              projectId: req.params.projectId,
              itemId: req.params.itemId,
              input: parsed.data,
            },
          },
          async (client) => {
            const previous = !create
              ? await getChangeOrder(
                  req.params.projectId,
                  documentType,
                  req.params.changeOrderId,
                  client,
                )
              : null;
            if (!create && !previous) notFound();
            const body = await mutate(req, client, parsed.data);
            const changeOrderId = create
              ? (body.changeOrder as ChangeOrderDetails).id
              : req.params.changeOrderId;
            const changeOrder =
              operation === 'delete'
                ? null
                : await getChangeOrder(req.params.projectId, documentType, changeOrderId, client);
            if (operation !== 'delete' && !changeOrder) notFound();
            if (changeOrder)
              changeOrder.mutationRevision = create ? 0 : headers.expectedRevision + 1;
            return {
              body: {
                ...body,
                ...(body.changeOrder ? { changeOrder } : {}),
                mutationRevision: create
                  ? headers.expectedRevision + 1
                  : (changeOrder?.mutationRevision ?? headers.expectedRevision + 1),
              },
              snapshot: changeOrder ?? { deleted: true, previous },
            };
          },
          async (_client, value) => value.snapshot,
          create ? undefined : (client) => getChangeOrder(
            req.params.projectId, documentType, req.params.changeOrderId, client,
          ),
        );
        if (status === 204) res.status(204).send();
        else res.status(status).json(result.value.body);
      } catch (error) {
        if (respondToMutationError(error, res)) return;
        if (error instanceof CatalogMaterialNotFoundError) {
          res.status(404).json({ error: 'Source material not found' });
          return;
        }
        if (error instanceof InvalidChangeOrderOrderError) {
          res.status(400).json({ error: error.message });
          return;
        }
        console.error(`Document ${operation} error`, error);
        res.status(500).json({ error: `Failed to ${operation} ${labels.singular}` });
      }
    });
  };

  registerMutation(
    'post',
    '/',
    createChangeOrderSchema,
    'create',
    async (req, client, input) => ({
      changeOrder: await createChangeOrder(
        req.params.projectId,
        documentType,
        req.userId as string,
        input,
        client,
      ),
    }),
    201,
  );

  registerMutation(
    'patch',
    '/:changeOrderId',
    updateChangeOrderSchema,
    'update',
    async (req, client, input) => {
      const changeOrder = await updateChangeOrder(
        req.params.projectId,
        documentType,
        req.params.changeOrderId,
        input,
        client,
      );
      if (!changeOrder) notFound();
      return { changeOrder };
    },
  );

  const emptyBody = z.unknown().transform(() => undefined);
  registerMutation(
    'delete',
    '/:changeOrderId',
    emptyBody,
    'delete',
    async (req, client) => {
      if (
        !(await deleteChangeOrder(
          req.params.projectId,
          documentType,
          req.params.changeOrderId,
          client,
        ))
      )
        notFound();
      return {};
    },
    204,
  );

  registerMutation(
    'post',
    '/:changeOrderId/items',
    addChangeOrderItemSchema,
    'add-item',
    async (req, client, input) => {
      const item = await addChangeOrderItem(
        req.params.projectId,
        documentType,
        req.params.changeOrderId,
        input.sourceCatalog as ChangeOrderSourceCatalog,
        input.sourceMaterialId,
        client,
      );
      if (!item) notFound();
      return { item, changeOrder: {} };
    },
    201,
  );

  registerMutation(
    'patch',
    '/:changeOrderId/items/:itemId',
    updateChangeOrderItemSchema,
    'update-item',
    async (req, client, input) => {
      const item = await updateChangeOrderItem(
        req.params.projectId,
        documentType,
        req.params.changeOrderId,
        req.params.itemId,
        input,
        client,
      );
      if (!item) notFound(true);
      return { item };
    },
  );

  registerMutation(
    'post',
    '/:changeOrderId/items/:itemId/duplicate',
    emptyBody,
    'duplicate-item',
    async (req, client) => {
      const item = await duplicateChangeOrderItem(
        req.params.projectId,
        documentType,
        req.params.changeOrderId,
        req.params.itemId,
        client,
      );
      if (!item) notFound(true);
      return { item, changeOrder: {} };
    },
    201,
  );

  registerMutation(
    'delete',
    '/:changeOrderId/items/:itemId',
    emptyBody,
    'delete-item',
    async (req, client) => {
      if (
        !(await deleteChangeOrderItem(
          req.params.projectId,
          documentType,
          req.params.changeOrderId,
          req.params.itemId,
          client,
        ))
      )
        notFound(true);
      return {};
    },
    204,
  );

  registerMutation(
    'put',
    '/:changeOrderId/items/order',
    reorderChangeOrderItemsSchema,
    'reorder-items',
    async (req, client, input) => {
      const items = await reorderChangeOrderItems(
        req.params.projectId,
        documentType,
        req.params.changeOrderId,
        input.orderedItemIds,
        client,
      );
      if (!items) notFound();
      return { items };
    },
  );

  router.get('/:changeOrderId/export', async (req: Request, res: Response): Promise<void> => {
    if (!parseIds(req, res, ['changeOrderId'])) return;
    try {
      const changeOrder = await getChangeOrder(
        req.params.projectId,
        documentType,
        req.params.changeOrderId,
      );
      if (!changeOrder) notFound();
      const workbook = await generateChangeOrderWorkbook(changeOrder!, undefined, documentType);
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${sanitizeChangeOrderFileName(changeOrder!.title, documentType)}"`,
      );
      res.send(workbook);
    } catch (error) {
      if (respondToMutationError(error, res)) return;
      if (error instanceof EmptyChangeOrderError) {
        res.status(400).json({ error: error.message });
        return;
      }
      if (error instanceof ChangeOrderTemplateError) {
        res
          .status(500)
          .json({ error: `The ${labels.singular} export template is unavailable or invalid` });
        return;
      }
      console.error('Export document error', error);
      res.status(500).json({ error: `Failed to export ${labels.singular}` });
    }
  });
  return router;
};

export const changeOrdersRouter = createChangeOrdersRouter('change-order');
export const internalNcrsRouter = createChangeOrdersRouter('internal-ncr');
