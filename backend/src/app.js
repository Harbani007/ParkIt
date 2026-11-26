import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config.js';
import { healthRouter } from './routes/health.js';
import { errorHandler, notFound } from './middleware/errors.js';

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: config.corsOrigins }));
  app.use(express.json());
  if (config.env !== 'test') app.use(morgan('dev'));

  // All routes live under /api so CloudFront can forward /api/* to EC2 (Phase 4).
  app.use('/api/health', healthRouter);
  // Phase 2 mounts: /api/auth, /api/slots, /api/bookings, /api/admin

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
