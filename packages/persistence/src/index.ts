import Database from 'better-sqlite3';
import type { DurableJob, JobRepository } from '@woo-ops/application';

export const schemaVersion = 1;

export class SqliteStore implements JobRepository {
  readonly db: Database.Database;
  constructor(filename: string) {
    this.db = new Database(filename);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(`CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, type TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`);
  }
  claimNext(): Promise<DurableJob | null> {
    const row = this.db
      .prepare(
        "SELECT id, type, idempotency_key, status, attempts FROM jobs WHERE status = 'queued' ORDER BY created_at LIMIT 1",
      )
      .get() as
      | {
          id: string;
          type: string;
          idempotency_key: string;
          status: DurableJob['status'];
          attempts: number;
        }
      | undefined;
    return Promise.resolve(
      row
        ? {
            id: row.id,
            type: row.type,
            idempotencyKey: row.idempotency_key,
            status: row.status,
            attempts: row.attempts,
          }
        : null,
    );
  }
  complete(id: string): Promise<void> {
    this.db
      .prepare("UPDATE jobs SET status = 'succeeded', updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), id);
    return Promise.resolve();
  }
}
