import 'dotenv/config';
import express from 'express';
import systemRoutes from './routes/systemRoutes.ts';
import businessRoutes from './routes/businessRoutes.ts';
import inboxAndAiRoutes from './routes/inboxAndAiRoutes.ts';
import integrationsAndBillingRoutes from './routes/integrationsAndBillingRoutes.ts';
import adminRoutes from './routes/adminRoutes.ts';
import { loadSupabaseConfig } from './config/supabaseConfig.ts';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);

  // Preserve rawBody for Meta Webhook HMAC-SHA256 signature verification
  app.use(
    express.json({
      limit: '15mb',
      verify: (req, _res, buf) => {
        (req as unknown as { rawBody?: Buffer }).rawBody = buf;
      },
    })
  );
  app.use(express.urlencoded({ extended: true }));

  // Mount API routes
  app.use('/api/system', systemRoutes);
  app.use('/api', businessRoutes);
  app.use('/api', inboxAndAiRoutes);
  app.use('/api', integrationsAndBillingRoutes);
  app.use('/api/admin', adminRoutes);

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, app: 'BeXpar Ai', supabaseConfigured: Boolean(loadSupabaseConfig()) });
  });

  return app;
}
