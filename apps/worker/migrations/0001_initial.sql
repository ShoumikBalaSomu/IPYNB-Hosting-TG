-- Cloudflare D1 SQLite Initial Migration for TeleBook
-- Migration: 0001_initial.sql

-- Single Owner Configuration
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    telegram_id INTEGER UNIQUE NOT NULL,
    username TEXT,
    auth_epoch INTEGER DEFAULT 1 NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- Notebook Metadata Table
CREATE TABLE IF NOT EXISTS notebooks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    current_version INTEGER DEFAULT 1 NOT NULL,
    is_starred INTEGER DEFAULT 0 NOT NULL,
    tags TEXT DEFAULT '[]',             -- JSON array of strings
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Notebook Version Audit Log
CREATE TABLE IF NOT EXISTS notebook_versions (
    id TEXT PRIMARY KEY,
    notebook_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    total_chunks INTEGER NOT NULL,
    byte_size INTEGER NOT NULL,
    commit_message TEXT DEFAULT '',
    sha256_hash TEXT NOT NULL,          -- SHA-256 hash of raw notebook payload
    created_at INTEGER NOT NULL,
    FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE,
    UNIQUE(notebook_id, version)
);

-- Encrypted Chunks Manifest Table
CREATE TABLE IF NOT EXISTS notebook_chunks (
    id TEXT PRIMARY KEY,
    notebook_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    chunk_index INTEGER NOT NULL,
    total_chunks INTEGER NOT NULL,
    telegram_file_id TEXT NOT NULL,
    telegram_message_id INTEGER NOT NULL,
    chunk_hash TEXT NOT NULL,          -- SHA-256 of encrypted TB01 binary chunk
    byte_length INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE,
    UNIQUE(notebook_id, version, chunk_index)
);

-- Convenience View for chunks
CREATE VIEW IF NOT EXISTS chunks AS 
SELECT * FROM notebook_chunks;

-- Active Device Sessions
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_hash TEXT UNIQUE NOT NULL,
    epoch INTEGER NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Ephemeral Magic Tokens for Desktop Login
CREATE TABLE IF NOT EXISTS magic_tokens (
    id TEXT PRIMARY KEY,
    token_hash TEXT UNIQUE NOT NULL,   -- SHA-256 of magic token
    status TEXT DEFAULT 'pending' NOT NULL, -- 'pending' | 'approved' | 'expired'
    session_jwt TEXT,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);

-- Ephemeral Cryptographic Sharing Tickets
CREATE TABLE IF NOT EXISTS sharing_tickets (
    id TEXT PRIMARY KEY,
    notebook_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    ticket_token_hash TEXT UNIQUE NOT NULL, -- SHA-256 of ticket secret
    created_by TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    access_count INTEGER DEFAULT 0 NOT NULL,
    max_access_count INTEGER DEFAULT 1 NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE CASCADE
);

-- B-Tree Performance Indices
CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_notebooks_user ON notebooks(user_id);
CREATE INDEX IF NOT EXISTS idx_notebooks_title ON notebooks(title);
CREATE INDEX IF NOT EXISTS idx_notebooks_updated ON notebooks(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_versions_lookup ON notebook_versions(notebook_id, version);
CREATE INDEX IF NOT EXISTS idx_chunks_lookup ON notebook_chunks(notebook_id, version, chunk_index);
CREATE INDEX IF NOT EXISTS idx_sessions_user_epoch ON sessions(user_id, epoch);
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_tokens_hash ON magic_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_tokens_expires ON magic_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_sharing_tickets_hash ON sharing_tickets(ticket_token_hash);
CREATE INDEX IF NOT EXISTS idx_sharing_tickets_notebook ON sharing_tickets(notebook_id, version);
