import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const directory = mkdtempSync(join(tmpdir(), 'woo-api-analytics-e2e-'));
const databasePath = join(directory, 'analytics.sqlite');
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
    SESSION_SECRET: 'analytics-e2e-session-secret',
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
const waitForJob = async (jobId, headers) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await request(`/api/v1/operations/jobs/${encodeURIComponent(jobId)}`, { headers });
    if (result.body?.job?.status === 'succeeded') return result.body.job;
    if (['failed', 'dead-lettered'].includes(result.body?.job?.status))
      throw new Error(`ANALYTICS_JOB_FAILED ${JSON.stringify(result.body.job)}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('ANALYTICS_JOB_TIMEOUT');
};

try {
  await waitForHealth();
  const register = await request('/api/v1/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      email: `analytics-${randomUUID()}@example.test`,
      password: 'correct horse battery staple',
      accountName: 'Analytics E2E',
    }),
  });
  assert.equal(register.response.status, 201);
  const cookies = cookiesFrom(register.response);
  const csrf = cookieValue(cookies, 'woo_ops_csrf');
  const headers = { cookie: cookies, 'x-csrf-token': csrf };
  const rule = await request('/api/v1/cost-rules', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      scope: 'product',
      key: 'p1',
      currency: 'EGP',
      amountMinor: '700',
      source: 'supplier',
      effectiveFrom: '2026-01-01T00:00:00.000Z',
    }),
  });
  assert.equal(rule.response.status, 201);
  const order = await request('/api/v1/manual-orders', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      currency: 'EGP',
      lines: [{ productId: 'p1', name: 'Analytics product', quantity: 1, unitPriceMinor: '1500' }],
    }),
  });
  assert.equal(order.response.status, 201);
  const rebuild = await request('/api/v1/analytics/rebuilds', {
    method: 'POST',
    headers,
    body: JSON.stringify({ source: 'manual' }),
  });
  assert.equal(rebuild.response.status, 202);
  assert.equal(rebuild.body.job.type, 'analytics.rebuild');
  const completedJob = await waitForJob(rebuild.body.job.id, { cookie: cookies });
  assert.equal(completedJob.progress, 100);
  const summary = await request('/api/v1/analytics/summary', {
    method: 'POST',
    headers: { cookie: cookies },
    body: JSON.stringify({ source: 'manual' }),
  });
  assert.equal(summary.response.status, 200);
  assert.equal(summary.body.summary.currencies[0].currency, 'EGP');
  assert.equal(summary.body.summary.currencies[0].totals.cogsMinor, '700');
  assert.equal(summary.body.summary.definitions.length, 12);
  const unauthenticated = await request('/api/v1/analytics/summary', {
    method: 'POST',
    body: JSON.stringify({}),
  });
  assert.equal(unauthenticated.response.status, 401);
} finally {
  await stopChild();
  rmSync(directory, { recursive: true, force: true });
}
