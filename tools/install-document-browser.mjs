import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const playwrightPackage = require.resolve('playwright-core/package.json');
const cli = join(dirname(playwrightPackage), 'cli.js');
const result = spawnSync(process.execPath, [cli, 'install', 'chromium-headless-shell'], {
  cwd: process.cwd(),
  env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: '0' },
  stdio: 'inherit',
});

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
