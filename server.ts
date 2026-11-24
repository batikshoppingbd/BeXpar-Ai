import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { createApp } from './server/app.ts';
import { initRealtimeWebSocket } from './server/services/realtimeBus.ts';
import { getOrGenerateBootstrapCode } from './server/config/supabaseConfig.ts';

async function startServer() {
  const app = createApp();
  const server = http.createServer(app);
  const PORT = Number(process.env.PORT || 3000);

  // Initialize Real-Time WebSocket server on port 3000 (/ws)
  initRealtimeWebSocket(server);

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        allowedHosts: true,
        ws: {
          server,
          path: '/__vite_hmr',
        },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  getOrGenerateBootstrapCode();

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`BeXpar Ai full-stack server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
