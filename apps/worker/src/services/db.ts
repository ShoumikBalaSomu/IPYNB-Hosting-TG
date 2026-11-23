// Cloudflare D1 SQLite database service layer

import type {
  UserRecord,
  NotebookRecord,
  NotebookVersionRecord,
  NotebookChunkRecord,
  MagicTokenRecord,
  SharingTicketRecord
} from '../types';
import { sha256Hex } from '../utils/crypto';

export class DbService {
  constructor(private db: D1Database) {}

  // --- Users & Epoch Management ---

  async getOrCreateOwner(telegramId: number, username?: string): Promise<UserRecord> {
    const existing = await this.db
      .prepare('SELECT * FROM users WHERE telegram_id = ?')
      .bind(telegramId)
      .first<UserRecord>();

    const now = Math.floor(Date.now() / 1000);

    if (existing) {
      if (username && username !== existing.username) {
        await this.db
          .prepare('UPDATE users SET username = ?, updated_at = ? WHERE telegram_id = ?')
          .bind(username, now, telegramId)
          .run();
        return { ...existing, username, updated_at: now };
      }
      return existing;
    }

    const userId = `usr_${crypto.randomUUID().slice(0, 12)}`;
    await this.db
      .prepare(
        'INSERT INTO users (id, telegram_id, username, auth_epoch, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)'
      )
      .bind(userId, telegramId, username || null, now, now)
      .run();

    return {
      id: userId,
      telegram_id: telegramId,
      username: username || null,
      auth_epoch: 1,
      created_at: now,
      updated_at: now
    };
  }

  async getUserByTelegramId(telegramId: number): Promise<UserRecord | null> {
    return this.db
      .prepare('SELECT * FROM users WHERE telegram_id = ?')
      .bind(telegramId)
      .first<UserRecord>();
  }

  async bumpAuthEpoch(telegramId: number): Promise<number> {
    const now = Math.floor(Date.now() / 1000);
    // Ensure user exists first
    const user = await this.getOrCreateOwner(telegramId);
    const newEpoch = user.auth_epoch + 1;

    // Batch update user epoch and wipe existing sessions
    await this.db.batch([
      this.db
        .prepare('UPDATE users SET auth_epoch = ?, updated_at = ? WHERE telegram_id = ?')
        .bind(newEpoch, now, telegramId),
      this.db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id)
    ]);

    return newEpoch;
  }

  // --- Notebook Operations ---

  async listNotebooks(userId: string, limit = 50, offset = 0): Promise<NotebookRecord[]> {
    const { results } = await this.db
      .prepare(
        'SELECT * FROM notebooks WHERE user_id = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?'
      )
      .bind(userId, limit, offset)
      .all<NotebookRecord>();

    return results || [];
  }

  async searchNotebooks(userId: string, query: string, limit = 20): Promise<NotebookRecord[]> {
    const wildcard = `%${query}%`;
    const { results } = await this.db
      .prepare(
        'SELECT * FROM notebooks WHERE user_id = ? AND (title LIKE ? OR description LIKE ?) ORDER BY updated_at DESC LIMIT ?'
      )
      .bind(userId, wildcard, wildcard, limit)
      .all<NotebookRecord>();

    return results || [];
  }

  async getNotebook(id: string, userId: string): Promise<NotebookRecord | null> {
    return this.db
      .prepare('SELECT * FROM notebooks WHERE id = ? AND user_id = ?')
      .bind(id, userId)
      .first<NotebookRecord>();
  }

  async getNotebookByTitle(userId: string, title: string): Promise<NotebookRecord | null> {
    return this.db
      .prepare('SELECT * FROM notebooks WHERE user_id = ? AND title = ?')
      .bind(userId, title)
      .first<NotebookRecord>();
  }

  async createNotebook(params: {
    id?: string;
    userId: string;
    title: string;
    description?: string;
    tags?: string[];
  }): Promise<NotebookRecord> {
    const id = params.id || `nb_${crypto.randomUUID().slice(0, 12)}`;
    const now = Math.floor(Date.now() / 1000);
    const tagsJson = JSON.stringify(params.tags || []);
    const desc = params.description || '';

    await this.db
      .prepare(
        'INSERT INTO notebooks (id, user_id, title, description, current_version, is_starred, tags, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 0, ?, ?, ?)'
      )
      .bind(id, params.userId, params.title, desc, tagsJson, now, now)
      .run();

    return {
      id,
      user_id: params.userId,
      title: params.title,
      description: desc,
      current_version: 1,
      is_starred: 0,
      tags: tagsJson,
      created_at: now,
      updated_at: now
    };
  }

  async updateNotebook(
    id: string,
    userId: string,
    updates: {
      title?: string;
      description?: string;
      is_starred?: boolean;
      tags?: string[];
      current_version?: number;
    }
  ): Promise<NotebookRecord | null> {
    const existing = await this.getNotebook(id, userId);
    if (!existing) return null;

    const now = Math.floor(Date.now() / 1000);
    const title = updates.title !== undefined ? updates.title : existing.title;
    const description = updates.description !== undefined ? updates.description : existing.description;
    const is_starred = updates.is_starred !== undefined ? (updates.is_starred ? 1 : 0) : existing.is_starred;
    const tags = updates.tags !== undefined ? JSON.stringify(updates.tags) : existing.tags;
    const current_version = updates.current_version !== undefined ? updates.current_version : existing.current_version;

    await this.db
      .prepare(
        'UPDATE notebooks SET title = ?, description = ?, is_starred = ?, tags = ?, current_version = ?, updated_at = ? WHERE id = ? AND user_id = ?'
      )
      .bind(title, description, is_starred, tags, current_version, now, id, userId)
      .run();

    return {
      ...existing,
      title,
      description,
      is_starred,
      tags,
      current_version,
      updated_at: now
    };
  }

  async deleteNotebook(id: string, userId: string): Promise<boolean> {
    const res = await this.db
      .prepare('DELETE FROM notebooks WHERE id = ? AND user_id = ?')
      .bind(id, userId)
      .run();
    return (res.meta.changes ?? 0) > 0;
  }

  // --- Versions ---

  async listVersions(notebookId: string): Promise<NotebookVersionRecord[]> {
    const { results } = await this.db
      .prepare('SELECT * FROM notebook_versions WHERE notebook_id = ? ORDER BY version DESC')
      .bind(notebookId)
      .all<NotebookVersionRecord>();
    return results || [];
  }

  async getVersion(notebookId: string, version: number): Promise<NotebookVersionRecord | null> {
    return this.db
      .prepare('SELECT * FROM notebook_versions WHERE notebook_id = ? AND version = ?')
      .bind(notebookId, version)
      .first<NotebookVersionRecord>();
  }

  async createVersion(params: {
    notebookId: string;
    version: number;
    totalChunks: number;
    byteSize: number;
    commitMessage?: string;
    sha256Hash: string;
  }): Promise<NotebookVersionRecord> {
    const id = `ver_${crypto.randomUUID().slice(0, 12)}`;
    const now = Math.floor(Date.now() / 1000);
    const msg = params.commitMessage || '';

    await this.db.batch([
      this.db
        .prepare(
          'INSERT INTO notebook_versions (id, notebook_id, version, total_chunks, byte_size, commit_message, sha256_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .bind(id, params.notebookId, params.version, params.totalChunks, params.byteSize, msg, params.sha256Hash, now),
      this.db
        .prepare('UPDATE notebooks SET current_version = ?, updated_at = ? WHERE id = ?')
        .bind(params.version, now, params.notebookId)
    ]);

    return {
      id,
      notebook_id: params.notebookId,
      version: params.version,
      total_chunks: params.totalChunks,
      byte_size: params.byteSize,
      commit_message: msg,
      sha256_hash: params.sha256Hash,
      created_at: now
    };
  }

  // --- Chunks ---

  async getChunksForVersion(notebookId: string, version: number): Promise<NotebookChunkRecord[]> {
    const { results } = await this.db
      .prepare(
        'SELECT * FROM notebook_chunks WHERE notebook_id = ? AND version = ? ORDER BY chunk_index ASC'
      )
      .bind(notebookId, version)
      .all<NotebookChunkRecord>();
    return results || [];
  }

  async getChunk(notebookId: string, version: number, chunkIndex: number): Promise<NotebookChunkRecord | null> {
    return this.db
      .prepare(
        'SELECT * FROM notebook_chunks WHERE notebook_id = ? AND version = ? AND chunk_index = ?'
      )
      .bind(notebookId, version, chunkIndex)
      .first<NotebookChunkRecord>();
  }

  async recordChunk(params: {
    notebookId: string;
    version: number;
    chunkIndex: number;
    totalChunks: number;
    telegramFileId: string;
    telegramMessageId: number;
    chunkHash: string;
    byteLength: number;
  }): Promise<NotebookChunkRecord> {
    const id = `chk_${crypto.randomUUID().slice(0, 12)}`;
    const now = Math.floor(Date.now() / 1000);

    await this.db
      .prepare(
        'INSERT OR REPLACE INTO notebook_chunks (id, notebook_id, version, chunk_index, total_chunks, telegram_file_id, telegram_message_id, chunk_hash, byte_length, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .bind(
        id,
        params.notebookId,
        params.version,
        params.chunkIndex,
        params.totalChunks,
        params.telegramFileId,
        params.telegramMessageId,
        params.chunkHash,
        params.byteLength,
        now
      )
      .run();

    return {
      id,
      notebook_id: params.notebookId,
      version: params.version,
      chunk_index: params.chunkIndex,
      total_chunks: params.totalChunks,
      telegram_file_id: params.telegramFileId,
      telegram_message_id: params.telegramMessageId,
      chunk_hash: params.chunkHash,
      byte_length: params.byteLength,
      created_at: now
    };
  }

  // --- Magic Tokens (120s TTL) ---

  async createMagicToken(rawToken: string, ttlSeconds = 120): Promise<MagicTokenRecord> {
    const id = `mt_${crypto.randomUUID().slice(0, 10)}`;
    const tokenHash = await sha256Hex(rawToken);
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + ttlSeconds;

    await this.db
      .prepare(
        "INSERT INTO magic_tokens (id, token_hash, status, session_jwt, expires_at, created_at) VALUES (?, ?, 'pending', NULL, ?, ?)"
      )
      .bind(id, tokenHash, expiresAt, now)
      .run();

    return {
      id,
      token_hash: tokenHash,
      status: 'pending',
      session_jwt: null,
      expires_at: expiresAt,
      created_at: now
    };
  }

  async getMagicTokenByHash(tokenHash: string): Promise<MagicTokenRecord | null> {
    return this.db
      .prepare('SELECT * FROM magic_tokens WHERE token_hash = ?')
      .bind(tokenHash)
      .first<MagicTokenRecord>();
  }

  async approveMagicToken(tokenHash: string, sessionJwt: string): Promise<boolean> {
    const res = await this.db
      .prepare(
        "UPDATE magic_tokens SET status = 'approved', session_jwt = ? WHERE token_hash = ? AND status = 'pending'"
      )
      .bind(sessionJwt, tokenHash)
      .run();
    return (res.meta.changes ?? 0) > 0;
  }

  async consumeMagicToken(tokenHash: string): Promise<MagicTokenRecord | null> {
    const token = await this.getMagicTokenByHash(tokenHash);
    if (!token) return null;

    // Single-use deletion
    await this.db
      .prepare('DELETE FROM magic_tokens WHERE token_hash = ?')
      .bind(tokenHash)
      .run();

    return token;
  }

  // --- Sharing Tickets ---

  async createSharingTicket(params: {
    notebookId: string;
    version: number;
    rawTicketToken: string;
    createdBy: string;
    expiresInSeconds?: number;
    maxAccessCount?: number;
  }): Promise<SharingTicketRecord> {
    const id = `tkt_${crypto.randomUUID().slice(0, 12)}`;
    const ticketTokenHash = await sha256Hex(params.rawTicketToken);
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + (params.expiresInSeconds || 86400); // default 24h
    const maxAccess = params.maxAccessCount || 10;

    await this.db
      .prepare(
        'INSERT INTO sharing_tickets (id, notebook_id, version, ticket_token_hash, created_by, expires_at, access_count, max_access_count, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)'
      )
      .bind(id, params.notebookId, params.version, ticketTokenHash, params.createdBy, expiresAt, maxAccess, now)
      .run();

    return {
      id,
      notebook_id: params.notebookId,
      version: params.version,
      ticket_token_hash: ticketTokenHash,
      created_by: params.createdBy,
      expires_at: expiresAt,
      access_count: 0,
      max_access_count: maxAccess,
      created_at: now
    };
  }

  async verifyAndConsumeTicket(rawTicketToken: string, notebookId: string): Promise<{ valid: boolean; ticket?: SharingTicketRecord; error?: string }> {
    const ticketTokenHash = await sha256Hex(rawTicketToken);
    const ticket = await this.db
      .prepare('SELECT * FROM sharing_tickets WHERE ticket_token_hash = ? AND notebook_id = ?')
      .bind(ticketTokenHash, notebookId)
      .first<SharingTicketRecord>();

    if (!ticket) {
      return { valid: false, error: 'Invalid or non-existent ticket' };
    }

    const now = Math.floor(Date.now() / 1000);
    if (ticket.expires_at < now) {
      return { valid: false, error: 'Sharing ticket has expired' };
    }

    if (ticket.access_count >= ticket.max_access_count) {
      return { valid: false, error: 'Sharing ticket access limit exceeded' };
    }

    // Increment access count
    await this.db
      .prepare('UPDATE sharing_tickets SET access_count = access_count + 1 WHERE id = ?')
      .bind(ticket.id)
      .run();

    return { valid: true, ticket: { ...ticket, access_count: ticket.access_count + 1 } };
  }
}
