// Chunk streaming proxy to Telegram Bot API with Web Streams and 429 handling

import { Hono } from 'hono';
import type { Env } from '../env';
import type { AuthContextVariables } from '../middleware/auth';
import { singleOwnerAuthMiddleware } from '../middleware/auth';
import { TelegramService } from '../services/telegram';
import { jsonResponse, errorResponse, notFoundResponse, forbiddenResponse } from '../utils/response';

export const chunksRoute = new Hono<{ Bindings: Env; Variables: AuthContextVariables }>();

chunksRoute.use('*', singleOwnerAuthMiddleware);

/**
 * POST /api/notebooks/:id/versions/:version/chunks/:index
 * Stream upload encrypted 15 MB chunk to Telegram Bot API sendDocument.
 */
chunksRoute.post('/:id/versions/:version/chunks/:index', async (c) => {
  if (c.get('isSharingTicket')) {
    return forbiddenResponse('Sharing tickets have read-only permissions');
  }

  const user = c.get('user');
  const db = c.get('db');
  const notebookId = c.req.param('id');
  const versionNum = parseInt(c.req.param('version'), 10);
  const chunkIndex = parseInt(c.req.param('index'), 10);

  if (isNaN(versionNum) || isNaN(chunkIndex)) {
    return errorResponse('Invalid version or chunk index', 400);
  }

  const notebook = await db.getNotebook(notebookId, user.id);
  if (!notebook) {
    return notFoundResponse('Notebook not found');
  }

  // Extract chunk metadata headers
  const chunkHash = c.req.header('X-Chunk-Hash') || c.req.query('hash') || '';
  const totalChunks = parseInt(c.req.header('X-Total-Chunks') || c.req.query('total_chunks') || '1', 10);
  const byteLength = parseInt(c.req.header('X-Byte-Length') || c.req.query('byte_length') || '0', 10);

  if (!chunkHash) {
    return errorResponse('Missing required X-Chunk-Hash header', 400);
  }

  const bodyStream = c.req.raw.body;
  if (!bodyStream) {
    return errorResponse('Missing binary chunk stream body', 400);
  }

  const telegram = new TelegramService(c.env.TELEGRAM_BOT_TOKEN);
  const chunkFilename = `${notebookId}_v${versionNum}_c${chunkIndex}.tb01`;

  // Pipe Web Stream directly to Telegram Bot API without RAM buffering
  const uploadResult = await telegram.uploadDocumentStream({
    chatId: c.env.OWNER_TELEGRAM_ID,
    filename: chunkFilename,
    bodyStream,
    contentType: c.req.header('Content-Type')
  });

  if (!uploadResult.ok) {
    if (uploadResult.retryAfter) {
      return jsonResponse(
        { error: 'Telegram rate limit exceeded. Retry later.', retry_after: uploadResult.retryAfter },
        429,
        { 'Retry-After': String(uploadResult.retryAfter) }
      );
    }
    return errorResponse(uploadResult.error || 'Failed to stream chunk to Telegram', 502);
  }

  // Record chunk manifest in Cloudflare D1
  const chunkRecord = await db.recordChunk({
    notebookId,
    version: versionNum,
    chunkIndex,
    totalChunks,
    telegramFileId: uploadResult.fileId!,
    telegramMessageId: uploadResult.messageId || 0,
    chunkHash,
    byteLength
  });

  return jsonResponse(
    {
      chunk_index: chunkRecord.chunk_index,
      telegram_file_id: chunkRecord.telegram_file_id,
      status: 'stored'
    },
    201
  );
});

/**
 * GET /api/notebooks/:id/versions/:version/chunks/:index
 * Stream download encrypted binary chunk from Telegram Bot API directly to client.
 */
chunksRoute.get('/:id/versions/:version/chunks/:index', async (c) => {
  const user = c.get('user');
  const db = c.get('db');
  const notebookId = c.req.param('id');
  const versionNum = parseInt(c.req.param('version'), 10);
  const chunkIndex = parseInt(c.req.param('index'), 10);

  if (isNaN(versionNum) || isNaN(chunkIndex)) {
    return errorResponse('Invalid version or chunk index', 400);
  }

  // Verify notebook access
  const notebook = await db.getNotebook(notebookId, user.id);
  if (!notebook) {
    return notFoundResponse('Notebook not found');
  }

  const chunk = await db.getChunk(notebookId, versionNum, chunkIndex);
  if (!chunk) {
    return notFoundResponse('Chunk not found in version manifest');
  }

  const telegram = new TelegramService(c.env.TELEGRAM_BOT_TOKEN);
  const fileInfo = await telegram.getFile(chunk.telegram_file_id);

  if (!fileInfo.ok || !fileInfo.filePath) {
    if (fileInfo.retryAfter) {
      return jsonResponse(
        { error: 'Telegram rate limit exceeded. Retry later.', retry_after: fileInfo.retryAfter },
        429,
        { 'Retry-After': String(fileInfo.retryAfter) }
      );
    }
    return errorResponse(fileInfo.error || 'Failed to resolve file path from Telegram', 502);
  }

  // Stream binary file directly from Telegram
  const telegramRes = await telegram.fetchFileStream(fileInfo.filePath);
  if (!telegramRes.ok) {
    return errorResponse(`Failed to stream chunk from Telegram: HTTP ${telegramRes.status}`, 502);
  }

  const responseHeaders = new Headers();
  responseHeaders.set('Content-Type', 'application/octet-stream');
  responseHeaders.set('X-Chunk-Hash', chunk.chunk_hash);
  if (chunk.byte_length > 0) {
    responseHeaders.set('Content-Length', String(chunk.byte_length));
  } else if (telegramRes.headers.get('Content-Length')) {
    responseHeaders.set('Content-Length', telegramRes.headers.get('Content-Length')!);
  }

  return new Response(telegramRes.body, {
    status: 200,
    headers: responseHeaders
  });
});
