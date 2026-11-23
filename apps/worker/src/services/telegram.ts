// Telegram Bot API Service with Web Streams pass-through and 429 handling

export interface InlineKeyboardButton {
  text: string;
  url?: string;
  callback_data?: string;
  web_app?: { url: string };
}

export interface SendMessageOptions {
  chat_id: number | string;
  text: string;
  parse_mode?: 'HTML' | 'MarkdownV2';
  reply_markup?: {
    inline_keyboard?: InlineKeyboardButton[][];
  };
}

export class TelegramService {
  private baseUrl: string;

  constructor(private botToken: string) {
    this.baseUrl = `https://api.telegram.org/bot${botToken}`;
  }

  /**
   * Send text message to user/chat via Telegram Bot API.
   */
  async sendMessage(options: SendMessageOptions): Promise<{ ok: boolean; result?: unknown; error?: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parse_mode: 'HTML',
          ...options
        })
      });

      if (!res.ok) {
        if (res.status === 429) {
          const body = (await res.json().catch(() => ({}))) as { parameters?: { retry_after?: number } };
          const retryAfter = body.parameters?.retry_after || 1;
          return { ok: false, error: `Telegram rate limited (retry after ${retryAfter}s)` };
        }
        const errText = await res.text().catch(() => '');
        return { ok: false, error: `Telegram error ${res.status}: ${errText}` };
      }

      const data = (await res.json()) as { ok: boolean; result: unknown };
      return data;
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Answer callback query from inline buttons.
   */
  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/answerCallbackQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callback_query_id: callbackQueryId,
          text
        })
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Fetch Telegram file information (file_path) by file_id.
   */
  async getFile(fileId: string): Promise<{ ok: boolean; filePath?: string; fileSize?: number; error?: string; retryAfter?: number }> {
    try {
      const res = await fetch(`${this.baseUrl}/getFile?file_id=${encodeURIComponent(fileId)}`);
      if (res.status === 429) {
        const body = (await res.json().catch(() => ({}))) as { parameters?: { retry_after?: number } };
        return { ok: false, error: 'Rate limit exceeded', retryAfter: body.parameters?.retry_after || 1 };
      }

      if (!res.ok) {
        return { ok: false, error: `Telegram getFile failed with HTTP ${res.status}` };
      }

      const data = (await res.json()) as {
        ok: boolean;
        result?: { file_path: string; file_size?: number };
      };

      if (!data.ok || !data.result?.file_path) {
        return { ok: false, error: 'Telegram did not return file_path' };
      }

      return {
        ok: true,
        filePath: data.result.file_path,
        fileSize: data.result.file_size
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Stream a file directly from Telegram file storage to Response.
   */
  async fetchFileStream(filePath: string): Promise<Response> {
    const fileUrl = `https://api.telegram.org/file/bot${this.botToken}/${filePath}`;
    return fetch(fileUrl);
  }

  /**
   * Upload binary document chunk to Telegram Bot API with zero memory buffering.
   * If incoming request is multipart, stream directly.
   * If incoming request is octet-stream, construct multipart stream envelope.
   */
  async uploadDocumentStream(params: {
    chatId: string | number;
    filename: string;
    bodyStream: ReadableStream<Uint8Array>;
    contentType?: string;
  }): Promise<{ ok: boolean; fileId?: string; messageId?: number; error?: string; retryAfter?: number }> {
    const boundary = `----TeleBookFormBoundary${crypto.randomUUID().replace(/-/g, '')}`;
    const enc = new TextEncoder();

    const prefix = enc.encode(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="chat_id"\r\n\r\n` +
      `${params.chatId}\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="document"; filename="${params.filename}"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n`
    );

    const suffix = enc.encode(`\r\n--${boundary}--\r\n`);

    // Stream concatenation: prefix -> bodyStream -> suffix
    let prefixSent = false;
    let bodyReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    let suffixSent = false;

    const combinedStream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (!prefixSent) {
          controller.enqueue(prefix);
          prefixSent = true;
          bodyReader = params.bodyStream.getReader();
          return;
        }

        if (bodyReader) {
          const { done, value } = await bodyReader.read();
          if (!done && value) {
            controller.enqueue(value);
            return;
          }
          bodyReader = null;
        }

        if (!suffixSent) {
          controller.enqueue(suffix);
          suffixSent = true;
          controller.close();
        }
      }
    });

    try {
      const res = await fetch(`${this.baseUrl}/sendDocument`, {
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`
        },
        body: combinedStream
      });

      if (res.status === 429) {
        const body = (await res.json().catch(() => ({}))) as { parameters?: { retry_after?: number } };
        return { ok: false, error: 'Rate limit exceeded', retryAfter: body.parameters?.retry_after || 1 };
      }

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return { ok: false, error: `Telegram sendDocument failed HTTP ${res.status}: ${text}` };
      }

      const data = (await res.json()) as {
        ok: boolean;
        result?: {
          message_id: number;
          document?: { file_id: string };
        };
      };

      if (!data.ok || !data.result?.document?.file_id) {
        return { ok: false, error: 'Telegram did not return document file_id' };
      }

      return {
        ok: true,
        fileId: data.result.document.file_id,
        messageId: data.result.message_id
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
