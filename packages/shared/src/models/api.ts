/**
 * API Wire Contracts (Zod Schemas)
 * Covers authentication, notebook metadata, chunk transfer, versions, and sharing tickets.
 */

import { z } from 'zod';

// --- Authentication & Sessions ---

export const MagicTokenCreateResponseSchema = z.object({
  token_id: z.string(),
  deep_link: z.string().url(),
  expires_at: z.number().int().positive()
});

export type MagicTokenCreateResponse = z.infer<typeof MagicTokenCreateResponseSchema>;

export const MagicTokenPollResponseSchema = z.object({
  status: z.enum(['pending', 'approved', 'expired']),
  session_token: z.string().optional(),
  expires_at: z.number().int().positive().optional()
});

export type MagicTokenPollResponse = z.infer<typeof MagicTokenPollResponseSchema>;

export const TelegramAuthVerifyRequestSchema = z.object({
  initData: z.string().min(1)
});

export type TelegramAuthVerifyRequest = z.infer<typeof TelegramAuthVerifyRequestSchema>;

export const TelegramAuthVerifyResponseSchema = z.object({
  authenticated: z.boolean(),
  session_token: z.string(),
  user: z.object({
    id: z.number().int(),
    username: z.string().optional(),
    first_name: z.string().optional()
  })
});

export type TelegramAuthVerifyResponse = z.infer<typeof TelegramAuthVerifyResponseSchema>;

export const RevokeResponseSchema = z.object({
  revoked: z.boolean(),
  new_epoch: z.number().int().positive()
});

export type RevokeResponse = z.infer<typeof RevokeResponseSchema>;

// --- Notebook Operations ---

export const NotebookSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().default(''),
  current_version: z.number().int().min(1),
  total_chunks: z.number().int().min(1),
  byte_size: z.number().int().nonnegative(),
  is_starred: z.boolean().default(false),
  tags: z.array(z.string()).default([]),
  created_at: z.number().int().positive(),
  updated_at: z.number().int().positive()
});

export type NotebookSummary = z.infer<typeof NotebookSummarySchema>;

export const NotebookListResponseSchema = z.object({
  notebooks: z.array(NotebookSummarySchema)
});

export type NotebookListResponse = z.infer<typeof NotebookListResponseSchema>;

export const NotebookCreateRequestSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1).max(256),
  description: z.string().max(2048).optional(),
  tags: z.array(z.string().max(64)).max(20).optional()
});

export type NotebookCreateRequest = z.infer<typeof NotebookCreateRequestSchema>;

export const NotebookUpdateRequestSchema = z.object({
  title: z.string().min(1).max(256).optional(),
  description: z.string().max(2048).optional(),
  is_starred: z.boolean().optional(),
  tags: z.array(z.string().max(64)).max(20).optional()
});

export type NotebookUpdateRequest = z.infer<typeof NotebookUpdateRequestSchema>;

// --- Chunk Transfer & Versioning ---

export const ChunkUploadResponseSchema = z.object({
  chunk_index: z.number().int().min(0),
  telegram_file_id: z.string().min(1),
  status: z.literal('stored')
});

export type ChunkUploadResponse = z.infer<typeof ChunkUploadResponseSchema>;

export const VersionFinalizeRequestSchema = z.object({
  total_chunks: z.number().int().min(1),
  byte_size: z.number().int().positive(),
  sha256_hash: z.string().regex(/^[0-9a-f]{64}$/i),
  commit_message: z.string().max(1024).optional().default('')
});

export type VersionFinalizeRequest = z.infer<typeof VersionFinalizeRequestSchema>;

export const VersionFinalizeResponseSchema = z.object({
  notebook_id: z.string(),
  version: z.number().int().min(1),
  total_chunks: z.number().int().min(1),
  byte_size: z.number().int().positive(),
  created_at: z.number().int().positive()
});

export type VersionFinalizeResponse = z.infer<typeof VersionFinalizeResponseSchema>;

// --- Ephemeral Sharing Tickets ---

export const ShareTicketCreateRequestSchema = z.object({
  notebook_id: z.string().min(1),
  version: z.number().int().min(1),
  expires_in_seconds: z.number().int().min(60).max(604800).default(86400) // 1 day default, max 7 days
});

export type ShareTicketCreateRequest = z.infer<typeof ShareTicketCreateRequestSchema>;

export const ShareTicketResponseSchema = z.object({
  ticket_id: z.string(),
  share_url: z.string().url(),
  expires_at: z.number().int().positive()
});

export type ShareTicketResponse = z.infer<typeof ShareTicketResponseSchema>;

export const ShareTicketVerifyResponseSchema = z.object({
  valid: z.boolean(),
  notebook_id: z.string().optional(),
  version: z.number().int().optional(),
  expires_at: z.number().int().positive().optional()
});

export type ShareTicketVerifyResponse = z.infer<typeof ShareTicketVerifyResponseSchema>;
