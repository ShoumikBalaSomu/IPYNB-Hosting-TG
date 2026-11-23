// Real SQLite in-memory mock implementing Cloudflare D1Database interface

import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';

export class MockD1Database {
  private sqlite: DatabaseSync;

  constructor() {
    this.sqlite = new DatabaseSync(':memory:');
    this.initMigrations();
  }

  private initMigrations() {
    const migrationPath = path.resolve(__dirname, '../migrations/0001_initial.sql');
    if (fs.existsSync(migrationPath)) {
      const sql = fs.readFileSync(migrationPath, 'utf-8');
      this.sqlite.exec(sql);
    }
  }

  prepare(query: string): MockD1PreparedStatement {
    return new MockD1PreparedStatement(this.sqlite, query);
  }

  async batch<T = unknown>(statements: MockD1PreparedStatement[]): Promise<{ results?: T[]; meta: { changes: number } }[]> {
    this.sqlite.exec('BEGIN TRANSACTION');
    try {
      const results = [];
      for (const stmt of statements) {
        const res = await stmt.run();
        results.push(res);
      }
      this.sqlite.exec('COMMIT');
      return results as { results?: T[]; meta: { changes: number } }[];
    } catch (err) {
      this.sqlite.exec('ROLLBACK');
      throw err;
    }
  }

  async exec(query: string): Promise<{ count: number; duration: number }> {
    this.sqlite.exec(query);
    return { count: 1, duration: 1 };
  }
}

export class MockD1PreparedStatement {
  private boundValues: unknown[] = [];

  constructor(private sqlite: DatabaseSync, private query: string) {}

  bind(...values: unknown[]): MockD1PreparedStatement {
    const copy = new MockD1PreparedStatement(this.sqlite, this.query);
    copy.boundValues = values.map(v => (v === undefined ? null : v));
    return copy;
  }

  async first<T = unknown>(colName?: string): Promise<T | null> {
    const stmt = this.sqlite.prepare(this.query);
    const row = stmt.get(...(this.boundValues as (string | number | bigint | Uint8Array | null)[])) as Record<string, unknown> | undefined;
    if (!row) return null;
    if (colName) {
      return (row[colName] as T) ?? null;
    }
    return row as T;
  }

  async all<T = unknown>(): Promise<{ results: T[]; meta: { changes: number } }> {
    const stmt = this.sqlite.prepare(this.query);
    const rows = stmt.all(...(this.boundValues as (string | number | bigint | Uint8Array | null)[])) as T[];
    return {
      results: rows,
      meta: { changes: 0 }
    };
  }

  async run(): Promise<{ meta: { changes: number; last_row_id: number } }> {
    const stmt = this.sqlite.prepare(this.query);
    const info = stmt.run(...(this.boundValues as (string | number | bigint | Uint8Array | null)[]));
    return {
      meta: {
        changes: Number(info.changes),
        last_row_id: Number(info.lastInsertRowid)
      }
    };
  }
}

export function createTestD1(): D1Database {
  return new MockD1Database() as unknown as D1Database;
}
