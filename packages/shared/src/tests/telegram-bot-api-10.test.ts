import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  InputRichMessageSchema,
  RichBlockTableSchema,
  EphemeralMessageOptionsSchema,
  BotFullInfoSchema,
  BotSettingsSchema,
} from '../models/telegram.js';

describe('Telegram Bot API 10.1 - 10.3 Rich Messages & Ephemeral Spec', () => {
  it('validates a complete Bot API 10.3 InputRichMessage containing tables, code, and buttons', () => {
    const richMessagePayload = {
      version: '10.3',
      stop_generation_supported: true,
      blocks: [
        {
          type: 'section_heading',
          text: '📓 Notebook Execution Results: linear_regression.ipynb',
          level: 1,
        },
        {
          type: 'thinking',
          status_text: 'Pyodide WebAssembly runtime initialized in 210ms',
          is_active: false,
        },
        {
          type: 'preformatted',
          language: 'python',
          text: 'import pandas as pd\ndf = pd.DataFrame({"loss": [0.45, 0.23, 0.11]})\nprint(df)',
        },
        {
          type: 'table',
          is_compact: true,
          rows: [
            {
              cells: [{ text: 'Epoch' }, { text: 'Loss' }, { text: 'Accuracy' }],
            },
            {
              cells: [{ text: '1' }, { text: '0.452' }, { text: '87.4%' }],
            },
            {
              cells: [{ text: '2' }, { text: '0.231' }, { text: '93.8%' }],
            },
            {
              cells: [{ text: '3' }, { text: '0.114' }, { text: '97.2%' }],
            },
          ],
        },
        {
          type: 'divider',
        },
        {
          type: 'expandable_blockquote',
          text: 'Traceback (most recent call last):\n  [Pyodide execution completed with 0 warnings]',
        },
        {
          type: 'buttons',
          buttons: [
            [
              { text: '▶ Run Next Cell', callback_data: 'run_cell_4' },
              { text: '⏹ Stop Generation', callback_data: 'stop_gen' },
            ],
            [
              {
                text: '📊 Open in TeleBook Mini App',
                web_app: { url: 'https://shoumikbalasomu.github.io/IPYNB-Hosting-TG/?nb=test' },
                is_disabled: false,
              },
            ],
          ],
        },
      ],
    };

    const parsed = InputRichMessageSchema.parse(richMessagePayload);
    assert.equal(parsed.version, '10.3');
    assert.equal(parsed.blocks.length, 7);
    const block0 = parsed.blocks[0];
    const block2 = parsed.blocks[2];
    const block3 = parsed.blocks[3];
    assert.ok(block0 && block0.type === 'section_heading');
    assert.ok(block2 && block2.type === 'preformatted');
    assert.ok(block3 && block3.type === 'table');
  });

  it('validates Bot API 10.3 is_compact table display', () => {
    const compactTable = {
      type: 'table',
      is_compact: true,
      rows: [
        {
          cells: [{ text: 'Cell 0' }, { text: 'Status: OK' }],
        },
      ],
    };

    const parsed = RichBlockTableSchema.parse(compactTable);
    assert.equal(parsed.is_compact, true);
  });

  it('validates Bot API 10.2 Ephemeral Message options with strict receiverUserId', () => {
    const ephemeralPayload = {
      chat_id: 123456789,
      receiver_user_id: 123456789,
      text: '🔑 Ephemeral Decryption Token: <b>120s TTL</b>',
      parse_mode: 'HTML',
      ephemeral_duration_seconds: 120,
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Approve Session', callback_data: 'approve_session_1' },
          ],
        ],
      },
    };

    const parsed = EphemeralMessageOptionsSchema.parse(ephemeralPayload);
    assert.equal(parsed.receiver_user_id, 123456789);
    assert.equal(parsed.ephemeral_duration_seconds, 120);
  });

  it('validates Bot API 10.5 BotSettings and BotFullInfo schemas', () => {
    const settings = {
      has_topic_sidebar: true,
      can_connect_to_business: true,
      can_join_groups: false,
      supports_inline_queries: true,
    };
    const parsedSettings = BotSettingsSchema.parse(settings);
    assert.equal(parsedSettings.has_topic_sidebar, true);

    const fullInfo = {
      id: 9108262788,
      is_bot: true,
      first_name: 'TeleBook',
      username: 'TeleBookBot',
      can_join_groups: false,
      can_read_all_group_messages: false,
      supports_inline_queries: true,
      can_connect_to_business: true,
      has_main_web_app: true,
      has_topic_sidebar: true,
      description: 'Zero-knowledge Jupyter notebook cloud on Telegram',
      short_description: 'Sovereign Jupyter notebooks on Telegram',
    };
    const parsedInfo = BotFullInfoSchema.parse(fullInfo);
    assert.equal(parsedInfo.id, 9108262788);
    assert.equal(parsedInfo.has_topic_sidebar, true);
  });
});
