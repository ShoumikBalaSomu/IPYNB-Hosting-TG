// Global error handler middleware with zero metadata leakage

import type { ErrorHandler } from 'hono';
import type { Env } from '../env';
import { errorResponse } from '../utils/response';

export const errorHandler: ErrorHandler<{ Bindings: Env }> = (err, _c) => {
  // Safe console log in Cloudflare Worker logs
  console.error('[Worker Error]:', err.message || err);

  return errorResponse('Internal server error', 500);
};
