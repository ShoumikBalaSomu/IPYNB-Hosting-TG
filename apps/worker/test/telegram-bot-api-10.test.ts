import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TelegramService } from '../src/services/telegram';
import type { InputRichMessage } from '../src/types';

describe('TelegramService: Bot API 10.1 - 10.5 Integrations', () => {
  let service: TelegramService;
  const mockToken = 'mock_bot_token_test_suite_10';

  beforeEach(() => {
    service = new TelegramService(mockToken);
    vi.restoreAllMocks();
  });

  it('sendRichMessage: dispatches valid Bot API 10.3 rich message blocks', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const richMessage: InputRichMessage = {
      version: '10.3',
      stop_generation_supported: true,
      blocks: [
        { type: 'section_heading', text: 'Telemetry Report', level: 1 },
        { type: 'preformatted', language: 'python', text: 'x = 10\nprint(x)' },
        {
          type: 'table',
          is_compact: true,
          rows: [
            { cells: [{ text: 'Metric' }, { text: 'Value' }] },
            { cells: [{ text: 'Loss' }, { text: '0.012' }] },
          ],
        },
        {
          type: 'buttons',
          buttons: [[{ text: 'Stop Generation', callback_data: 'stop_gen' }]],
        },
      ],
    };

    const res = await service.sendRichMessage({
      chat_id: 123456,
      rich_message: richMessage,
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      `https://api.telegram.org/bot${mockToken}/sendRichMessage`,
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: 123456, rich_message: richMessage }),
      })
    );

    expect(res.ok).toBe(true);
  });

  it('sendEphemeralMessage: sends single-user ephemeral message (Bot API 10.2)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ ok: true, result: { ephemeral_message_id: 'eph_msg_987' } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    const res = await service.sendEphemeralMessage({
      chat_id: 123456,
      receiver_user_id: 999888,
      text: 'Temporary Magic Login Token: 120s',
      ephemeral_duration_seconds: 120,
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      `https://api.telegram.org/bot${mockToken}/sendEphemeralMessage`,
      expect.objectContaining({
        method: 'POST',
      })
    );

    expect(res.ok).toBe(true);
    expect(res.ephemeralMessageId).toBe('eph_msg_987');
  });

  it('stopMessageGeneration: signals generation stoppage (Bot API 10.3)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );

    const res = await service.stopMessageGeneration({
      chat_id: 123456,
      draft_id: 'draft_gen_01',
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      `https://api.telegram.org/bot${mockToken}/stopMessageGeneration`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ chat_id: 123456, draft_id: 'draft_gen_01' }),
      })
    );

    expect(res.ok).toBe(true);
  });

  it('setMySettings: configures topic sidebar and inline permissions (Bot API 10.5)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );

    const res = await service.setMySettings({
      has_topic_sidebar: true,
      can_connect_to_business: true,
      supports_inline_queries: true,
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      `https://api.telegram.org/bot${mockToken}/setMySettings`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          has_topic_sidebar: true,
          can_connect_to_business: true,
          supports_inline_queries: true,
        }),
      })
    );

    expect(res.ok).toBe(true);
  });
});
