import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

const freePort = () =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('ADMIN_E2E_PORT_UNAVAILABLE'));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });

const cookiesFrom = (response) =>
  (typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie') ?? '']
  ).join('; ');
const cookieValue = (cookies, name) => cookies.match(new RegExp(`${name}=([^;]+)`))?.[1] ?? '';

const stopApi = async (child) => {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (child.exitCode === null && child.pid !== undefined && process.platform === 'win32')
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

test('account administration API enforces CSRF, scopes invitations, and reports readiness', async () => {
  const dataDirectory = mkdtempSync(join(tmpdir(), 'woo-administration-e2e-'));
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const apiDirectory = fileURLToPath(new URL('..', import.meta.url));
  const child = spawn(process.execPath, ['dist/index.js'], {
    cwd: apiDirectory,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      WEB_PUBLIC_URL: baseUrl,
      WOO_OPS_DATA_DIR: dataDirectory,
      WOO_OPS_DATABASE: join(dataDirectory, 'woo-ops.sqlite'),
      SESSION_SECRET: 'administration-e2e-session-secret-with-enough-entropy',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk.toString()));
  child.stderr.on('data', (chunk) => (output += chunk.toString()));
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
    throw new Error(`ADMIN_E2E_API_START_TIMEOUT ${output.slice(-500)}`);
  };
  const request = async (path, options = {}) => {
    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
    });
    const contentType = response.headers.get('content-type') ?? '';
    return {
      response,
      body: contentType.includes('application/json') ? await response.json() : null,
    };
  };

  try {
    await waitForHealth();
    const ownerEmail = `owner-${Date.now()}@example.test`;
    const register = await request('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email: ownerEmail,
        password: 'correct horse battery staple',
        accountName: 'Administration E2E',
      }),
    });
    assert.equal(register.response.status, 201);
    const login = await request('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: ownerEmail, password: 'correct horse battery staple' }),
    });
    assert.equal(login.response.status, 200);
    const ownerCookies = cookiesFrom(login.response);
    const ownerSession = cookieValue(ownerCookies, 'woo_ops_session');
    const ownerCsrf = cookieValue(ownerCookies, 'woo_ops_csrf');
    const readHeaders = { cookie: ownerCookies };
    const writeHeaders = { cookie: ownerCookies, 'x-csrf-token': ownerCsrf };
    assert.ok(ownerSession);
    assert.ok(ownerCsrf);

    const account = await request('/api/v1/account', { headers: readHeaders });
    assert.equal(account.response.status, 200);
    assert.equal(account.body.account.direction, 'rtl');
    const missingCsrf = await request('/api/v1/account', {
      method: 'PATCH',
      headers: { cookie: ownerCookies },
      body: JSON.stringify({ name: 'Should fail' }),
    });
    assert.equal(missingCsrf.response.status, 403);
    const update = await request('/api/v1/account', {
      method: 'PATCH',
      headers: writeHeaders,
      body: JSON.stringify({ name: 'Updated Administration', direction: 'ltr' }),
    });
    assert.equal(update.response.status, 200);
    assert.equal(update.body.account.name, 'Updated Administration');

    const members = await request('/api/v1/members', { headers: readHeaders });
    assert.equal(members.response.status, 200);
    assert.equal(members.body.items.length, 1);
    const inviteeEmail = `invitee-${Date.now()}@example.test`;
    const invitation = await request('/api/v1/members/invitations', {
      method: 'POST',
      headers: writeHeaders,
      body: JSON.stringify({
        email: inviteeEmail,
        role: 'viewer',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      }),
    });
    assert.equal(invitation.response.status, 201);
    assert.match(invitation.body.invitation.acceptToken, /^[A-Za-z0-9_-]{43}$/u);
    const invitationList = await request('/api/v1/members/invitations', {
      headers: readHeaders,
    });
    assert.equal(invitationList.response.status, 200);
    assert.equal('acceptToken' in invitationList.body.items[0], false);

    const inviteeRegister = await request('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email: inviteeEmail,
        password: 'correct horse battery staple',
        accountName: 'Invitee E2E',
      }),
    });
    assert.equal(inviteeRegister.response.status, 201);
    const inviteeLogin = await request('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: inviteeEmail, password: 'correct horse battery staple' }),
    });
    const inviteeCookies = cookiesFrom(inviteeLogin.response);
    const inviteeCsrf = cookieValue(inviteeCookies, 'woo_ops_csrf');
    const accepted = await request(
      `/api/v1/members/invitations/${invitation.body.invitation.id}/accept`,
      {
        method: 'POST',
        headers: { cookie: inviteeCookies, 'x-csrf-token': inviteeCsrf },
        body: JSON.stringify({ token: invitation.body.invitation.acceptToken }),
      },
    );
    assert.equal(accepted.response.status, 200);
    assert.equal(accepted.body.member.email, inviteeEmail);

    const role = await request(`/api/v1/members/${inviteeRegister.body.user.id}`, {
      method: 'PATCH',
      headers: writeHeaders,
      body: JSON.stringify({ role: 'operator' }),
    });
    assert.equal(role.response.status, 200);
    assert.equal(role.body.member.role, 'operator');
    const sessions = await request('/api/v1/sessions', { headers: readHeaders });
    assert.equal(sessions.response.status, 200);
    assert.equal(sessions.body.items.length >= 1, true);
    const reset = await request('/api/v1/auth/password/reset/request', {
      method: 'POST',
      body: JSON.stringify({ email: `unknown-${Date.now()}@example.test` }),
    });
    assert.equal(reset.response.status, 202);
    assert.deepEqual(reset.body, { accepted: true });
    const resetWithoutCsrf = await request('/api/v1/account/reset', {
      method: 'POST',
      headers: { cookie: ownerCookies },
      body: JSON.stringify({
        confirmation: 'RESET',
        preserveConnections: true,
        currentPassword: 'correct horse battery staple',
      }),
    });
    assert.equal(resetWithoutCsrf.response.status, 403);
    const invalidReset = await request('/api/v1/account/reset', {
      method: 'POST',
      headers: writeHeaders,
      body: JSON.stringify({
        confirmation: 'reset',
        preserveConnections: true,
        currentPassword: 'correct horse battery staple',
      }),
    });
    assert.equal(invalidReset.response.status, 400);
    const wrongPasswordReset = await request('/api/v1/account/reset', {
      method: 'POST',
      headers: writeHeaders,
      body: JSON.stringify({
        confirmation: 'RESET',
        preserveConnections: true,
        currentPassword: 'not the current password',
      }),
    });
    assert.equal(wrongPasswordReset.response.status, 400);
    const accountReset = await request('/api/v1/account/reset', {
      method: 'POST',
      headers: writeHeaders,
      body: JSON.stringify({
        confirmation: 'RESET',
        preserveConnections: true,
        currentPassword: 'correct horse battery staple',
      }),
    });
    assert.equal(accountReset.response.status, 200);
    assert.equal(accountReset.body.reset, true);
    const accountAfterReset = await request('/api/v1/account', { headers: readHeaders });
    assert.equal(accountAfterReset.response.status, 200);
    assert.equal(accountAfterReset.body.account.name, 'Updated Administration');
    const ready = await request('/ready');
    assert.equal(ready.response.status, 200);
    assert.equal(ready.body.status, 'ok');
    assert.equal(ready.response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(ready.response.headers.get('x-frame-options'), 'DENY');
    assert.equal(ready.response.headers.get('cache-control'), null);
  } finally {
    await stopApi(child);
    rmSync(dataDirectory, { recursive: true, force: true });
  }
});
