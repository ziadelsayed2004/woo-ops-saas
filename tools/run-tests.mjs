import { spawnSync } from 'node:child_process';

const kind = process.argv[2];
const result = spawnSync('pnpm', ['-r', '--if-present', `test:${kind}`], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
process.exit(result.status ?? 1);
