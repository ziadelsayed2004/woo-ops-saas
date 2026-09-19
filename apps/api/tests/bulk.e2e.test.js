import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { SqliteDatabase as Database } from '@woo-ops/persistence';

const directory = mkdtempSync(join(tmpdir(), 'woo-api-bulk-e2e-'));
const databasePath = join(directory, 'e2e.sqlite');
const port = await new Promise((resolve, reject) => {
  const server = createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (!address || typeof address === 'string') {
      reject(new Error('E2E_PORT_UNAVAILABLE'));
      return;
    }
    server.close(() => resolve(address.port));
  });
});
const baseUrl = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['dist/index.js'], {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  env: {
    ...process.env,
    PORT: String(port),
    WEB_PUBLIC_URL: baseUrl,
    WOO_OPS_DATA_DIR: directory,
    WOO_OPS_DATABASE: databasePath,
    SESSION_SECRET: 'e2e-session-secret',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let childOutput = '';
child.stdout.on('data', (chunk) => {
  childOutput += chunk.toString();
});
child.stderr.on('data', (chunk) => {
  childOutput += chunk.toString();
});
const waitForChildExit = (timeoutMs) =>
  new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve(true);
      return;
    }
    const timer = setTimeout(() => {
      child.removeListener('exit', onExit);
      resolve(false);
    }, timeoutMs);
    timer.unref();
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once('exit', onExit);
  });
const forceKillTree = () =>
  new Promise((resolve) => {
    if (process.platform !== 'win32' || child.pid === undefined) {
      resolve();
      return;
    }
    execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () =>
      resolve(),
    );
  });
const stopChild = async () => {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
    if (!(await waitForChildExit(500)) && child.exitCode === null) {
      child.kill('SIGKILL');
      if (!(await waitForChildExit(500)) && child.exitCode === null) {
        await forceKillTree();
        await waitForChildExit(1_000);
      }
    }
  }
  child.stdout.destroy();
  child.stderr.destroy();
};

const waitForHealth = async () => {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {
      // The API is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`E2E_API_START_TIMEOUT ${childOutput.slice(-500)}`);
};
const cookiesFrom = (response) => {
  const values =
    typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie') ?? ''];
  return values.join('; ');
};
const cookieValue = (cookies, name) => {
  const match = cookies.match(new RegExp(`${name}=([^;]+)`));
  return match?.[1] ?? '';
};
const request = async (path, options = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
  });
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : null };
};

try {
  await waitForHealth();
  const register = await request('/api/v1/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      email: `e2e-${randomUUID()}@example.test`,
      password: 'correct horse battery staple',
      accountName: 'Bulk E2E',
    }),
  });
  assert.equal(register.response.status, 201);
  const cookies = cookiesFrom(register.response);
  const sessionCookie = cookieValue(cookies, 'woo_ops_session');
  const csrfToken = cookieValue(cookies, 'woo_ops_csrf');
  assert.ok(sessionCookie);
  assert.ok(csrfToken);
  const accountId = register.body.user.accountId;
  const connectionId = randomUUID();
  const orderId = `${accountId}:${connectionId}:order:1`;
  const timestamp = new Date().toISOString();
  const database = new Database(databasePath);
  try {
    database
      .prepare(
        'INSERT INTO connections (id, account_id, platform, store_url, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        connectionId,
        accountId,
        'woocommerce',
        'https://e2e-shop.test',
        'active',
        timestamp,
        timestamp,
      );
    database
      .prepare(
        'INSERT INTO orders (id, account_id, connection_id, origin, order_number, external_order_id, remote_status, currency, grand_total_minor, source_hash, remote_modified_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        orderId,
        accountId,
        connectionId,
        'woo',
        'E2E-1',
        '1',
        'processing',
        'EGP',
        '12500',
        'e2e-hash',
        timestamp,
        timestamp,
        timestamp,
      );
  } finally {
    database.close();
  }

  const authHeaders = {
    cookie: `woo_ops_session=${sessionCookie}; woo_ops_csrf=${csrfToken}`,
    'x-csrf-token': csrfToken,
  };
  const selection = await request('/api/v1/selections', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ mode: 'explicit', orderIds: [orderId] }),
  });
  assert.equal(selection.response.status, 201);
  assert.equal(selection.body.selection.estimatedCount, 1);
  const preview = await request('/api/v1/bulk-jobs/preview', {
    method: 'POST',
    headers: { cookie: authHeaders.cookie },
    body: JSON.stringify({
      selectionId: selection.body.selection.id,
      action: 'mark-export-ready',
    }),
  });
  assert.equal(preview.response.status, 200);
  assert.equal(preview.body.preview.currentCount, 1);
  const bulkInput = {
    selectionId: selection.body.selection.id,
    action: 'mark-export-ready',
    idempotencyKey: 'e2e-bulk-1',
  };
  const firstJob = await request('/api/v1/bulk-jobs', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify(bulkInput),
  });
  assert.equal(firstJob.response.status, 202);
  const duplicateJob = await request('/api/v1/bulk-jobs', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify(bulkInput),
  });
  assert.equal(duplicateJob.response.status, 202);
  assert.equal(duplicateJob.body.job.id, firstJob.body.job.id);
  const fetchedJob = await request(`/api/v1/bulk-jobs/${firstJob.body.job.id}`, {
    headers: { cookie: authHeaders.cookie },
  });
  assert.equal(fetchedJob.response.status, 200);
  assert.equal(fetchedJob.body.job.accountId, accountId);
  const listedJobs = await request('/api/v1/bulk-jobs?status=queued&limit=10', {
    headers: { cookie: authHeaders.cookie },
  });
  assert.equal(listedJobs.response.status, 200);
  assert.equal(listedJobs.body.items[0].id, firstJob.body.job.id);
  const forbidden = await request('/api/v1/bulk-jobs', {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({ ...bulkInput, action: 'remote-update-order', idempotencyKey: 'bad' }),
  });
  assert.equal(forbidden.response.status, 400);
} finally {
  await stopChild();
  rmSync(directory, { recursive: true, force: true });
}
