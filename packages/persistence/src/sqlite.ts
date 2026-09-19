import { existsSync } from 'node:fs';
import {
  DatabaseSync,
  backup as backupDatabase,
  type DatabaseSyncOptions,
  type StatementSync,
} from 'node:sqlite';

export type SqliteRunResult = { changes: number; lastInsertRowid: number | bigint };

const normalizeBinding = (value: unknown): unknown => (value === undefined ? null : value);

const normalizeBindings = (values: unknown[]): unknown[] =>
  values.map((value) => {
    if (value === null || typeof value !== 'object' || ArrayBuffer.isView(value)) {
      return normalizeBinding(value);
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalizeBinding(item)]),
    );
  });

export class SqliteStatement {
  constructor(private readonly native: StatementSync) {}

  run(...values: unknown[]): SqliteRunResult {
    const result = Reflect.apply(this.native.run, this.native, normalizeBindings(values)) as {
      changes: number | bigint;
      lastInsertRowid: number | bigint;
    };
    return { changes: Number(result.changes), lastInsertRowid: result.lastInsertRowid };
  }

  get(...values: unknown[]): Record<string, unknown> | undefined {
    const row = Reflect.apply(this.native.get, this.native, normalizeBindings(values)) as
      Record<string, unknown> | undefined;
    return row === undefined ? undefined : { ...row };
  }

  all(...values: unknown[]): Record<string, unknown>[] {
    const rows = Reflect.apply(this.native.all, this.native, normalizeBindings(values)) as Record<
      string,
      unknown
    >[];
    return rows.map((row) => ({ ...row }));
  }
}

export type SqliteDatabaseOptions = {
  readonly?: boolean;
  fileMustExist?: boolean;
};

export class SqliteDatabase {
  readonly native: DatabaseSync;
  private transactionDepth = 0;

  constructor(filename: string, options: SqliteDatabaseOptions = {}) {
    if (options.fileMustExist === true && !existsSync(filename)) {
      throw new Error('SQLITE_DATABASE_NOT_FOUND');
    }
    const nativeOptions: DatabaseSyncOptions = {
      readOnly: options.readonly === true,
      enableForeignKeyConstraints: true,
      enableDoubleQuotedStringLiterals: false,
      allowExtension: false,
      timeout: 5_000,
      readBigInts: false,
      returnArrays: false,
      allowBareNamedParameters: true,
      allowUnknownNamedParameters: false,
    };
    this.native = new DatabaseSync(filename, nativeOptions);
  }

  get open(): boolean {
    return this.native.isOpen;
  }

  exec(sql: string): void {
    this.native.exec(sql);
  }

  prepare(sql: string): SqliteStatement {
    return new SqliteStatement(this.native.prepare(sql));
  }

  close(): void {
    this.native.close();
  }

  pragma(source: string, options: { simple?: boolean } = {}): unknown {
    const statement = new SqliteStatement(this.native.prepare(`PRAGMA ${source}`));
    if (/=/u.test(source)) {
      statement.run();
      return options.simple === true ? undefined : [];
    }
    const rows = statement.all() as Record<string, unknown>[];
    if (options.simple !== true) return rows;
    const first = rows[0];
    return first ? Object.values(first)[0] : undefined;
  }

  transaction<Arguments extends unknown[], Result>(
    operation: (...argumentsList: Arguments) => Result,
  ): (...argumentsList: Arguments) => Result {
    return (...argumentsList: Arguments): Result => {
      const depth = this.transactionDepth;
      const savepoint = `woo_ops_nested_${depth}`;
      this.exec(depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${savepoint}`);
      this.transactionDepth += 1;
      try {
        const result = operation(...argumentsList);
        this.exec(depth === 0 ? 'COMMIT' : `RELEASE SAVEPOINT ${savepoint}`);
        return result;
      } catch (error) {
        if (depth === 0) {
          this.exec('ROLLBACK');
        } else {
          this.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`);
          this.exec(`RELEASE SAVEPOINT ${savepoint}`);
        }
        throw error;
      } finally {
        this.transactionDepth -= 1;
      }
    };
  }

  async backup(path: string): Promise<number> {
    return backupDatabase(this.native, path);
  }
}
