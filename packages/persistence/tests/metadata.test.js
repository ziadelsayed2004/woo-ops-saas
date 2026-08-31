import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { discoverMetadata, SqliteStore } from '../dist/index.js';

const directory = mkdtempSync(join(tmpdir(), 'woo-metadata-'));
const store = new SqliteStore(join(directory, 'metadata.sqlite'));
const accountId = randomUUID();
const connectionId = randomUUID();
const now = new Date().toISOString();
store.db
  .prepare('INSERT INTO accounts (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
  .run(accountId, 'Metadata', now, now);
store.db
  .prepare(
    'INSERT INTO connections (id, account_id, platform, store_url, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
  .run(connectionId, accountId, 'woocommerce', 'https://metadata.test', 'active', now, now);
const context = { accountId, actorId: randomUUID(), correlationId: randomUUID() };
store.db
  .prepare(
    'INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  )
  .run(context.actorId, 'metadata-admin@example.test', 'test-hash', now, now);
store.db
  .prepare(
    'INSERT INTO account_memberships (account_id, user_id, role, created_at) VALUES (?, ?, ?, ?)',
  )
  .run(accountId, context.actorId, 'admin', now);

test('metadata discovery protects private keys and does not infer unsafe types', () => {
  const entries = discoverMetadata([
    {
      meta_data: [
        { key: 'pos_location', value: 'Cairo' },
        { key: '_payment_token', value: 'secret-value' },
        { key: 'mixed', value: true },
      ],
    },
    { meta_data: [{ key: 'mixed', value: 'not-a-boolean' }] },
  ]);
  assert.equal(entries.find((entry) => entry.sourceKey === 'pos_location').sensitivity, 'safe');
  assert.equal(
    entries.find((entry) => entry.sourceKey === '_payment_token').sensitivity,
    'private',
  );
  assert.equal(entries.find((entry) => entry.sourceKey === 'mixed').inferredType, 'unknown');
  const stored = store.discoverOrderMetadata(context, connectionId, [
    {
      meta_data: [
        { key: '_payment_token', value: 'secret-value' },
        { key: 'pos_location', value: 'Cairo' },
      ],
    },
  ]);
  assert.equal(stored.length, 2);
  assert.equal(
    store.db
      .prepare('SELECT sample_json FROM field_catalogs WHERE source_key = ?')
      .get('_payment_token').sample_json,
    null,
  );
});

test('typed mapping requires explicit safe field and resumable backfill', () => {
  assert.throws(
    () =>
      store.createFieldMapping(context, {
        connectionId,
        sourceKey: '_payment_token',
        label: 'Token',
        type: 'text',
      }),
    /FIELD_MAPPING_PRIVATE/,
  );
  const mapping = store.createFieldMapping(context, {
    connectionId,
    sourceKey: 'pos_location',
    label: 'POS location',
    type: 'text',
    targetFacet: 'pos',
  });
  for (const [id, location] of [
    ['order-a', 'Cairo'],
    ['order-b', 'Giza'],
  ])
    store.db
      .prepare(
        'INSERT INTO orders (id, account_id, connection_id, origin, order_number, external_order_id, currency, grand_total_minor, remote_payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        id,
        accountId,
        connectionId,
        'woo',
        id,
        id,
        'EGP',
        '100',
        JSON.stringify({ meta_data: [{ key: 'pos_location', value: location }] }),
        now,
        now,
      );
  const first = store.backfillFieldMapping(context, mapping.id, null, 1);
  assert.deepEqual(
    { processed: first.processed, mapped: first.mapped, errors: first.errors },
    { processed: 1, mapped: 1, errors: 0 },
  );
  const second = store.backfillFieldMapping(context, mapping.id, first.nextCursor, 1);
  assert.deepEqual(
    { processed: second.processed, mapped: second.mapped, errors: second.errors },
    { processed: 1, mapped: 1, errors: 0 },
  );
  assert.equal(
    store.db
      .prepare(
        'SELECT COUNT(*) AS count FROM order_mapped_fields WHERE account_id = ? AND mapping_id = ?',
      )
      .get(accountId, mapping.id).count,
    2,
  );
  assert.equal(
    store.db
      .prepare('SELECT COUNT(*) AS count FROM audit_events WHERE account_id = ? AND action = ?')
      .get(accountId, 'field-mapping.created').count,
    1,
  );
});

test.after(() => {
  store.db.close();
  rmSync(directory, { recursive: true, force: true });
});
