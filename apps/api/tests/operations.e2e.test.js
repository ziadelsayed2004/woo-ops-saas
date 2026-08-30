import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

const directory = mkdtempSync(join(tmpdir(), 'woo-operations-e2e-'));
const databasePath = join(directory, 'operations.sqlite');
const port = await new Promise((resolve, reject) => {
  const server = createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (!address || typeof address === 'string') return reject(new Error('E2E_PORT_UNAVAILABLE'));
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
    WOO_OPS_JOB_POLL_MS: '60000',
    SESSION_SECRET: 'operations-e2e-session-secret',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let childOutput = '';
child.stdout.on('data', (chunk) => (childOutput += chunk.toString()));
child.stderr.on('data', (chunk) => (childOutput += chunk.toString()));
const stopChild = async () => {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (child.exitCode === null && process.platform === 'win32' && child.pid)
      await new Promise((resolve) =>
        execFile(
          'taskkill',
          ['/PID', String(child.pid), '/T', '/F'],
          { windowsHide: true },
          resolve,
        ),
      );
  }
  child.stdout.destroy();
  child.stderr.destroy();
};
const waitForHealth = async () => {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${baseUrl}/health`)).ok) return;
    } catch {
      // API is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`E2E_API_START_TIMEOUT ${childOutput.slice(-500)}`);
};
const cookiesFrom = (response) =>
  (typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie') ?? '']
  ).join('; ');
const cookieValue = (cookies, name) => cookies.match(new RegExp(`${name}=([^;]+)`))?.[1] ?? '';
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
      email: `operations-${randomUUID()}@example.test`,
      password: 'correct horse battery staple',
      accountName: 'Operations E2E',
    }),
  });
  assert.equal(register.response.status, 201);
  const cookies = cookiesFrom(register.response);
  const csrf = cookieValue(cookies, 'woo_ops_csrf');
  const headers = { cookie: cookies, 'x-csrf-token': csrf };
  const order = await request('/api/v1/manual-orders', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      currency: 'EGP',
      lines: [{ name: 'Operations item', quantity: 1, unitPriceMinor: '100' }],
    }),
  });
  assert.equal(order.response.status, 201);
  const selection = await request('/api/v1/selections', {
    method: 'POST',
    headers,
    body: JSON.stringify({ mode: 'explicit', orderIds: [order.body.order.id] }),
  });
  assert.equal(selection.response.status, 201);
  const bulk = await request('/api/v1/bulk-jobs', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      selectionId: selection.body.selection.id,
      action: 'update-local-status',
      parameters: { status: 'queued-for-pickup' },
      idempotencyKey: randomUUID(),
    }),
  });
  assert.equal(bulk.response.status, 202);

  const health = await request('/api/v1/operations/health', { headers: { cookie: cookies } });
  assert.equal(health.response.status, 200);
  assert.equal(health.body.health.queue.queued, 1);
  assert.equal(health.body.runner.registeredTypes.includes('bulk.process'), true);
  const jobs = await request('/api/v1/operations/jobs?limit=10', {
    headers: { cookie: cookies },
  });
  assert.equal(jobs.response.status, 200);
  assert.equal(jobs.body.items.length, 1);
  assert.equal(Object.hasOwn(jobs.body.items[0], 'payload'), false);
  assert.equal(Object.hasOwn(jobs.body.items[0], 'payloadJson'), false);
  const jobId = jobs.body.items[0].id;
  const csrfRejected = await request(`/api/v1/operations/jobs/${jobId}/cancel`, {
    method: 'POST',
    headers: { cookie: cookies },
  });
  assert.equal(csrfRejected.response.status, 403);
  const cancelled = await request(`/api/v1/operations/jobs/${jobId}/cancel`, {
    method: 'POST',
    headers,
  });
  assert.equal(cancelled.response.status, 200);
  assert.equal(cancelled.body.job.status, 'failed');
  const usage = await request('/api/v1/operations/usage', { headers: { cookie: cookies } });
  assert.equal(usage.response.status, 200);
  assert.equal(Object.hasOwn(usage.body.usage, 'payload'), false);
} finally {
  await stopChild();
  rmSync(directory, { recursive: true, force: true });
}
