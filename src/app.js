import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { authenticate } from './auth.js';
import { publicRoutes } from './routes/public.js';
import { meRoutes } from './routes/me.js';
import { adminRoutes } from './routes/admin.js';

export function createApp(db) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

  const origins = (process.env.CLIENT_ORIGIN || '*').split(',').map((s) => s.trim()).filter(Boolean);
  app.use(cors({
    origin: origins.includes('*') ? true : origins,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Demo-Now'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  }));
  app.use(express.json({ limit: '100kb' }));
  app.use(authenticate(db));

  app.get('/', (_req, res) => res.json({ name: 'HallFinder API', status: 'ok', docs: '/api/health' }));
  app.use('/api', publicRoutes(db));
  app.use('/api', meRoutes(db));
  app.use('/api/admin', adminRoutes(db));

  app.use((_req, res) => res.status(404).json({ error: 'not_found', message: 'Route not found.' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: 'server_error', message: 'Something went wrong on our side.' });
  });
  return app;
}
