/**
 * TeleBook API Types.
 */

export interface NotebookSummary {
  id: string;
  title: string;
  current_version: number;
  total_chunks: number;
  byte_size: number;
  updated_at: number;
  tags?: string[];
}

export interface NotebookListResponse {
  notebooks: NotebookSummary[];
}

export interface MagicTokenResponse {
  token_id: string;
  deep_link: string;
  expires_at: number;
}

export interface MagicTokenStatusResponse {
  status: 'pending' | 'approved' | 'expired';
  session_token?: string;
  expires_at?: number;
}
