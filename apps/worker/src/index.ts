// TeleBook Cloudflare Worker Main Entrypoint

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './env';
import { errorHandler } from './middleware/error';
import { webhookRoute } from './routes/webhook';
import { authRoute } from './routes/auth';
import { notebooksRoute } from './routes/notebooks';
import { chunksRoute } from './routes/chunks';
import { exportRoute } from './routes/export';
import { jsonResponse } from './utils/response';

export const app = new Hono<{ Bindings: Env }>();

// Global Error Handler
app.onError(errorHandler);

// Security Headers Middleware
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  c.header(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data: https:; connect-src 'self' https://api.telegram.org; frame-ancestors 'self' https://web.telegram.org https://*.telegram.org;"
  );
});

// CORS configuration for web app and local CLI clients
app.use(
  '*',
  cors({
    origin: (origin) => origin || '*',
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: [
      'Content-Type',
      'Authorization',
      'X-Telegram-Init-Data',
      'X-Telegram-Bot-Api-Secret-Token',
      'X-Chunk-Hash',
      'X-Total-Chunks',
      'X-Byte-Length',
      'X-Sharing-Ticket'
    ],
    exposeHeaders: ['Content-Length', 'X-Chunk-Hash', 'Retry-After'],
    credentials: true,
    maxAge: 86400
  })
);

// Health check endpoint
app.get('/health', (_c) => {
  return jsonResponse({
    status: 'ok',
    service: 'telebook-worker',
    timestamp: Math.floor(Date.now() / 1000)
  });
});

// Mount Routes
app.route('/api/webhook', webhookRoute);
app.route('/api/auth', authRoute);
app.route('/api/notebooks', notebooksRoute);
app.route('/api/notebooks', chunksRoute);
app.route('/api/export', exportRoute);

// 404 Fallback
app.notFound((c) => {
  return c.json({ error: 'Endpoint not found' }, 404);
});

export default app;
