import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { resolveRuntimePaths } from '../../src/runtime-paths.ts';

test('Hostinger release directories share one domain-level data root', () => {
  const domainRoot = resolve('fixtures', 'domains', 'ops.example.test');
  const first = resolveRuntimePaths(
    { NODE_ENV: 'production' },
    join(domainRoot, 'hbuilds', 'release-a', 'source', 'repository'),
  );
  const second = resolveRuntimePaths(
    { NODE_ENV: 'production' },
    join(domainRoot, 'hbuilds', 'release-b', 'source', 'repository'),
  );

  assert.equal(first.persistenceMode, 'hostinger-domain');
  assert.equal(first.durable, true);
  assert.equal(first.dataDirectory, join(domainRoot, '.woo-ops-data'));
  assert.equal(second.dataDirectory, first.dataDirectory);
  assert.equal(second.databasePath, first.databasePath);
});

test('legacy relative Hostinger overrides cannot move accounts into a disposable release', () => {
  const domainRoot = resolve('fixtures', 'domains', 'ops.example.test');
  const cwd = join(domainRoot, 'hbuilds', 'release-a', 'source', 'repository');
  const paths = resolveRuntimePaths(
    { NODE_ENV: 'production', WOO_OPS_DATA_DIR: 'data', WOO_OPS_DATABASE: 'data/store.sqlite' },
    cwd,
  );
  assert.equal(paths.persistenceMode, 'hostinger-domain');
  assert.equal(paths.durable, true);
  assert.equal(paths.dataDirectory, join(domainRoot, '.woo-ops-data'));
  assert.equal(paths.databasePath, join(domainRoot, '.woo-ops-data', 'woo-ops.sqlite'));
});

test('explicit absolute data and database paths keep precedence', () => {
  const cwd = resolve('fixtures', 'release');
  const paths = resolveRuntimePaths(
    {
      NODE_ENV: 'production',
      WOO_OPS_DATA_DIR: resolve('fixtures', 'private-data'),
      WOO_OPS_DATABASE: resolve('fixtures', 'private-db', 'store.sqlite'),
    },
    cwd,
  );

  assert.equal(paths.persistenceMode, 'configured');
  assert.equal(paths.durable, true);
  assert.equal(paths.dataDirectory, resolve('fixtures', 'private-data'));
  assert.equal(paths.databasePath, resolve('fixtures', 'private-db', 'store.sqlite'));
});

test('absolute data root safely absorbs a stale relative database override', () => {
  const cwd = resolve('fixtures', 'release');
  const dataDirectory = resolve('fixtures', 'private-data');
  const paths = resolveRuntimePaths(
    {
      NODE_ENV: 'production',
      WOO_OPS_DATA_DIR: dataDirectory,
      WOO_OPS_DATABASE: './data/woo-ops.sqlite',
    },
    cwd,
  );
  assert.equal(paths.persistenceMode, 'configured');
  assert.equal(paths.durable, true);
  assert.equal(paths.databasePath, join(dataDirectory, 'woo-ops.sqlite'));
});
