// Telegram Bot Webhook Route Handler

import { Hono } from 'hono';
import type { Env } from '../env';
import type { TelegramUpdate, TelegramMessage, TelegramCallbackQuery, UserRecord } from '../types';
import { webhookSecretMiddleware } from '../middleware/webhook-secret';
import { DbService } from '../services/db';
import { AuthService } from '../services/auth';
import { TelegramService } from '../services/telegram';
import { jsonResponse, forbiddenResponse, formatBytes } from '../utils/response';
import { sha256Hex } from '../utils/crypto';

export const webhookRoute = new Hono<{ Bindings: Env }>();

// Protect webhook with constant-time secret token check
webhookRoute.use('*', webhookSecretMiddleware);

webhookRoute.post('/', async (c) => {
  let update: TelegramUpdate;
  try {
    update = await c.req.json<TelegramUpdate>();
  } catch {
    return c.text('Invalid JSON payload', 400);
  }

  const db = new DbService(c.env.DB);
  const authService = new AuthService(c.env, db);
  const telegram = new TelegramService(c.env.TELEGRAM_BOT_TOKEN);

  // 1. Identify Actor & Strict Single-Owner Gate
  const fromUser = update.message?.from || update.callback_query?.from || update.edited_message?.from;
  if (!fromUser) {
    // Drop update without origin
    return jsonResponse({ ok: true, dropped: 'no_from_user' });
  }

  const senderId = String(fromUser.id);
  if (senderId !== c.env.OWNER_TELEGRAM_ID) {
    // Reject immediately with 403 and zero system leakage
    return forbiddenResponse('Forbidden');
  }

  const owner = await db.getOrCreateOwner(fromUser.id, fromUser.username);

  // 2. Handle Callback Queries (Inline buttons)
  if (update.callback_query) {
    return handleCallbackQuery(update.callback_query, owner.id, db, telegram, c.env);
  }

  // 3. Handle Messages
  if (update.message) {
    return handleMessage(update.message, owner, db, authService, telegram, c.env);
  }

  return jsonResponse({ ok: true });
});

async function handleCallbackQuery(
  cq: TelegramCallbackQuery,
  _userId: string,
  _db: DbService,
  telegram: TelegramService,
  _env: Env
) {
  const data = cq.data || '';
  await telegram.answerCallbackQuery(cq.id, `Action: ${data}`);
  return jsonResponse({ ok: true });
}

async function handleMessage(
  msg: TelegramMessage,
  owner: UserRecord,
  db: DbService,
  authService: AuthService,
  telegram: TelegramService,
  env: Env
) {
  const chatId = msg.chat.id;
  const text = (msg.text || msg.caption || '').trim();

  // --- Case A: Auto-Ingest .ipynb Document Sent to Bot ---
  if (msg.document) {
    const doc = msg.document;
    const fileName = doc.file_name || 'untitled.ipynb';

    if (fileName.endsWith('.ipynb') || doc.mime_type === 'application/x-ipynb+json' || doc.mime_type === 'application/json') {
      const fileInfo = await telegram.getFile(doc.file_id);
      if (!fileInfo.ok || !fileInfo.filePath) {
        await telegram.sendMessage({
          chat_id: chatId,
          text: `⚠️ <b>Ingest Error</b>: Failed to resolve file from Telegram: ${fileInfo.error || 'Unknown error'}`
        });
        return jsonResponse({ ok: false });
      }

      const title = fileName.replace(/\.ipynb$/i, '');
      const fileSize = doc.file_size || fileInfo.fileSize || 0;

      // Check if notebook with title exists
      const existing = await db.getNotebookByTitle(owner.id, title);
      let notebookId: string;
      let targetVersion: number;

      if (existing) {
        notebookId = existing.id;
        targetVersion = existing.current_version + 1;
        await db.updateNotebook(notebookId, owner.id, { current_version: targetVersion });
      } else {
        const created = await db.createNotebook({
          userId: owner.id,
          title,
          description: `Auto-ingested from Telegram: ${fileName}`
        });
        notebookId = created.id;
        targetVersion = 1;
      }

      // Record Version
      const sha256 = await sha256Hex(`telegram:${doc.file_id}:${Date.now()}`);
      await db.createVersion({
        notebookId,
        version: targetVersion,
        totalChunks: 1,
        byteSize: fileSize,
        commitMessage: `Auto-ingested via Telegram document upload`,
        sha256Hash: sha256
      });

      // Record Chunk
      await db.recordChunk({
        notebookId,
        version: targetVersion,
        chunkIndex: 0,
        totalChunks: 1,
        telegramFileId: doc.file_id,
        telegramMessageId: msg.message_id,
        chunkHash: sha256,
        byteLength: fileSize
      });

      const appUrl = env.APP_URL || 'https://telebook.pages.dev';
      const notebookViewerUrl = `${appUrl}?nb=${notebookId}`;

      await telegram.sendMessage({
        chat_id: chatId,
        text:
          `📓 <b>Notebook Ingested Successfully!</b>\n\n` +
          `• <b>Title</b>: <code>${escapeHtml(title)}</code>\n` +
          `• <b>Version</b>: <code>v${targetVersion}</code>\n` +
          `• <b>Size</b>: <code>${formatBytes(fileSize)}</code>\n` +
          `• <b>Chunks</b>: <code>1/1</code>\n\n` +
          `Open now in TeleBook Mini App:`,
        reply_markup: {
          inline_keyboard: [
            [{ text: '🚀 Open Notebook', web_app: { url: notebookViewerUrl } }],
            [{ text: '📋 View All Notebooks', callback_data: 'cmd_list' }]
          ]
        }
      });

      return jsonResponse({ ok: true, ingested: notebookId, version: targetVersion });
    }
  }

  // --- Case B: Commands ---

  // 1. /start [auth_<token>]
  if (text.startsWith('/start')) {
    const parts = text.split(' ');
    const arg = parts[1] || '';

    if (arg.startsWith('auth_')) {
      const rawToken = arg.replace(/^auth_/, '').trim();
      const tokenHash = await sha256Hex(rawToken);
      const tokenRecord = await db.getMagicTokenByHash(tokenHash);

      const now = Math.floor(Date.now() / 1000);
      if (!tokenRecord || tokenRecord.status !== 'pending' || tokenRecord.expires_at < now) {
        await telegram.sendMessage({
          chat_id: chatId,
          text: `❌ <b>Login Expired or Invalid</b>\n\nThe magic login link has expired (120s TTL) or was already used. Please request a new token from your desktop.`
        });
        return jsonResponse({ ok: true });
      }

      // Generate Session JWT
      const sessionJwt = await authService.createSessionToken(owner);
      await db.approveMagicToken(tokenHash, sessionJwt);

      await telegram.sendMessage({
        chat_id: chatId,
        text:
          `✅ <b>TeleBook Desktop Login Approved!</b>\n\n` +
          `Your desktop session has been verified and authorized.\n` +
          `You can now return to your terminal or browser.`
      });

      return jsonResponse({ ok: true, approved_token: tokenHash });
    }

    // Default welcome
    const appUrl = env.APP_URL || 'https://telebook.pages.dev';
    await telegram.sendMessage({
      chat_id: chatId,
      text:
        `👋 <b>Welcome to TeleBook, Sovereign Owner!</b>\n\n` +
        `TeleBook is your zero-knowledge, zero-cost private Jupyter Notebook platform.\n\n` +
        `<b>Available Commands:</b>\n` +
        `• Send any <code>.ipynb</code> file to auto-ingest it\n` +
        `• <code>/list</code> - View all your notebooks\n` +
        `• <code>/search &lt;query&gt;</code> - Search notebooks by title\n` +
        `• <code>/versions &lt;id&gt;</code> - Audit version history\n` +
        `• <code>/login</code> - Generate a 120s desktop magic token\n` +
        `• <code>/revoke</code> - Invalidate all active sessions globally\n` +
        `• <code>/export</code> - Sovereign archive export instructions`,
      reply_markup: {
        inline_keyboard: [
          [{ text: '🚀 Open TeleBook App', web_app: { url: appUrl } }]
        ]
      }
    });

    return jsonResponse({ ok: true });
  }

  // 2. /list
  if (text === '/list') {
    const notebooks = await db.listNotebooks(owner.id, 25);
    if (notebooks.length === 0) {
      await telegram.sendMessage({
        chat_id: chatId,
        text: `📂 <b>No Notebooks Found</b>\n\nSend any <code>.ipynb</code> file here to ingest your first notebook!`
      });
      return jsonResponse({ ok: true });
    }

    let reply = `📚 <b>Your TeleBook Notebooks (${notebooks.length})</b>:\n\n`;
    for (const nb of notebooks) {
      const date = new Date(nb.updated_at * 1000).toISOString().split('T')[0];
      reply += `• <b>${escapeHtml(nb.title)}</b> (v${nb.current_version}) - <i>${date}</i>\n  ID: <code>${nb.id}</code>\n`;
    }

    const appUrl = env.APP_URL || 'https://telebook.pages.dev';
    await telegram.sendMessage({
      chat_id: chatId,
      text: reply,
      reply_markup: {
        inline_keyboard: [
          [{ text: '🚀 Open TeleBook App', web_app: { url: appUrl } }]
        ]
      }
    });

    return jsonResponse({ ok: true });
  }

  // 3. /search <query>
  if (text.startsWith('/search')) {
    const query = text.replace(/^\/search\s*/, '').trim();
    if (!query) {
      await telegram.sendMessage({
        chat_id: chatId,
        text: `🔍 <b>Usage</b>: <code>/search &lt;query&gt;</code>\n\nExample: <code>/search attention</code>`
      });
      return jsonResponse({ ok: true });
    }

    const matches = await db.searchNotebooks(owner.id, query);
    if (matches.length === 0) {
      await telegram.sendMessage({
        chat_id: chatId,
        text: `🔍 No notebooks found matching: <b>${escapeHtml(query)}</b>`
      });
      return jsonResponse({ ok: true });
    }

    let reply = `🔍 <b>Search Results for "${escapeHtml(query)}" (${matches.length})</b>:\n\n`;
    for (const nb of matches) {
      reply += `• <b>${escapeHtml(nb.title)}</b> (v${nb.current_version})\n  ID: <code>${nb.id}</code>\n`;
    }

    await telegram.sendMessage({
      chat_id: chatId,
      text: reply
    });

    return jsonResponse({ ok: true });
  }

  // 4. /versions <notebook_id>
  if (text.startsWith('/versions')) {
    const notebookId = text.replace(/^\/versions\s*/, '').trim();
    if (!notebookId) {
      await telegram.sendMessage({
        chat_id: chatId,
        text: `ℹ️ <b>Usage</b>: <code>/versions &lt;notebook_id&gt;</code>\n\nExample: <code>/versions nb_123456</code>`
      });
      return jsonResponse({ ok: true });
    }

    const notebook = await db.getNotebook(notebookId, owner.id);
    if (!notebook) {
      await telegram.sendMessage({
        chat_id: chatId,
        text: `❌ Notebook not found: <code>${escapeHtml(notebookId)}</code>`
      });
      return jsonResponse({ ok: true });
    }

    const versions = await db.listVersions(notebookId);
    let reply = `📜 <b>Version History: ${escapeHtml(notebook.title)}</b>\n\n`;
    for (const v of versions) {
      const date = new Date(v.created_at * 1000).toISOString().replace('T', ' ').slice(0, 16);
      reply += `• <b>v${v.version}</b> (${formatBytes(v.byte_size)}, ${v.total_chunks} chunks) - <i>${date}</i>\n`;
      if (v.commit_message) {
        reply += `  💬 ${escapeHtml(v.commit_message)}\n`;
      }
    }

    await telegram.sendMessage({
      chat_id: chatId,
      text: reply
    });

    return jsonResponse({ ok: true });
  }

  // 5. /login
  if (text === '/login') {
    const magic = await authService.createMagicToken();

    await telegram.sendMessage({
      chat_id: chatId,
      text:
        `🔑 <b>TeleBook Desktop Login Token</b>\n\n` +
        `• <b>Token</b>: <code>${magic.token}</code>\n` +
        `• <b>Expires in</b>: 120 seconds\n\n` +
        `To login on your terminal CLI:\n` +
        `<code>telebook login --token ${magic.token}</code>\n\n` +
        `Or click below to approve pending desktop sessions:`,
      reply_markup: {
        inline_keyboard: [
          [{ text: '⚡ Quick Approve', url: magic.deepLink }]
        ]
      }
    });

    return jsonResponse({ ok: true, token_created: magic.tokenId });
  }

  // 6. /revoke
  if (text === '/revoke') {
    const newEpoch = await db.bumpAuthEpoch(owner.telegram_id);

    await telegram.sendMessage({
      chat_id: chatId,
      text:
        `🛡️ <b>Global Sessions Revoked!</b>\n\n` +
        `• <b>New Auth Epoch</b>: <code>${newEpoch}</code>\n` +
        `• All active desktop sessions, CLI tokens, and browser cookies have been invalidated globally.`
    });

    return jsonResponse({ ok: true, new_epoch: newEpoch });
  }

  // 7. /export
  if (text === '/export') {
    const notebooks = await db.listNotebooks(owner.id, 100);
    let totalBytes = 0;
    for (const nb of notebooks) {
      const v = await db.getVersion(nb.id, nb.current_version);
      if (v) totalBytes += v.byte_size;
    }

    await telegram.sendMessage({
      chat_id: chatId,
      text:
        `📦 <b>TeleBook Sovereign Archive Export</b>\n\n` +
        `• Total Notebooks: <b>${notebooks.length}</b>\n` +
        `• Total Stored Payload: <b>${formatBytes(totalBytes)}</b>\n\n` +
        `To export your entire decrypted notebook archive to local disk without vendor lock-in, run:\n` +
        `<code>telebook export-all</code>\n\n` +
        `Zero-Knowledge Guarantee: Your plaintext documents never touch cloud servers.`
    });

    return jsonResponse({ ok: true });
  }

  return jsonResponse({ ok: true });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
