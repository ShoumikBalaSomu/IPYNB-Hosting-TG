/**
 * Chunk & Version Manifest Zod Schemas
 * Tracks encrypted chunks stored in Telegram Bot API and registered in Cloudflare D1.
 */

import { z } from 'zod';

export const ChunkManifestItemSchema = z.object({
  id: z.string().optional(),
  notebook_id: z.string().min(1),
  version: z.number().int().min(1),
  chunk_index: z.number().int().min(0),
  total_chunks: z.number().int().min(1),
  telegram_file_id: z.string().min(1),
  telegram_message_id: z.number().int(),
  chunk_hash: z.string().regex(/^[0-9a-f]{64}$/i, 'Must be a 64-char hex SHA-256 hash'),
  byte_length: z.number().int().positive(),
  download_url: z.string().optional(),
  created_at: z.number().int().positive().optional()
});

export type ChunkManifestItem = z.infer<typeof ChunkManifestItemSchema>;

export const NotebookVersionManifestSchema = z.object({
  notebook_id: z.string().min(1),
  version: z.number().int().min(1),
  total_chunks: z.number().int().min(1),
  byte_size: z.number().int().positive(),
  sha256_hash: z.string().regex(/^[0-9a-f]{64}$/i, 'Must be a 64-char hex SHA-256 hash'),
  commit_message: z.string().default(''),
  chunks: z.array(ChunkManifestItemSchema),
  created_at: z.number().int().positive().optional()
});

export type NotebookVersionManifest = z.infer<typeof NotebookVersionManifestSchema>;

export const ChunkDownloadInfoSchema = z.object({
  chunk_index: z.number().int().min(0),
  chunk_hash: z.string().regex(/^[0-9a-f]{64}$/i),
  byte_length: z.number().int().positive(),
  download_url: z.string()
});

export type ChunkDownloadInfo = z.infer<typeof ChunkDownloadInfoSchema>;

export const NotebookVersionDetailResponseSchema = z.object({
  notebook_id: z.string(),
  version: z.number().int(),
  total_chunks: z.number().int(),
  byte_size: z.number().int(),
  chunks: z.array(ChunkDownloadInfoSchema)
});

export type NotebookVersionDetailResponse = z.infer<typeof NotebookVersionDetailResponseSchema>;
