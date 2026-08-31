import { spawnSync } from 'node:child_process';
import { npmArgs, npmCommand } from './npm-command.mjs';

const spawnOptions = { stdio: 'inherit', shell: false };

const run = (command, args) => {
  console.log(`\n[critical-e2e] ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, spawnOptions);
  if (result.error) {
    console.error(`[critical-e2e] ${result.error.message}`);
    return result.status ?? 1;
  }
  return result.status ?? 1;
};

const buildStatus = run(npmCommand, npmArgs(['run', 'build']));
if (buildStatus !== 0) process.exit(buildStatus);

const apiRegressionStatus = run(
  npmCommand,
  npmArgs(['run', 'test:e2e', '--workspace=@woo-ops/api']),
);
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
