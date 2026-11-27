import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config.js';
import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { facilityRouter } from './routes/facility.js';
import { slotsRouter } from './routes/slots.js';
import { bookingsRouter } from './routes/bookings.js';
import { filesRouter } from './routes/files.js';
import { adminRouter } from './routes/admin/index.js';
import { configRouter } from './routes/config.js';
import { spacesRouter } from './routes/spaces.js';
import { hostRouter } from './routes/host.js';
import { errorHandler, notFound } from './middleware/errors.js';

export function createApp() {
  const app = express();
  if (config.trustProxy > 0) app.set('trust proxy', config.trustProxy);

  app.use(helmet());
  app.use(cors({ origin: config.corsOrigins }));
  app.use(express.json());
  if (config.env !== 'test') app.use(morgan('dev'));

  // All routes live under /api so CloudFront can forward /api/* to EC2 (Phase 4).
  // API responses must never be cached (CloudFront forwards Authorization via a cache policy).
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use('/api/health', healthRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/config', configRouter);
  app.use('/api/facility', facilityRouter);
  app.use('/api/slots', slotsRouter);
  app.use('/api/bookings', bookingsRouter);
  app.use('/api/files', filesRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/spaces', spacesRouter);
  app.use('/api/host', hostRouter);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
