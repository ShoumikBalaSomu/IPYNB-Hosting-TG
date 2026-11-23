// TeleBook Worker Domain Types

export interface TelegramUser {
  id: number;
  is_bot?: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface TelegramChat {
  id: number;
  type: string;
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

export interface TelegramDocument {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  document?: TelegramDocument;
  caption?: string;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface SessionPayload {
  sub: string; // telegram_id as string
  epoch: number;
  exp: number;
  iat: number;
  user_id?: string;
  [key: string]: unknown;
}

export interface UserRecord {
  id: string;
  telegram_id: number;
  username: string | null;
  auth_epoch: number;
  created_at: number;
  updated_at: number;
}

export interface NotebookRecord {
  id: string;
  user_id: string;
  title: string;
  description: string;
  current_version: number;
  is_starred: number;
  tags: string; // JSON array
  created_at: number;
  updated_at: number;
}

export interface NotebookVersionRecord {
  id: string;
  notebook_id: string;
  version: number;
  total_chunks: number;
  byte_size: number;
  commit_message: string;
  sha256_hash: string;
  created_at: number;
}

export interface NotebookChunkRecord {
  id: string;
  notebook_id: string;
  version: number;
  chunk_index: number;
  total_chunks: number;
  telegram_file_id: string;
  telegram_message_id: number;
  chunk_hash: string;
  byte_length: number;
  created_at: number;
}

export interface MagicTokenRecord {
  id: string;
  token_hash: string;
  status: 'pending' | 'approved' | 'expired';
  session_jwt: string | null;
  expires_at: number;
  created_at: number;
}

export interface SessionRecord {
  id: string;
  user_id: string;
  token_hash: string;
  epoch: number;
  ip_address: string | null;
  user_agent: string | null;
  expires_at: number;
  created_at: number;
}

export interface SharingTicketRecord {
  id: string;
  notebook_id: string;
  version: number;
  ticket_token_hash: string;
  created_by: string;
  expires_at: number;
  access_count: number;
  max_access_count: number;
  created_at: number;
}
