import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SqliteStore } from '../packages/persistence/dist/index.js';

const require = createRequire(import.meta.url);
const Database = require('../packages/persistence/node_modules/better-sqlite3');

const DATASETS = [10_000, 100_000];
const ITERATIONS = 25;
const BUDGETS_MS = {
  list: 700,
  filteredList: 700,
  search: 1_500,
  selection: 700,
  jobRoundTrip: 250,
};

const percentile = (values, fraction) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
};

const measure = (operation, iterations = ITERATIONS) => {
  const samples = [];
  for (let index = 0; index < iterations; index += 1) {
    const startedAt = performance.now();
    operation(index);
    samples.push(performance.now() - startedAt);
  }
  return {
    iterations,
    minMs: Number(Math.min(...samples).toFixed(2)),
    medianMs: Number(percentile(samples, 0.5).toFixed(2)),
    p95Ms: Number(percentile(samples, 0.95).toFixed(2)),
    maxMs: Number(Math.max(...samples).toFixed(2)),
  };
};

const seed = (count) => {
  const directory = mkdtempSync(join(tmpdir(), `woo-performance-${count}-`));
  const databasePath = join(directory, 'performance.sqlite');
  const store = new SqliteStore(databasePath);
  const accountId = randomUUID();
  const connectionId = randomUUID();
  const actorId = randomUUID();
  const now = new Date().toISOString();
  const database = new Database(databasePath);
  database
    .prepare('INSERT INTO accounts (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
    .run(accountId, `Performance ${count}`, now, now);
  database
    .prepare(
      'INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(actorId, `performance-${count}@example.test`, 'fixture-hash', now, now);
  database
    .prepare(
      'INSERT INTO account_memberships (account_id, user_id, role, created_at) VALUES (?, ?, ?, ?)',
    )
    .run(accountId, actorId, 'admin', now);
  database
    .prepare(
      'INSERT INTO connections (id, account_id, platform, store_url, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      connectionId,
      accountId,
      'woocommerce',
      'https://performance.example.test',
      'active',
      now,
      now,
    );

  const insert = database.prepare(
    `INSERT INTO orders
      (id, account_id, connection_id, origin, order_number, external_order_id, remote_status,
       local_status, export_state, currency, grand_total_minor, source_hash, remote_modified_at,
       normalized_json, created_at, updated_at)
     VALUES (?, ?, ?, 'woo', ?, ?, ?, ?, ?, 'EGP', ?, ?, ?, ?, ?, ?)`,
  );
  const insertOrders = database.transaction(() => {
    for (let index = 0; index < count; index += 1) {
      const orderNumber = `PERF-${String(index + 1).padStart(7, '0')}`;
      const modifiedAt = new Date(Date.UTC(2026, 0, 1, 0, 0, index % 60)).toISOString();
      const status = index % 5 === 0 ? 'completed' : 'processing';
      const normalized = JSON.stringify({
        orderNumber,
        customer: {
          name: `Customer ${index % 10_000}`,
          phone: `010${String(index).padStart(8, '0')}`,
        },
        lines: [
          {
            name: index % 2 === 0 ? 'Performance shirt' : 'Performance shoe',
            sku: index % 2 === 0 ? 'PERF-SHIRT' : 'PERF-SHOE',
            quantity: (index % 3) + 1,
          },
        ],
      });
      insert.run(
        `${accountId}:${connectionId}:order:${index + 1}`,
        accountId,
        connectionId,
        orderNumber,
        String(index + 1),
        status,
        'new',
        index % 7 === 0 ? 'exported' : 'never-exported',
        String(10_000 + (index % 90_000)),
        `source-${index}`,
        modifiedAt,
        normalized,
        modifiedAt,
        modifiedAt,
      );
    }
  });
  const seedStartedAt = performance.now();
  insertOrders();
  const seedMs = performance.now() - seedStartedAt;
  database.close();
  return {
    directory,
    databasePath,
    store,
    context: { accountId, actorId, role: 'admin', correlationId: randomUUID() },
    count,
    seedMs: Number(seedMs.toFixed(2)),
  };
};

const runDataset = (count) => {
  const fixture = seed(count);
  const { store, context } = fixture;
  try {
    const list = store.queryOrders(context, {
      limit: 100,
      sort: { field: 'remoteCreatedAt', direction: 'desc' },
    });
    assert(list.items.length === 100, `${count}: list query returned ${list.items.length}`);
    const filtered = store.queryOrders(context, {
      limit: 100,
      filter: { field: 'remoteStatus', operator: 'equals', value: 'processing' },
      sort: { field: 'remoteCreatedAt', direction: 'desc' },
    });
    assert(
      filtered.items.length === 100,
      `${count}: filtered query returned ${filtered.items.length}`,
    );
    const searched = store.queryOrders(context, { search: 'PERF-SHIRT', limit: 100 });
    assert(searched.items.length > 0, `${count}: search returned no fixture orders`);
    const selection = store.createSelection(context, {
      mode: 'query',
      query: {
        filter: { field: 'remoteStatus', operator: 'equals', value: 'processing' },
        limit: 100,
        sort: { field: 'id', direction: 'asc' },
      },
    });
    const selectedPage = store.resolveSelection(context, selection.id, { limit: 100 });
    assert(
      selectedPage.items.length === 100,
      `${count}: selection returned ${selectedPage.items.length}`,
    );

    const listTiming = measure(() => {
      const result = store.queryOrders(context, {
        limit: 100,
        sort: { field: 'remoteCreatedAt', direction: 'desc' },
      });
      assert(result.items.length === 100, `${count}: list assertion failed`);
    });
    const filteredTiming = measure(() => {
      const result = store.queryOrders(context, {
        limit: 100,
        filter: { field: 'remoteStatus', operator: 'equals', value: 'processing' },
        sort: { field: 'remoteCreatedAt', direction: 'desc' },
      });
      assert(result.items.length === 100, `${count}: filtered assertion failed`);
    });
    const searchTiming = measure(() => {
      const result = store.queryOrders(context, { search: 'PERF-SHIRT', limit: 100 });
      assert(result.items.length > 0, `${count}: search assertion failed`);
    });
    const selectionTiming = measure(() => {
      const result = store.resolveSelection(context, selection.id, { limit: 100 });
      assert(result.items.length === 100, `${count}: selection assertion failed`);
    });
    const jobTiming = measure((index) => {
      const job = store.enqueueJob(context, {
        id: randomUUID(),
        type: 'performance-bulk',
        idempotencyKey: `${count}-${index}`,
        payload: { selectionId: selection.id, action: 'mark-export-ready' },
      });
      const claimed = store.claimNext(context);
      assert(claimed?.id === job.id, `${count}: job was not claimed in order`);
      store.complete(context, job.id);
    });
    const payloadBytes = Buffer.byteLength(
      JSON.stringify({ selectionId: selection.id, action: 'mark-export-ready' }),
    );
    assert(payloadBytes < 512 * 1024, `${count}: job payload exceeds 512 KiB`);
    const pageCount = Number(store.db.pragma('page_count', { simple: true }));
    const pageSize = Number(store.db.pragma('page_size', { simple: true }));
    const result = {
      orders: count,
      seedMs: fixture.seedMs,
      storageBytes: pageCount * pageSize,
      jobPayloadBytes: payloadBytes,
      list: listTiming,
      filteredList: filteredTiming,
      search: searchTiming,
      selection: selectionTiming,
      jobRoundTrip: jobTiming,
    };
    for (const [name, budget] of Object.entries(BUDGETS_MS)) {
      assert(
        result[name].p95Ms <= budget,
        `${count}: ${name} p95 ${result[name].p95Ms}ms exceeds ${budget}ms`,
      );
    }
    return result;
  } finally {
    store.db.close();
    rmSync(fixture.directory, { recursive: true, force: true });
  }
};

const assert = (condition, message) => {
  if (!condition) throw new Error(`PERFORMANCE_ASSERTION_FAILED: ${message}`);
};

const startedAt = new Date().toISOString();
const datasets = DATASETS.map(runDataset);
const report = {
  startedAt,
  node: process.version,
  platform: process.platform,
  iterations: ITERATIONS,
  budgetsMs: BUDGETS_MS,
  datasets,
};
const artifactDirectory = resolve('artifacts', 'performance');
mkdirSync(artifactDirectory, { recursive: true });
writeFileSync(resolve(artifactDirectory, 'T0803.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
