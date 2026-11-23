// Constant-time X-Telegram-Bot-Api-Secret-Token verification middleware

import type { MiddlewareHandler } from 'hono';
import type { Env } from '../env';
import { timingSafeEqual } from '../utils/crypto';
import { unauthorizedResponse } from '../utils/response';

export const webhookSecretMiddleware: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const secretHeader = c.req.header('X-Telegram-Bot-Api-Secret-Token');
  const configuredSecret = c.env.TELEGRAM_WEBHOOK_SECRET;

  if (!secretHeader || !configuredSecret) {
    return unauthorizedResponse('Missing or invalid webhook secret');
  }

  if (!timingSafeEqual(secretHeader, configuredSecret)) {
    return unauthorizedResponse('Invalid webhook secret token');
  }

  return next();
};
