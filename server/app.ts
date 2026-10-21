import { materialChangeLogsRouter } from './routes/materialChangeLogsRoutes.js';
import { withMaterialAuditActor } from './services/materialAuditContext.js';
import cors from 'cors';
import express, { type Express, type Request, type Response, type RequestHandler } from 'express';
import { config } from './config.js';
import { adminUsersRouter } from './routes/adminUserRoutes.js';
import { authRouter } from './routes/authRoutes.js';
import { materialCableInstallationMaterialsRouter } from './routes/materialCableInstallationMaterialsRoutes.js';
import { materialCableTypesRouter } from './routes/materialCableTypesRoutes.js';
import {
  materialInstrumentsRouter,
  materialInstrumentInstallationMaterialsRouter,
} from './routes/materialInstrumentsRoutes.js';
import { materialTrayInstallationMaterialsRouter } from './routes/materialTrayInstallationMaterialsRoutes.js';
import { materialsRouter } from './routes/materialsRoutes.js';
import { projectsRouter } from './routes/projectsRoutes.js';
import { templateFilesRouter } from './routes/templateFilesRoutes.js';
import { userRouter } from './routes/userRoutes.js';
import { authenticate, requireAdmin, requireCatalogAccess } from './middleware.js';
import { createViewerSessionRouter } from './routes/viewerSessionRoutes.js';
import { pool } from './db.js';
import { principalTransaction, requestPrincipal } from './pathfinder/auth.js';
import { PathFinderError } from './pathfinder/errors.js';
import { uuid } from './pathfinder/contracts.js';
import { createPurposePolicyRouter } from './pathfinder/purposePolicyRoutes.js';
import { createDrawingPurposePolicyRouter } from './pathfinder/drawingPolicyRoutes.js';
import { createDrawingSnapshotRouter } from './pathfinder/drawingSnapshotRoutes.js';
import { createPreparationRouter } from './pathfinder/preparationRoutes.js';
import { getPathFinderRuntime } from './pathfinder/runtime.js';
import { createGeometryTraceRouter } from './pathfinder/geometryTraceRoutes.js';
import { createBarrierRouter } from './pathfinder/barrierRoutes.js';
import { createEndpointBindingRouter } from './pathfinder/endpointBindingRoutes.js';
import { createCableEndpointRouter } from './pathfinder/cableEndpointRoutes.js';
import { createRevisionComparisonRouter } from './pathfinder/revisionComparisonRoutes.js';
import { createRecalculationRouter } from './pathfinder/recalculationRoutes.js';
import { createCalculationGrantRouter } from './pathfinder/calculationGrantRoutes.js';
import { createProducerResourceRouter } from './pathfinder/producerResourceRoutes.js';
import {createManagedProducerControlRouter} from './pathfinder/managedProducerControl.js';

// Large PF payloads require the current project/admin/login before parsing;
// the write transaction repeats authorization after the upload completes.
const authorizePathFinderBody: RequestHandler = async (req, res, next) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const parsed = uuid.safeParse(/^\/api\/projects\/([^/]+)\/pathfinder\//i.exec(req.originalUrl)?.[1]);
  if (!parsed.success) { res.status(400).json({ code: 'INVALID_PATHFINDER_REQUEST', error: 'Invalid PathFinder project.' }); return; }
  try {
    await principalTransaction(pool, parsed.data, requestPrincipal(req), async () => undefined);
    next();
  } catch (error) {
    const safe = error instanceof PathFinderError ? error : new PathFinderError('PATHFINDER_FAILURE', 500, 'PathFinder authorization failed.');
    res.status(safe.status).json({ code: safe.code, error: safe.message });
  }
};
// raw-body may drain an oversized declared stream before reporting its error.
// Bound authenticated declared captures immediately, even when no body bytes arrive.
const pathFinderBodyLimit = (bytes:number):RequestHandler => (req,res,next) => {
  const declared=req.header('content-length');
  if (declared!==undefined && Number(declared)>bytes) {res.status(413).json({code:'ARTIFACT_LIMIT',error:'The computational snapshot exceeds the upload limit.'});return;}
  next();
};

export const createApp = (): Express => {
  const app = express();
  app.use(createProducerResourceRouter({runtime:getPathFinderRuntime().producerResources}));
  app.use(createManagedProducerControlRouter(getPathFinderRuntime().managedControl));
  app.use((_req,res,next)=>{if(app.get('wfcShuttingDown')===true){res.status(503).json({code:'APPLICATION_STOPPING'});return;}next();});
  app.use('/api/projects/:projectId/model-versions/:modelVersionId/viewer-sessions/:sessionId/barriers', createBarrierRouter(pool, 'viewer'));
  app.use(createViewerSessionRouter());

  app.use(
    cors({
      origin: config.clientOrigin,
      exposedHeaders: ['Content-Disposition'],
    }),
  );
  // Policy endpoints own bounded duplicate-safe parsing and exact authorization
  // errors. Mount before generic JSON and project middleware consumes the body.
  app.use('/api/projects/:projectId/pathfinder', createPurposePolicyRouter(pool));
  app.use('/api/projects/:projectId/pathfinder', createCalculationGrantRouter(pool,getPathFinderRuntime().calculationGrants));
  app.use('/api/projects/:projectId/pathfinder', createDrawingPurposePolicyRouter(pool));
  app.use('/api/projects/:projectId/pathfinder', createGeometryTraceRouter(pool,getPathFinderRuntime().geometryTraces));
  app.use('/api/projects/:projectId/pathfinder', createBarrierRouter(pool));
  app.use('/api/projects/:projectId/pathfinder', createEndpointBindingRouter(pool,getPathFinderRuntime().endpointBindings));
  app.use('/api/projects/:projectId/pathfinder', createCableEndpointRouter(pool));
  app.use('/api/projects/:projectId/pathfinder', createRevisionComparisonRouter(pool,getPathFinderRuntime().revisionComparisons));
  app.use('/api/projects/:projectId/pathfinder', createRecalculationRouter(pool,getPathFinderRuntime().recalculations));
  app.use('/api/projects/:projectId/pathfinder/preparations', createPreparationRouter(pool,getPathFinderRuntime().preparations));
  app.use('/api/projects/:projectId/trays/:trayId', createDrawingSnapshotRouter(pool));
  // Filtered exports send IDs for every matching page, which can exceed the default 100 KB.
  app.use(/^\/api\/materials\/[^/]+\/export$/, express.json({ limit: '10mb' }));
  app.use(
    /^\/api\/projects\/[^/]+\/(change-orders|internal-ncrs)\/[^/]+\/materials(\/preview)?$/,
    express.json({ limit: '5mb' }),
  );
  // Reject unauthenticated/non-admin artifact and lookup captures before buffering a large
  // computational snapshot. The PF router rechecks project/model dependencies.
  app.use(
    /^\/api\/projects\/[0-9a-f-]{36}\/pathfinder\/(artifacts|lookups)\/?$/i,
    authenticate,
    requireAdmin,
    authorizePathFinderBody,
    pathFinderBodyLimit(256*1024*1024),
    express.json({ limit: '256mb' }),
  );
  app.use(
    /^\/api\/projects\/[0-9a-f-]{36}\/pathfinder\/jobs\/?$/i,
    authenticate,
    requireAdmin,
    authorizePathFinderBody,
    express.json({ limit: '1mb' }),
  );
  app.use(express.json());

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/users', userRouter);
  app.use('/api/admin', adminUsersRouter);
  app.use('/api/materials', authenticate, requireCatalogAccess, withMaterialAuditActor);
  app.use('/api/materials/change-logs', materialChangeLogsRouter);
  app.use('/api/templates', authenticate, requireCatalogAccess);
  app.use('/api/materials/cable-installation-materials', materialCableInstallationMaterialsRouter);
  app.use('/api/materials/tray-installation-materials', materialTrayInstallationMaterialsRouter);
  app.use('/api/materials/instruments', materialInstrumentsRouter);
  app.use(
    '/api/materials/instrument-installation-materials',
    materialInstrumentInstallationMaterialsRouter,
  );
  app.use('/api/materials/cable-types', materialCableTypesRouter);
  app.use('/api/materials', materialsRouter);
  app.use('/api/templates', templateFilesRouter);
  app.use('/api/projects', projectsRouter);

  return app;
};
