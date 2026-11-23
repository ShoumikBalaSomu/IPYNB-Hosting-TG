// REST API Notebook & Version Management Routes

import { Hono } from 'hono';
import type { Env } from '../env';
import type { AuthContextVariables } from '../middleware/auth';
import { singleOwnerAuthMiddleware } from '../middleware/auth';
import { jsonResponse, errorResponse, notFoundResponse, forbiddenResponse } from '../utils/response';
import { generateSecureRandomHex } from '../utils/crypto';

export const notebooksRoute = new Hono<{ Bindings: Env; Variables: AuthContextVariables }>();

notebooksRoute.use('*', singleOwnerAuthMiddleware);

/**
 * GET /api/notebooks
 * List all notebooks or search by query parameter.
 */
notebooksRoute.get('/', async (c) => {
  const user = c.get('user');
  const db = c.get('db');

  const query = c.req.query('q');
  const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 100);
  const offset = parseInt(c.req.query('offset') || '0', 10);

  let notebooks;
  if (query && query.trim()) {
    notebooks = await db.searchNotebooks(user.id, query.trim(), limit);
  } else {
    notebooks = await db.listNotebooks(user.id, limit, offset);
  }

  return jsonResponse({
    notebooks: notebooks.map(nb => ({
      id: nb.id,
      title: nb.title,
      description: nb.description,
      current_version: nb.current_version,
      is_starred: Boolean(nb.is_starred),
      tags: JSON.parse(nb.tags || '[]'),
      created_at: nb.created_at,
      updated_at: nb.updated_at
    }))
  });
});

/**
 * POST /api/notebooks
 * Create a new notebook container.
 */
notebooksRoute.post('/', async (c) => {
  if (c.get('isSharingTicket')) {
    return forbiddenResponse('Read-only sharing ticket cannot create notebooks');
  }

  const user = c.get('user');
  const db = c.get('db');

  let body: { id?: string; title?: string; description?: string; tags?: string[] };
  try {
    body = await c.req.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  if (!body.title || !body.title.trim()) {
    return errorResponse('Missing notebook title', 400);
  }

  const created = await db.createNotebook({
    id: body.id,
    userId: user.id,
    title: body.title.trim(),
    description: body.description?.trim(),
    tags: body.tags
  });

  return jsonResponse(
    {
      notebook: {
        id: created.id,
        title: created.title,
        description: created.description,
        current_version: created.current_version,
        is_starred: Boolean(created.is_starred),
        tags: JSON.parse(created.tags || '[]'),
        created_at: created.created_at,
        updated_at: created.updated_at
      }
    },
    201
  );
});

/**
 * GET /api/notebooks/:id
 * Retrieve a specific notebook metadata.
 */
notebooksRoute.get('/:id', async (c) => {
  const user = c.get('user');
  const db = c.get('db');
  const id = c.req.param('id');

  const notebook = await db.getNotebook(id, user.id);
  if (!notebook) {
    return notFoundResponse('Notebook not found');
  }

  return jsonResponse({
    notebook: {
      id: notebook.id,
      title: notebook.title,
      description: notebook.description,
      current_version: notebook.current_version,
      is_starred: Boolean(notebook.is_starred),
      tags: JSON.parse(notebook.tags || '[]'),
      created_at: notebook.created_at,
      updated_at: notebook.updated_at
    }
  });
});

/**
 * PATCH /api/notebooks/:id
 * Update notebook metadata (title, description, is_starred, tags).
 */
notebooksRoute.patch('/:id', async (c) => {
  if (c.get('isSharingTicket')) {
    return forbiddenResponse('Read-only sharing ticket cannot modify notebooks');
  }

  const user = c.get('user');
  const db = c.get('db');
  const id = c.req.param('id');

  let body: { title?: string; description?: string; is_starred?: boolean; tags?: string[] };
  try {
    body = await c.req.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const updated = await db.updateNotebook(id, user.id, body);
  if (!updated) {
    return notFoundResponse('Notebook not found');
  }

  return jsonResponse({
    notebook: {
      id: updated.id,
      title: updated.title,
      description: updated.description,
      current_version: updated.current_version,
      is_starred: Boolean(updated.is_starred),
      tags: JSON.parse(updated.tags || '[]'),
      created_at: updated.created_at,
      updated_at: updated.updated_at
    }
  });
});

/**
 * DELETE /api/notebooks/:id
 * Delete a notebook and its version history.
 */
notebooksRoute.delete('/:id', async (c) => {
  if (c.get('isSharingTicket')) {
    return forbiddenResponse('Read-only sharing ticket cannot delete notebooks');
  }

  const user = c.get('user');
  const db = c.get('db');
  const id = c.req.param('id');

  const deleted = await db.deleteNotebook(id, user.id);
  if (!deleted) {
    return notFoundResponse('Notebook not found');
  }

  return jsonResponse({ deleted: true });
});

/**
 * GET /api/notebooks/:id/versions
 * List all versions for a notebook.
 */
notebooksRoute.get('/:id/versions', async (c) => {
  const user = c.get('user');
  const db = c.get('db');
  const id = c.req.param('id');

  const notebook = await db.getNotebook(id, user.id);
  if (!notebook) {
    return notFoundResponse('Notebook not found');
  }

  const versions = await db.listVersions(id);
  return jsonResponse({
    notebook_id: id,
    versions: versions.map(v => ({
      version: v.version,
      total_chunks: v.total_chunks,
      byte_size: v.byte_size,
      commit_message: v.commit_message,
      sha256_hash: v.sha256_hash,
      created_at: v.created_at
    }))
  });
});

/**
 * GET /api/notebooks/:id/versions/:version
 * Retrieve chunk manifest for a specific notebook version.
 */
notebooksRoute.get('/:id/versions/:version', async (c) => {
  const user = c.get('user');
  const db = c.get('db');
  const id = c.req.param('id');
  const versionNum = parseInt(c.req.param('version'), 10);

  if (isNaN(versionNum)) {
    return errorResponse('Invalid version number', 400);
  }

  const notebook = await db.getNotebook(id, user.id);
  if (!notebook) {
    return notFoundResponse('Notebook not found');
  }

  const version = await db.getVersion(id, versionNum);
  if (!version) {
    return notFoundResponse('Version not found');
  }

  const chunks = await db.getChunksForVersion(id, versionNum);

  return jsonResponse({
    notebook_id: id,
    version: version.version,
    total_chunks: version.total_chunks,
    byte_size: version.byte_size,
    commit_message: version.commit_message,
    sha256_hash: version.sha256_hash,
    created_at: version.created_at,
    chunks: chunks.map(chk => ({
      chunk_index: chk.chunk_index,
      chunk_hash: chk.chunk_hash,
      byte_length: chk.byte_length,
      download_url: `/api/notebooks/${id}/versions/${version.version}/chunks/${chk.chunk_index}`
    }))
  });
});

/**
 * POST /api/notebooks/:id/versions
 * Commit a new notebook version after all chunks are uploaded.
 */
notebooksRoute.post('/:id/versions', async (c) => {
  if (c.get('isSharingTicket')) {
    return forbiddenResponse('Read-only sharing ticket cannot create versions');
  }

  const user = c.get('user');
  const db = c.get('db');
  const id = c.req.param('id');

  const notebook = await db.getNotebook(id, user.id);
  if (!notebook) {
    return notFoundResponse('Notebook not found');
  }

  let body: {
    version: number;
    total_chunks: number;
    byte_size: number;
    commit_message?: string;
    sha256_hash: string;
  };
  try {
    body = await c.req.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  if (!body.version || !body.total_chunks || body.byte_size === undefined || !body.sha256_hash) {
    return errorResponse('Missing required version fields (version, total_chunks, byte_size, sha256_hash)', 400);
  }

  const version = await db.createVersion({
    notebookId: id,
    version: body.version,
    totalChunks: body.total_chunks,
    byteSize: body.byte_size,
    commitMessage: body.commit_message,
    sha256Hash: body.sha256_hash
  });

  return jsonResponse(
    {
      notebook_id: id,
      version: version.version,
      total_chunks: version.total_chunks,
      byte_size: version.byte_size,
      commit_message: version.commit_message,
      sha256_hash: version.sha256_hash,
      created_at: version.created_at
    },
    201
  );
});

/**
 * POST /api/notebooks/:id/share
 * Generate an ephemeral cryptographic sharing ticket for read-only access.
 */
notebooksRoute.post('/:id/share', async (c) => {
  if (c.get('isSharingTicket')) {
    return forbiddenResponse('Cannot re-share from a sharing ticket');
  }

  const user = c.get('user');
  const db = c.get('db');
  const id = c.req.param('id');

  const notebook = await db.getNotebook(id, user.id);
  if (!notebook) {
    return notFoundResponse('Notebook not found');
  }

  let body: { version?: number; expires_in_seconds?: number; max_access_count?: number } = {};
  try {
    body = await c.req.json();
  } catch {
    // empty body is fine
  }

  const targetVersion = body.version || notebook.current_version;
  const rawTicketToken = generateSecureRandomHex(32);

  const ticket = await db.createSharingTicket({
    notebookId: id,
    version: targetVersion,
    rawTicketToken,
    createdBy: user.id,
    expiresInSeconds: body.expires_in_seconds || 86400,
    maxAccessCount: body.max_access_count || 10
  });

  const appUrl = c.env.APP_URL || 'https://telebook.pages.dev';
  const shareUrl = `${appUrl}?nb=${id}&v=${targetVersion}&ticket=${rawTicketToken}`;

  return jsonResponse(
    {
      ticket_token: rawTicketToken,
      share_url: shareUrl,
      expires_at: ticket.expires_at,
      max_access_count: ticket.max_access_count
    },
    201
  );
});
