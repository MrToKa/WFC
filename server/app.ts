import cors from 'cors';
import express, { type Express, type Request, type Response } from 'express';
import { config } from './config.js';
import { adminUsersRouter } from './routes/adminUserRoutes.js';
import { authRouter } from './routes/authRoutes.js';
import { projectsRouter } from './routes/projectsRoutes.js';
import { userRouter } from './routes/userRoutes.js';

export const createApp = (): Express => {
  const app = express();

  app.use(
    cors({
      origin: config.clientOrigin
    })
  );
  app.use(express.json());

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/users', userRouter);
  app.use('/api/admin', adminUsersRouter);
  app.use('/api/projects', projectsRouter);

  return app;
};
