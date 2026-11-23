// Authentication and single-owner gate middleware

import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Env } from '../env';
import type { UserRecord } from '../types';
import { DbService } from '../services/db';
import { AuthService } from '../services/auth';
import { unauthorizedResponse, forbiddenResponse } from '../utils/response';

export interface AuthContextVariables {
  user: UserRecord;
  db: DbService;
  authService: AuthService;
  isSharingTicket?: boolean;
}

export const singleOwnerAuthMiddleware: MiddlewareHandler<{
  Bindings: Env;
  Variables: AuthContextVariables;
}> = async (c, next) => {
  const db = new DbService(c.env.DB);
  const authService = new AuthService(c.env, db);

  c.set('db', db);
  c.set('authService', authService);

  // 1. Try Bearer Token
  const authHeader = c.req.header('Authorization');
  let bearerToken: string | undefined;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    bearerToken = authHeader.slice(7).trim();
  }

  // 2. Try Session Cookie (HttpOnly, SameSite=Strict)
  const cookieToken = getCookie(c, 'session');
  const token = bearerToken || cookieToken;

  if (token) {
    const verified = await authService.verifySession(token);
    if (!verified.valid || !verified.user) {
      return unauthorizedResponse(verified.error || 'Invalid session');
    }

    if (String(verified.user.telegram_id) !== c.env.OWNER_TELEGRAM_ID) {
      return forbiddenResponse('Access Denied');
    }

    c.set('user', verified.user);
    return next();
  }

  // 3. Try Telegram Mini App initData
  const initDataHeader = c.req.header('X-Telegram-Init-Data');
  if (initDataHeader) {
    const verified = await authService.verifyInitData(initDataHeader, 300);
    if (!verified.valid || !verified.user) {
      return unauthorizedResponse(verified.error || 'Invalid Telegram initData');
    }

    if (String(verified.user.id) !== c.env.OWNER_TELEGRAM_ID) {
      return forbiddenResponse('Access Denied');
    }

    const user = await db.getOrCreateOwner(verified.user.id, verified.user.username);
    c.set('user', user);
    return next();
  }

  // 4. Try Sharing Ticket (read-only single-version access)
  const ticketToken = c.req.header('X-Sharing-Ticket') || c.req.query('ticket');
  const pathMatch = c.req.path.match(/\/notebooks\/([^\/?#]+)/);
  const notebookId = c.req.param('id') || pathMatch?.[1];

  if (ticketToken && notebookId) {
    const verifiedTicket = await db.verifyAndConsumeTicket(ticketToken, notebookId);
    if (verifiedTicket.valid && verifiedTicket.ticket) {
      // Create a virtual read-only user context for sharing ticket
      const owner = await db.getUserByTelegramId(parseInt(c.env.OWNER_TELEGRAM_ID, 10));
      if (owner) {
        c.set('user', owner);
        c.set('isSharingTicket', true);
        return next();
      }
    }
  }

  return unauthorizedResponse('Authentication required');
};
