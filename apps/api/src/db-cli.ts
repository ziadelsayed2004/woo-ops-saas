import { resolve } from 'node:path';
import { SqliteStore } from '@woo-ops/persistence';
import { createBackup, listBackups, restoreBackup } from './backup.js';

const dataDirectory = resolve(process.env.WOO_OPS_DATA_DIR ?? './data');
const databasePath = resolve(process.env.WOO_OPS_DATABASE ?? `${dataDirectory}/woo-ops.sqlite`);
const command = process.argv[2];
const args = process.argv.slice(3);

const argument = (name: string): string | undefined => {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  if (index >= 0 && (!value || value.startsWith('--')))
    throw new Error(`Missing value for ${name}`);
  return value;
};

const positiveInteger = (value: string | undefined, fallback: number): number => {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1)
    throw new Error(`Invalid positive integer: ${value}`);
  return parsed;
};

const closeStore = (store: SqliteStore): void => {
  if (store.db.open) store.db.close();
};

const main = async (): Promise<void> => {
  if (command === 'migrate') {
    const store = new SqliteStore(databasePath);
    closeStore(store);
    console.log(`SQLite migrations applied: ${databasePath}`);
    return;
  }

  if (command === 'list') {
    console.log(JSON.stringify(listBackups(dataDirectory), null, 2));
    return;
  }

  if (command === 'restore') {
    const backupId = args.find((value) => !value.startsWith('--'));
    if (!backupId) throw new Error('Usage: db-cli restore <backup-id> [--apply]');
    const result = await restoreBackup({
      dataDirectory,
      databasePath,
      backupId,
      dryRun: !args.includes('--apply'),
    });
    console.log(
      JSON.stringify(
        {
          backupId: result.manifest.id,
          validatedAt: result.validatedAt,
          fileCount: result.fileCount,
          totalBytes: result.totalBytes,
          dryRun: result.dryRun,
          restored: result.restored,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (command === 'backup' || command === 'maintenance') {
    const store = new SqliteStore(databasePath);
    try {
      const manifest = await createBackup({
        dataDirectory,
        databasePath,
        database: store.db,
        retention: positiveInteger(
          argument('--retention') ?? process.env.WOO_OPS_BACKUP_RETENTION,
          7,
        ),
        maxFiles: positiveInteger(argument('--max-files'), 10_000),
        maxBytes: positiveInteger(argument('--max-bytes'), 1024 * 1024 * 1024),
      });
      console.log(
        JSON.stringify(
          { id: manifest.id, createdAt: manifest.createdAt, files: manifest.files.length },
          null,
          2,
        ),
      );
    } finally {
      closeStore(store);
    }
    return;
  }

  throw new Error(
    'Usage: db-cli migrate|backup|maintenance|list|restore <backup-id> [--apply] [--retention N]',
  );
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Database command failed');
  process.exitCode = 1;
});
