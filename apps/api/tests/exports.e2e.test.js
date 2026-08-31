import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

const directory = mkdtempSync(join(tmpdir(), 'woo-exports-e2e-'));
const databasePath = join(directory, 'exports.sqlite');
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
    NODE_ENV: 'test',
    PORT: String(port),
    WEB_PUBLIC_URL: baseUrl,
    WOO_OPS_DATA_DIR: directory,
    WOO_OPS_DATABASE: databasePath,
    WOO_OPS_JOB_POLL_MS: '10',
    SESSION_SECRET: 'exports-e2e-session-secret-with-enough-entropy',
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
      // The API is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`EXPORT_E2E_API_START_TIMEOUT ${childOutput.slice(-500)}`);
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
  const contentType = response.headers.get('content-type') ?? '';
  const body = contentType.includes('application/json')
    ? await response.json()
    : await response.arrayBuffer();
  return { response, body };
};

try {
  await waitForHealth();
  const register = await request('/api/v1/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      email: `exports-${randomUUID()}@example.test`,
      password: 'correct horse battery staple',
      accountName: 'Exports E2E',
    }),
  });
  assert.equal(register.response.status, 201);
  const cookies = cookiesFrom(register.response);
  const csrf = cookieValue(cookies, 'woo_ops_csrf');
  const readHeaders = { cookie: cookies };
  const writeHeaders = { cookie: cookies, 'x-csrf-token': csrf };
  const order = await request('/api/v1/manual-orders', {
    method: 'POST',
    headers: writeHeaders,
    body: JSON.stringify({
      currency: 'EGP',
      customer: { name: 'Export API customer' },
      billing: { phone: '01001234567' },
      lines: [{ name: 'Export API item', quantity: 1, unitPriceMinor: '2500' }],
    }),
  });
  assert.equal(order.response.status, 201);
  const selection = await request('/api/v1/selections', {
    method: 'POST',
    headers: writeHeaders,
    body: JSON.stringify({ mode: 'explicit', orderIds: [order.body.order.id] }),
  });
  assert.equal(selection.response.status, 201);
  const profile = await request('/api/v1/export-profiles', {
    method: 'POST',
    headers: writeHeaders,
    body: JSON.stringify({ name: 'API courier' }),
  });
  assert.equal(profile.response.status, 201);
  const updatedProfile = await request(`/api/v1/export-profiles/${profile.body.profile.id}`, {
    method: 'PATCH',
    headers: writeHeaders,
    body: JSON.stringify({ description: 'Bounded shipping export' }),
  });
  assert.equal(updatedProfile.response.status, 200);
  const version = await request(`/api/v1/export-profiles/${profile.body.profile.id}/versions`, {
    method: 'POST',
    headers: writeHeaders,
    body: JSON.stringify({
      format: 'csv',
      rowMode: 'order',
      columns: [
        { key: 'orderNumber', label: 'Order', type: 'text' },
        { key: 'customerPhone', label: 'Phone', type: 'text' },
      ],
      filenameTemplate: 'api-courier-{format}',
      config: { required: ['orderNumber'] },
    }),
  });
  assert.equal(version.response.status, 201);
  const versions = await request(`/api/v1/export-profiles/${profile.body.profile.id}/versions`, {
    headers: readHeaders,
  });
  assert.equal(versions.response.status, 200);
  assert.equal(versions.body.items.length, 1);
  const preview = await request(`/api/v1/export-profiles/${profile.body.profile.id}/preview`, {
    method: 'POST',
    headers: readHeaders,
    body: JSON.stringify({
      selectionId: selection.body.selection.id,
      profileVersionId: version.body.version.id,
    }),
  });
  assert.equal(preview.response.status, 200, JSON.stringify(preview.body));
  assert.equal(preview.body.preview.rowCount, 1);
  const created = await request('/api/v1/export-batches', {
    method: 'POST',
    headers: writeHeaders,
    body: JSON.stringify({
      selectionId: selection.body.selection.id,
      profileVersionId: version.body.version.id,
      idempotencyKey: 'api-export-1',
    }),
  });
  assert.equal(created.response.status, 202);
  assert.equal(created.body.batch.status, 'queued');
  assert.equal(created.body.job.type, 'export.generate');
  let completed;
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const current = await request(`/api/v1/export-batches/${created.body.batch.id}`, {
      headers: readHeaders,
    });
    assert.equal(current.response.status, 200);
    if (current.body.batch.status === 'completed' || current.body.batch.status === 'failed') {
      completed = current.body;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(completed?.batch.status, 'completed', JSON.stringify(completed));
  const download = await request(`/api/v1/export-batches/${created.body.batch.id}/download`, {
    headers: readHeaders,
  });
  assert.equal(download.response.status, 200);
  assert.match(download.response.headers.get('x-export-checksum') ?? '', /^[a-f0-9]{64}$/);
  assert.match(Buffer.from(download.body).toString('utf8'), /Order,Phone/);
  const exported = await request('/api/v1/orders/query', {
    method: 'POST',
    headers: readHeaders,
    body: JSON.stringify({
      filter: { field: 'exportState', operator: 'equals', value: 'exported' },
    }),
  });
  assert.equal(exported.response.status, 200);
  assert.equal(
    exported.body.items.some((item) => item.id === order.body.order.id),
    true,
  );

  const otherRegister = await request('/api/v1/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      email: `exports-other-${randomUUID()}@example.test`,
      password: 'correct horse battery staple',
      accountName: 'Other export account',
    }),
  });
  const otherDownload = await request(`/api/v1/export-batches/${created.body.batch.id}/download`, {
    headers: { cookie: cookiesFrom(otherRegister.response) },
  });
  assert.equal(otherDownload.response.status, 404);
} finally {
  await stopChild();
  rmSync(directory, { recursive: true, force: true });
}
