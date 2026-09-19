#!/usr/bin/env node

import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const entry = join(root, 'apps/api/dist/index.js');
const webDist = join(root, 'apps/web/dist');
if (!existsSync(entry) || !existsSync(join(webDist, 'index.html')))
  throw new Error('Build first with npm run build');

const freePort = () =>
  new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('No demo port'));
      server.close(() => resolvePort(address.port));
    });
  });

const directory = mkdtempSync(join(tmpdir(), 'woo-ops-local-demo-'));
const port = await freePort();
const url = `http://127.0.0.1:${port}`;
const email = 'demo@local.test';
const password = randomBytes(24).toString('base64url');
const child = spawn(process.execPath, [entry], {
  cwd: root,
  env: {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(port),
    WOO_OPS_BIND_HOST: '127.0.0.1',
    WOO_OPS_DATA_DIR: directory,
    WOO_OPS_DATABASE: join(directory, 'demo.sqlite'),
    WOO_OPS_WEB_DIST_DIR: webDist,
    WEB_PUBLIC_URL: url,
    API_PUBLIC_URL: url,
    SESSION_SECRET: randomBytes(48).toString('base64url'),
    TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let closed = false;
const close = () => {
  if (closed) return;
  closed = true;
  child.kill('SIGTERM');
};
process.once('SIGINT', close);
process.once('SIGTERM', close);
child.once('exit', () => {
  rmSync(directory, { recursive: true, force: true });
  process.exitCode = closed ? 0 : 1;
});

try {
  let healthy = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error('Demo server exited during startup');
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) {
        healthy = true;
        break;
      }
    } catch {
      // Wait for the isolated server to become available.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  if (!healthy) throw new Error('Demo server did not start');
  const response = await fetch(`${url}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, accountName: 'Local Demo' }),
  });
  if (response.status !== 201) throw new Error(`Demo account setup failed (${response.status})`);
  process.stdout.write(
    `Local demo only — no WooCommerce connection or production data.\nURL: ${url}\nEmail: ${email}\nPassword: ${password}\nPress Ctrl+C to stop and delete the temporary demo database.\n`,
  );
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  close();
}
