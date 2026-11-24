import { z } from 'zod';

// ============================================================================
// Telegram Bot API 10.1 - 10.3: Rich Messages Specification
// ============================================================================

export const RichTextEntitySchema = z.object({
  type: z.enum([
    'mention',
    'hashtag',
    'cashtag',
    'bot_command',
    'url',
    'email',
    'phone_number',
    'bold',
    'italic',
    'underline',
    'strikethrough',
    'spoiler',
    'blockquote',
    'expandable_blockquote',
    'code',
    'pre',
    'text_link',
    'text_mention',
    'custom_emoji',
  ]),
  offset: z.number().int().nonnegative(),
  length: z.number().int().positive(),
  url: z.string().url().optional(),
  language: z.string().optional(),
  custom_emoji_id: z.string().optional(),
});

export type RichTextEntity = z.infer<typeof RichTextEntitySchema>;

export const RichMessageButtonSchema = z.object({
  text: z.string().min(1),
  url: z.string().url().optional(),
  callback_data: z.string().max(64).optional(),
  web_app: z.object({ url: z.string().url() }).optional(),
  is_disabled: z.boolean().optional(), // Bot API 10.3: Disabled button support
});

export type RichMessageButton = z.infer<typeof RichMessageButtonSchema>;

// Rich Blocks
export const RichBlockParagraphSchema = z.object({
  type: z.literal('paragraph'),
  text: z.string(),
  entities: z.array(RichTextEntitySchema).optional(),
});

export const RichBlockSectionHeadingSchema = z.object({
  type: z.literal('section_heading'),
  text: z.string(),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
  entities: z.array(RichTextEntitySchema).optional(),
});

export const RichBlockPreformattedSchema = z.object({
  type: z.literal('preformatted'),
  text: z.string(),
  language: z.string().optional(), // e.g., 'python', 'json', 'bash'
});

export const RichBlockTableCellSchema = z.object({
  text: z.string(),
  entities: z.array(RichTextEntitySchema).optional(),
});

export const RichBlockTableRowSchema = z.object({
  cells: z.array(RichBlockTableCellSchema),
});

export const RichBlockTableSchema = z.object({
  type: z.literal('table'),
  rows: z.array(RichBlockTableRowSchema),
  is_compact: z.boolean().optional().default(false), // Bot API 10.3: Compact table display
});

export const RichBlockListSchema = z.object({
  type: z.literal('list'),
  items: z.array(z.string()),
  ordered: z.boolean().optional().default(false),
});

export const RichBlockDividerSchema = z.object({
  type: z.literal('divider'),
});

export const RichBlockExpandableBlockQuotationSchema = z.object({
  type: z.literal('expandable_blockquote'),
  text: z.string(),
  entities: z.array(RichTextEntitySchema).optional(),
});

export const RichBlockThinkingSchema = z.object({
  type: z.literal('thinking'),
  status_text: z.string(), // e.g. "Initializing Pyodide sandbox..."
  is_active: z.boolean().default(true),
});

export const RichBlockButtonsSchema = z.object({
  type: z.literal('buttons'),
  buttons: z.array(z.array(RichMessageButtonSchema)),
});

export const RichBlockDocumentSchema = z.object({
  type: z.literal('document'),
  file_name: z.string(),
  file_size: z.number().int().nonnegative().optional(),
  mime_type: z.string().optional(),
});

export const RichBlockSchema = z.discriminatedUnion('type', [
  RichBlockParagraphSchema,
  RichBlockSectionHeadingSchema,
  RichBlockPreformattedSchema,
  RichBlockTableSchema,
  RichBlockListSchema,
  RichBlockDividerSchema,
  RichBlockExpandableBlockQuotationSchema,
  RichBlockThinkingSchema,
  RichBlockButtonsSchema,
  RichBlockDocumentSchema,
]);

export type RichBlock = z.infer<typeof RichBlockSchema>;

export const InputRichMessageSchema = z.object({
  blocks: z.array(RichBlockSchema),
  version: z.literal('10.3').default('10.3'),
  stop_generation_supported: z.boolean().optional().default(true),
});

export type InputRichMessage = z.infer<typeof InputRichMessageSchema>;

// ============================================================================
// Telegram Bot API 10.2: Ephemeral Messages Specification
// ============================================================================

export const EphemeralMessageOptionsSchema = z.object({
  chat_id: z.union([z.number().int(), z.string()]),
  receiver_user_id: z.number().int(), // Strict receiver isolation
  text: z.string().min(1),
  parse_mode: z.enum(['HTML', 'MarkdownV2']).default('HTML'),
  ephemeral_duration_seconds: z.number().int().min(10).max(86400).optional(),
  reply_markup: z
    .object({
      inline_keyboard: z.array(z.array(RichMessageButtonSchema)).optional(),
    })
    .optional(),
});

export type EphemeralMessageOptions = z.infer<typeof EphemeralMessageOptionsSchema>;

// ============================================================================
// Telegram Bot API 10.5: Bot Settings & Full Info
// ============================================================================

export const BotSettingsSchema = z.object({
  has_topic_sidebar: z.boolean().optional(),
  can_join_groups: z.boolean().optional(),
  can_read_all_group_messages: z.boolean().optional(),
  supports_inline_queries: z.boolean().optional(),
  can_connect_to_business: z.boolean().optional(),
});

export type BotSettings = z.infer<typeof BotSettingsSchema>;

export const BotFullInfoSchema = z.object({
  id: z.number().int(),
  is_bot: z.literal(true),
  first_name: z.string(),
  last_name: z.string().optional(),
  username: z.string().optional(),
  can_join_groups: z.boolean(),
  can_read_all_group_messages: z.boolean(),
  supports_inline_queries: z.boolean(),
  can_connect_to_business: z.boolean().optional(),
  has_main_web_app: z.boolean().optional(),
  has_topic_sidebar: z.boolean().optional(),
  description: z.string().optional(),
  short_description: z.string().optional(),
});

export type BotFullInfo = z.infer<typeof BotFullInfoSchema>;
