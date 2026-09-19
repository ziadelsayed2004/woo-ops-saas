import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { migrateLegacyHostingerDatabase } from '../../src/legacy-hostinger-migration.ts';
import { resolveRuntimePaths } from '../../src/runtime-paths.ts';

test('moves the newest legacy release database into stable Hostinger storage once', () => {
  const root = mkdtempSync(join(tmpdir(), 'woo-hostinger-migrate-'));
  try {
    const domain = join(root, 'domains', 'ops.example.test');
    const oldRepository = join(domain, 'hbuilds', 'release-old', 'source', 'repository');
    const nextRepository = join(domain, 'hbuilds', 'release-new', 'source', 'repository');
    mkdirSync(join(oldRepository, 'data'), { recursive: true });
    mkdirSync(nextRepository, { recursive: true });
    writeFileSync(join(oldRepository, 'data', 'woo-ops.sqlite'), 'account-data');
    mkdirSync(join(oldRepository, 'data', 'private-exports'), { recursive: true });
    writeFileSync(join(oldRepository, 'data', 'private-exports', 'batch.xlsx'), 'sheet');
    const env = { NODE_ENV: 'production', WOO_OPS_DATA_DIR: 'data' };
    const paths = resolveRuntimePaths(env, nextRepository);
    assert.equal(
      migrateLegacyHostingerDatabase(paths, env),
      join(oldRepository, 'data', 'woo-ops.sqlite'),
    );
    assert.equal(readFileSync(paths.databasePath, 'utf8'), 'account-data');
    assert.equal(readFileSync(join(paths.dataDirectory, 'private-exports', 'batch.xlsx'), 'utf8'), 'sheet');
    writeFileSync(paths.databasePath, 'durable-data');
    assert.equal(migrateLegacyHostingerDatabase(paths, env), null);
    assert.equal(readFileSync(paths.databasePath, 'utf8'), 'durable-data');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
