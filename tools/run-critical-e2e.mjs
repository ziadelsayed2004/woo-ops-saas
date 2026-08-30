import { spawnSync } from 'node:child_process';

const packageManager = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const spawnOptions = { stdio: 'inherit', shell: process.platform === 'win32' };

const run = (command, args, shell = command === packageManager) => {
  console.log(`\n[critical-e2e] ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { ...spawnOptions, shell });
  if (result.error) {
    console.error(`[critical-e2e] ${result.error.message}`);
    return result.status ?? 1;
  }
  return result.status ?? 1;
};

const buildStatus = run(packageManager, ['-r', 'build']);
if (buildStatus !== 0) process.exit(buildStatus);

const apiRegressionStatus = run(packageManager, ['--filter', '@woo-ops/api', 'test:e2e']);
if (apiRegressionStatus !== 0) process.exit(apiRegressionStatus);

const repeats = Number(process.env.CRITICAL_E2E_REPEATS ?? 2);
if (!Number.isSafeInteger(repeats) || repeats < 1 || repeats > 5) {
  console.error('CRITICAL_E2E_REPEATS must be an integer between 1 and 5.');
  process.exit(1);
}
for (let runNumber = 1; runNumber <= repeats; runNumber += 1) {
  const status = run(process.execPath, ['--test', 'apps/api/tests/critical.e2e.test.js']);
  if (status !== 0) process.exit(status);
  console.log(`[critical-e2e] completed deterministic journey repeat ${runNumber}/${repeats}`);
}
