import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

const directory = mkdtempSync(join(tmpdir(), 'woo-api-documents-e2e-'));
const databasePath = join(directory, 'documents.sqlite');
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
    SESSION_SECRET: 'documents-e2e-session-secret',
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
      email: `documents-${randomUUID()}@example.test`,
      password: 'correct horse battery staple',
      accountName: 'Documents E2E',
    }),
  });
  assert.equal(register.response.status, 201);
  const cookies = cookiesFrom(register.response);
  const csrf = cookieValue(cookies, 'woo_ops_csrf');
  const headers = { cookie: `${cookies}`, 'x-csrf-token': csrf };
  const template = await request('/api/v1/document-templates', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: 'E2E invoice',
      format: 'a4',
      locale: 'en-US',
      direction: 'ltr',
      body: 'Order {{order.number}}',
      companyName: 'Woo Ops',
    }),
  });
  assert.equal(template.response.status, 201);
  const templateId = template.body.template.id;
  const unsafe = await request('/api/v1/document-templates', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: 'Unsafe',
      format: 'a4',
      locale: 'en-US',
      direction: 'ltr',
      body: '<script>fetch("https://evil.test")</script>',
      companyName: 'Woo Ops',
    }),
  });
  assert.equal(unsafe.response.status, 400);
  const preview = await request(`/api/v1/document-templates/${templateId}/preview`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ order: { orderNumber: 'PREVIEW-1', grandTotalMinor: '1000' } }),
  });
  assert.equal(preview.response.status, 200);
  assert.equal(preview.response.headers.get('content-type'), 'application/pdf');
  assert.match(preview.response.headers.get('x-document-checksum') ?? '', /^[a-f0-9]{64}$/);
  const order = await request('/api/v1/manual-orders', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      currency: 'EGP',
      lines: [{ name: 'PDF product', quantity: 1, unitPriceMinor: '1000' }],
    }),
  });
  assert.equal(order.response.status, 201);
  const generated = await request(
    `/api/v1/document-templates/${templateId}/orders/${order.body.order.id}`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({}),
    },
  );
  assert.equal(generated.response.status, 201);
  const fileId = generated.body.file.id;
  const download = await request(`/api/v1/document-files/${fileId}`, {
    headers: { cookie: cookies },
  });
  assert.equal(download.response.status, 200);
  assert.equal(download.response.headers.get('content-type'), 'application/pdf');
  assert.ok(download.body.byteLength > 100);
  const selection = await request('/api/v1/selections', {
    method: 'POST',
    headers,
    body: JSON.stringify({ mode: 'explicit', orderIds: [order.body.order.id] }),
  });
  assert.equal(selection.response.status, 201, JSON.stringify(selection.body));
  const batchResponse = await request('/api/v1/document-jobs', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      selectionId: selection.body.selection.id,
      action: 'print-documents',
      templateId,
      idempotencyKey: `document-e2e-${randomUUID()}`,
    }),
  });
  assert.equal(batchResponse.response.status, 202, JSON.stringify(batchResponse.body));
  const batchId = batchResponse.body.batch.id;
  let batchDetails;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    batchDetails = await request(`/api/v1/document-jobs/${batchId}`, {
      headers: { cookie: cookies },
    });
    if (['completed', 'partial', 'failed'].includes(batchDetails.body.batch.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(batchDetails.body.batch.status, 'completed', JSON.stringify(batchDetails.body));
  assert.equal(batchDetails.body.items.length, 1);
  assert.equal(batchDetails.body.artifacts.length, 4);
  const zipArtifact = batchDetails.body.artifacts.find((artifact) => artifact.kind === 'zip');
  assert.ok(zipArtifact);
  const zipDownload = await request(`/api/v1/document-artifacts/${zipArtifact.id}?download=1`, {
    headers: { cookie: cookies },
  });
  assert.equal(zipDownload.response.status, 200);
  assert.equal(zipDownload.response.headers.get('content-type'), 'application/zip');
  assert.equal(
    zipDownload.response.headers.get('content-disposition')?.startsWith('attachment;'),
    true,
  );
  assert.deepEqual(
    Buffer.from(zipDownload.body).subarray(0, 4),
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  );
  const failures = await request(`/api/v1/document-jobs/${batchId}/errors`, {
    headers: { cookie: cookies },
  });
  assert.equal(failures.response.status, 200);
  assert.equal(failures.body.items.length, 0);
  const unauthenticated = await request(`/api/v1/document-files/${fileId}`);
  assert.equal(unauthenticated.response.status, 401);
  const other = await request('/api/v1/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      email: `other-documents-${randomUUID()}@example.test`,
      password: 'correct horse battery staple',
      accountName: 'Other Documents',
    }),
  });
  assert.equal(other.response.status, 201);
  const otherCookies = cookiesFrom(other.response);
  const otherDownload = await request(`/api/v1/document-files/${fileId}`, {
    headers: { cookie: otherCookies },
  });
  assert.equal(otherDownload.response.status, 404);
  const otherArtifactDownload = await request(`/api/v1/document-artifacts/${zipArtifact.id}`, {
    headers: { cookie: otherCookies },
  });
  assert.equal(otherArtifactDownload.response.status, 404);
} finally {
  await stopChild();
  rmSync(directory, { recursive: true, force: true });
}
