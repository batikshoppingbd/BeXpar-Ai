import type { Server as HttpServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { getSupabaseAdmin } from '../config/supabaseConfig.ts';

interface AuthedSocket extends WebSocket {
  userId?: string;
  businessIds?: Set<string>;
  isAlive?: boolean;
}

let wss: WebSocketServer | null = null;

export function initRealtimeWebSocket(server: HttpServer) {
  if (wss) return wss;

  wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    try {
      const parsed = new URL(req.url || '/', 'http://localhost');
      if (parsed.pathname !== '/ws') return;
      wss!.handleUpgrade(req, socket, head, (ws) => {
        wss!.emit('connection', ws, req);
      });
    } catch {
      socket.destroy();
    }
  });

  wss.on('connection', async (socket: AuthedSocket, req) => {
    socket.isAlive = true;
    socket.businessIds = new Set();

    socket.on('pong', () => {
      socket.isAlive = true;
    });

    try {
      const url = new URL(req.url || '/ws', 'http://localhost');
      const token = url.searchParams.get('token');
      const businessId = url.searchParams.get('businessId');

      if (token) {
        const admin = getSupabaseAdmin();
        const { data } = await admin.auth.getUser(token);
        if (data?.user) {
          socket.userId = data.user.id;
          if (businessId) {
            const { data: biz } = await admin
              .from('businesses')
              .select('id, owner_id')
              .eq('id', businessId)
              .maybeSingle();
            const { data: profile } = await admin
              .from('profiles')
              .select('role')
              .eq('id', data.user.id)
              .maybeSingle();
            const { data: member } = await admin
              .from('business_members')
              .select('id')
              .eq('business_id', businessId)
              .eq('user_id', data.user.id)
              .eq('status', 'active')
              .maybeSingle();

            if (biz?.owner_id === data.user.id || member || profile?.role === 'super_admin') {
              socket.businessIds.add(businessId);
            }
          }
        }
      }
    } catch {
      // Unauthenticated socket stays empty and receives no tenant broadcasts
    }

    socket.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as { type?: string };
        if (msg.type === 'ping') {
          socket.send(JSON.stringify({ type: 'pong' }));
        }
      } catch {
        // Ignore malformed client frames
      }
    });
  });

  const interval = setInterval(() => {
    if (!wss) return;
    for (const client of wss.clients) {
      const sock = client as AuthedSocket;
      if (sock.isAlive === false) {
        sock.terminate();
        continue;
      }
      sock.isAlive = false;
      sock.ping();
    }
  }, 30000);

  wss.on('close', () => clearInterval(interval));
  return wss;
}

export function broadcastToBusiness(businessId: string, event: string, payload: unknown) {
  if (!wss) return;
  const serialized = JSON.stringify({ event, businessId, payload, timestamp: new Date().toISOString() });
  for (const client of wss.clients) {
    const sock = client as AuthedSocket;
    if (sock.readyState === WebSocket.OPEN && sock.businessIds?.has(businessId)) {
      sock.send(serialized);
    }
  }
}
