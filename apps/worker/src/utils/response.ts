// Standard response envelopes and HTTP formatting helpers

export function jsonResponse(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    }
  });
}

export function errorResponse(message: string, status = 400, headers: Record<string, string> = {}): Response {
  return jsonResponse({ error: message }, status, headers);
}

export function unauthorizedResponse(message = 'Unauthorized'): Response {
  return errorResponse(message, 401);
}

export function forbiddenResponse(message = 'Forbidden'): Response {
  return errorResponse(message, 403);
}

export function notFoundResponse(message = 'Resource not found'): Response {
  return errorResponse(message, 404);
}

/**
 * Format bytes to human readable format (e.g. 1.5 MB)
 */
export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}
