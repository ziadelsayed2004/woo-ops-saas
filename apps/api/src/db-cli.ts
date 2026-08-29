import { copyFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { SqliteStore } from '@woo-ops/persistence';

const databasePath = resolve(process.env.WOO_OPS_DATABASE ?? './data/woo-ops.sqlite');
const command = process.argv[2];
if (command === 'migrate') {
  const store = new SqliteStore(databasePath);
  store.db.close();
  console.log(`SQLite migrations applied: ${databasePath}`);
} else if (command === 'backup') {
  mkdirSync(resolve('./data/backups'), { recursive: true });
  const target = resolve(
    `./data/backups/woo-ops-${new Date().toISOString().replaceAll(':', '-')}.sqlite`,
  );
  copyFileSync(databasePath, target);
  console.log(`SQLite backup created: ${target}`);
} else {
  throw new Error('Usage: db-cli migrate|backup');
}
