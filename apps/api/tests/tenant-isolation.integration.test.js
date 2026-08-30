import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { SqliteStore } from '@woo-ops/persistence';

test('API repository contexts cannot read another account by order ID or search', () => {
  const directory = mkdtempSync(join(tmpdir(), 'woo-api-isolation-'));
  const store = new SqliteStore(join(directory, 'isolation.sqlite'));
  const now = new Date().toISOString();
  const accountA = randomUUID();
  const accountB = randomUUID();
  const actorA = randomUUID();
  const actorB = randomUUID();
  try {
    for (const [id, name] of [
      [accountA, 'A'],
      [accountB, 'B'],
    ])
      store.db
        .prepare('INSERT INTO accounts (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
        .run(id, name, now, now);
    for (const [id, email, accountId] of [
      [actorA, 'a-isolation@example.test', accountA],
      [actorB, 'b-isolation@example.test', accountB],
    ]) {
      store.db
        .prepare(
          'INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        )
        .run(id, email, 'fixture-hash', now, now);
      store.db
        .prepare(
          'INSERT INTO account_memberships (account_id, user_id, role, created_at) VALUES (?, ?, ?, ?)',
        )
        .run(accountId, id, 'admin', now);
    }
    const contextA = {
      accountId: accountA,
      actorId: actorA,
      role: 'admin',
      correlationId: randomUUID(),
    };
    const contextB = {
      accountId: accountB,
      actorId: actorB,
      role: 'admin',
      correlationId: randomUUID(),
    };
    const order = store.createManualOrder(contextA, {
      currency: 'EGP',
      customer: { name: 'private customer' },
      lines: [{ name: 'private item', quantity: 1, unitPriceMinor: '100' }],
    });
    assert.equal(store.getOrder(contextB, order.id), null);
    assert.equal(store.queryOrders(contextB, { search: order.orderNumber }).items.length, 0);
  } finally {
    if (store.db.open) store.db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
