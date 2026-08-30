import { execFile, spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
  const homepage = await fetch(`${baseUrl}/`);
  const homepageContentType = homepage.headers.get('content-type') ?? '';
  if (!homepage.ok || !homepageContentType.includes('text/html'))
    throw new Error(`HOSTINGER_SMOKE_WEB_FAILED ${homepage.status} ${homepageContentType}`);
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
  console.log(
    JSON.stringify({
      status: 'passed',
      startCommand: 'node apps/api/dist/index.js',
      health: healthBody,
      backupId: backup.id,
      restoreDryRun: restore,
    }),
  );
} finally {
  if (child.exitCode === null && child.signalCode === null) await stop(child);
  rmSync(dataDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
