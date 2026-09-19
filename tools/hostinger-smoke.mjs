import { execFile, spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const rootPackage = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const lockfile = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
const nativeAddonPaths = Object.keys(lockfile.packages ?? {}).filter((path) =>
  path.endsWith('node_modules/better-sqlite3'),
);
if (rootPackage.engines?.node !== '>=22.18 <23')
  throw new Error('HOSTINGER_NODE_ENGINE_NOT_PINNED');
if (nativeAddonPaths.length > 0) throw new Error('HOSTINGER_NATIVE_SQLITE_DEPENDENCY_PRESENT');

const runNode = (args, env) => {
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`HOSTINGER_SMOKE_COMMAND_FAILED ${args.join(' ')}\n${result.stderr}`);
  return result.stdout.trim();
};

const freePort = () =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('HOSTINGER_SMOKE_PORT_UNAVAILABLE'));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });

const stop = async (child) => {
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

const dataDirectory = mkdtempSync(join(tmpdir(), 'woo-hostinger-smoke-'));
const databasePath = join(dataDirectory, 'woo-ops.sqlite');
const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['apps/api/dist/index.js'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(port),
    WOO_OPS_DATA_DIR: dataDirectory,
    WOO_OPS_DATABASE: databasePath,
    WEB_PUBLIC_URL: baseUrl,
    API_PUBLIC_URL: baseUrl,
    SESSION_SECRET: 'hostinger-smoke-session-secret-with-enough-entropy',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', (chunk) => (output += chunk.toString()));
child.stderr.on('data', (chunk) => (output += chunk.toString()));

try {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) break;
    } catch {
      // The production start command is still booting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const health = await fetch(`${baseUrl}/health`);
  if (!health.ok) throw new Error(`HOSTINGER_SMOKE_HEALTH_FAILED ${health.status} ${output}`);
  const healthBody = await health.json();
  if (healthBody.status !== 'ok' || healthBody.database !== 'connected')
    throw new Error(`HOSTINGER_SMOKE_HEALTH_INVALID ${JSON.stringify(healthBody)}`);
  const setupBefore = await fetch(`${baseUrl}/api/v1/auth/setup`).then((response) =>
    response.json(),
  );
  if (setupBefore.registrationOpen !== true) throw new Error('HOSTINGER_OWNER_SETUP_NOT_AVAILABLE');
  const owner = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'owner@example.test',
      password: 'test-owner-password-strong',
      accountName: 'Smoke Store',
    }),
  });
  if (owner.status !== 201) throw new Error(`HOSTINGER_OWNER_SETUP_FAILED ${owner.status}`);
  const setupAfter = await fetch(`${baseUrl}/api/v1/auth/setup`).then((response) =>
    response.json(),
  );
  if (setupAfter.registrationOpen !== false) throw new Error('HOSTINGER_OWNER_SETUP_STILL_OPEN');
  const secondOwner = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: 'second@example.test',
      password: 'test-owner-password-strong',
      accountName: 'Second Store',
    }),
  });
  if (secondOwner.status !== 409)
    throw new Error(`HOSTINGER_SECOND_OWNER_ALLOWED ${secondOwner.status}`);
  const homepage = await fetch(`${baseUrl}/`);
  const homepageContentType = homepage.headers.get('content-type') ?? '';
  if (!homepage.ok || !homepageContentType.includes('text/html'))
    throw new Error(`HOSTINGER_SMOKE_WEB_FAILED ${homepage.status} ${homepageContentType}`);
  const contentSecurityPolicy = homepage.headers.get('content-security-policy') ?? '';
  if (!contentSecurityPolicy.includes("style-src 'self' 'unsafe-inline'"))
    throw new Error('HOSTINGER_MATERIAL_UI_STYLES_BLOCKED');
  await stop(child);

  const commandEnv = {
    WOO_OPS_DATA_DIR: dataDirectory,
    WOO_OPS_DATABASE: databasePath,
    NODE_ENV: 'production',
    SESSION_SECRET: 'hostinger-smoke-session-secret-with-enough-entropy',
  };
  const backupOutput = runNode(['apps/api/dist/db-cli.js', 'backup'], commandEnv);
  const backup = JSON.parse(backupOutput);
  if (typeof backup.id !== 'string' || !backup.id.startsWith('backup-'))
    throw new Error(`HOSTINGER_SMOKE_BACKUP_INVALID ${backupOutput}`);
  const list = JSON.parse(runNode(['apps/api/dist/db-cli.js', 'list'], commandEnv));
  if (!Array.isArray(list) || list.length !== 1 || list[0].id !== backup.id)
    throw new Error(`HOSTINGER_SMOKE_BACKUP_LIST_INVALID ${JSON.stringify(list)}`);
  const restore = JSON.parse(
    runNode(['apps/api/dist/db-cli.js', 'restore', backup.id], commandEnv),
  );
  if (restore.dryRun !== true || restore.restored !== false)
    throw new Error(`HOSTINGER_SMOKE_RESTORE_INVALID ${JSON.stringify(restore)}`);

  const deploymentRoot = mkdtempSync(join(tmpdir(), 'woo-hostinger-redeploy-'));
  const domainRoot = join(deploymentRoot, 'domains', 'ops.example.test');
  const releaseA = join(domainRoot, 'hbuilds', 'release-a', 'source', 'repository');
  const releaseB = join(domainRoot, 'hbuilds', 'release-b', 'source', 'repository');
  mkdirSync(releaseA, { recursive: true });
  mkdirSync(releaseB, { recursive: true });
  const apiEntry = resolve(process.cwd(), 'apps/api/dist/index.js');
  const persistentOwner = {
    email: 'persistent-owner@example.test',
    password: 'persistent-owner-password-strong',
    accountName: 'Persistent Store',
  };
  const startRelease = async (cwd) => {
    const releasePort = await freePort();
    const releaseUrl = `http://127.0.0.1:${releasePort}`;
    const release = spawn(process.execPath, [apiEntry], {
      cwd,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: String(releasePort),
        WEB_PUBLIC_URL: releaseUrl,
        API_PUBLIC_URL: releaseUrl,
        SESSION_SECRET: 'hostinger-redeploy-session-secret-with-enough-entropy',
        WOO_OPS_DATA_DIR: '',
        WOO_OPS_DATABASE: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let releaseOutput = '';
    release.stdout.on('data', (chunk) => (releaseOutput += chunk.toString()));
    release.stderr.on('data', (chunk) => (releaseOutput += chunk.toString()));
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`${releaseUrl}/health`);
        if (response.ok) return { release, releaseUrl, health: await response.json() };
      } catch {
        // The simulated release is still booting.
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    }
    await stop(release);
    throw new Error(`HOSTINGER_REDEPLOY_START_FAILED ${releaseOutput.slice(-500)}`);
  };

  let firstRelease;
  let secondRelease;
  try {
    firstRelease = await startRelease(releaseA);
    if (
      firstRelease.health.persistence?.mode !== 'hostinger-domain' ||
      firstRelease.health.persistence?.durable !== true
    )
      throw new Error(`HOSTINGER_PERSISTENCE_MODE_INVALID ${JSON.stringify(firstRelease.health)}`);
    const register = await fetch(`${firstRelease.releaseUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(persistentOwner),
    });
    if (register.status !== 201)
      throw new Error(`HOSTINGER_REDEPLOY_OWNER_SETUP_FAILED ${register.status}`);
    await stop(firstRelease.release);
    firstRelease = undefined;

    secondRelease = await startRelease(releaseB);
    const setup = await fetch(`${secondRelease.releaseUrl}/api/v1/auth/setup`).then((response) =>
      response.json(),
    );
    if (setup.registrationOpen !== false)
      throw new Error('HOSTINGER_REDEPLOY_DATABASE_WAS_REPLACED');
    const login = await fetch(`${secondRelease.releaseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: persistentOwner.email,
        password: persistentOwner.password,
      }),
    });
    if (login.status !== 200) throw new Error(`HOSTINGER_REDEPLOY_LOGIN_FAILED ${login.status}`);
  } finally {
    if (firstRelease) await stop(firstRelease.release);
    if (secondRelease) await stop(secondRelease.release);
    rmSync(deploymentRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
  console.log(
    JSON.stringify({
      status: 'passed',
      startCommand: 'node apps/api/dist/index.js',
      health: healthBody,
      backupId: backup.id,
      restoreDryRun: restore,
      redeployIdentityPersistence: true,
    }),
  );
} finally {
  if (child.exitCode === null && child.signalCode === null) await stop(child);
  rmSync(dataDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
