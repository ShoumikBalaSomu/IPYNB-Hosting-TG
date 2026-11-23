// REST API Export Route for Zero-Lock-In Archival

import { Hono } from 'hono';
import type { Env } from '../env';
import type { AuthContextVariables } from '../middleware/auth';
import { singleOwnerAuthMiddleware } from '../middleware/auth';
import { jsonResponse, forbiddenResponse } from '../utils/response';

export const exportRoute = new Hono<{ Bindings: Env; Variables: AuthContextVariables }>();

exportRoute.use('*', singleOwnerAuthMiddleware);

/**
 * GET /api/export
 * Export complete manifest of all notebooks, versions, and chunk download pointers.
 * Powering 'telebook export-all' CLI.
 */
exportRoute.get('/', async (c) => {
  if (c.get('isSharingTicket')) {
    return forbiddenResponse('Sharing tickets cannot execute full archive export');
  }

  const user = c.get('user');
  const db = c.get('db');

  const notebooks = await db.listNotebooks(user.id, 1000, 0);

  const archiveManifest = [];

  for (const nb of notebooks) {
    const versions = await db.listVersions(nb.id);
    const versionsWithChunks = [];

    for (const v of versions) {
      const chunks = await db.getChunksForVersion(nb.id, v.version);
      versionsWithChunks.push({
        version: v.version,
        total_chunks: v.total_chunks,
        byte_size: v.byte_size,
        commit_message: v.commit_message,
        sha256_hash: v.sha256_hash,
        created_at: v.created_at,
        chunks: chunks.map(chk => ({
          chunk_index: chk.chunk_index,
          chunk_hash: chk.chunk_hash,
          byte_length: chk.byte_length,
          telegram_file_id: chk.telegram_file_id,
          download_url: `/api/notebooks/${nb.id}/versions/${v.version}/chunks/${chk.chunk_index}`
        }))
      });
    }

    archiveManifest.push({
      id: nb.id,
      title: nb.title,
      description: nb.description,
      current_version: nb.current_version,
      is_starred: Boolean(nb.is_starred),
      tags: JSON.parse(nb.tags || '[]'),
      created_at: nb.created_at,
      updated_at: nb.updated_at,
      versions: versionsWithChunks
    });
  }

  return jsonResponse({
    exported_at: Math.floor(Date.now() / 1000),
    owner_telegram_id: user.telegram_id,
    notebook_count: archiveManifest.length,
    notebooks: archiveManifest
  });
});
