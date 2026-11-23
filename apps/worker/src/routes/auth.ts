// REST API Authentication Routes

import { Hono } from 'hono';
import { setCookie, deleteCookie } from 'hono/cookie';
import type { Env } from '../env';
import type { AuthContextVariables } from '../middleware/auth';
import { singleOwnerAuthMiddleware } from '../middleware/auth';
import { DbService } from '../services/db';
import { AuthService } from '../services/auth';
import { jsonResponse, errorResponse, unauthorizedResponse, notFoundResponse } from '../utils/response';
import { sha256Hex } from '../utils/crypto';

export const authRoute = new Hono<{ Bindings: Env; Variables: AuthContextVariables }>();

/**
 * POST /api/auth/magic-token
 * Create a 120-second ephemeral magic token for desktop or CLI login.
 */
authRoute.post('/magic-token', async (c) => {
  const db = new DbService(c.env.DB);
  const authService = new AuthService(c.env, db);

  const magic = await authService.createMagicToken();

  return jsonResponse(
    {
      token_id: magic.token,
      deep_link: magic.deepLink,
      expires_at: magic.expiresAt
    },
    201
  );
});

/**
 * GET /api/auth/magic-token/:id
 * Poll magic token status from desktop. When approved, issues session JWT and sets cookie.
 */
authRoute.get('/magic-token/:id', async (c) => {
  const db = new DbService(c.env.DB);
  const rawToken = c.req.param('id');
  const tokenHash = await sha256Hex(rawToken);

  const tokenRecord = await db.getMagicTokenByHash(tokenHash);
  if (!tokenRecord) {
    return notFoundResponse('Magic token not found or expired');
  }

  const now = Math.floor(Date.now() / 1000);
  if (tokenRecord.expires_at < now) {
    await db.consumeMagicToken(tokenHash);
    return errorResponse('Magic token has expired', 410);
  }

  if (tokenRecord.status === 'pending') {
    return jsonResponse({ status: 'pending' });
  }

  if (tokenRecord.status === 'approved' && tokenRecord.session_jwt) {
    // Single-use: consume and delete token from D1
    await db.consumeMagicToken(tokenHash);

    const sessionJwt = tokenRecord.session_jwt;

    // Set secure session cookie (HttpOnly, Secure, SameSite=Strict)
    setCookie(c, 'session', sessionJwt, {
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
      path: '/',
      maxAge: 30 * 86400
    });

    return jsonResponse({
      status: 'approved',
      session_token: sessionJwt,
      expires_at: now + 30 * 86400
    });
  }

  return errorResponse('Invalid magic token state', 400);
});

/**
 * POST /api/auth/init-data
 * Authenticate via Telegram Mini App initData query string.
 */
authRoute.post('/init-data', async (c) => {
  let body: { initData?: string };
  try {
    body = await c.req.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  if (!body.initData) {
    return errorResponse('Missing initData', 400);
  }

  const db = new DbService(c.env.DB);
  const authService = new AuthService(c.env, db);

  const verified = await authService.verifyInitData(body.initData, 300);
  if (!verified.valid || !verified.user) {
    return unauthorizedResponse(verified.error || 'Invalid Telegram credentials');
  }

  const user = await db.getOrCreateOwner(verified.user.id, verified.user.username);
  const sessionToken = await authService.createSessionToken(user);

  setCookie(c, 'session', sessionToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    path: '/',
    maxAge: 30 * 86400
  });

  return jsonResponse({
    ok: true,
    session_token: sessionToken,
    user: {
      id: user.id,
      telegram_id: user.telegram_id,
      username: user.username,
      auth_epoch: user.auth_epoch
    }
  });
});

/**
 * POST /api/auth/revoke
 * Atomically invalidate all active desktop and browser sessions globally.
 */
authRoute.post('/revoke', singleOwnerAuthMiddleware, async (c) => {
  const user = c.get('user');
  const db = c.get('db');

  const newEpoch = await db.bumpAuthEpoch(user.telegram_id);

  // Clear session cookie
  deleteCookie(c, 'session', {
    path: '/',
    secure: true,
    sameSite: 'Strict'
  });

  return jsonResponse({
    revoked: true,
    new_epoch: newEpoch
  });
});

/**
 * GET /api/auth/me
 * Retrieve currently authenticated user context.
 */
authRoute.get('/me', singleOwnerAuthMiddleware, async (c) => {
  const user = c.get('user');
  return jsonResponse({
    authenticated: true,
    user: {
      id: user.id,
      telegram_id: user.telegram_id,
      username: user.username,
      auth_epoch: user.auth_epoch
    }
  });
});
