#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { npmArgs, npmCommand } from './npm-command.mjs';

const [script, ...argumentsList] = process.argv.slice(2);
if (!script) {
  console.error('Usage: node tools/run-api-script.mjs <script> [args...]');
  process.exit(1);
}
const result = spawnSync(npmCommand, npmArgs(['run', script, '--', ...argumentsList]), {
  cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'api'),
  stdio: 'inherit',
  shell: false,
  env: process.env,
});
process.exit(result.status ?? 1);
