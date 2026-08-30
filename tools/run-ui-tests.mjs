import { spawnSync } from 'node:child_process';

const [mode = 'e2e', ...forwarded] = process.argv.slice(2);
const filterIndex = forwarded.indexOf('--filter');
const filter = filterIndex >= 0 ? forwarded[filterIndex + 1] : undefined;
if (filter && !/^[a-z0-9@._-]+$/i.test(filter)) {
  console.error('UI test filter contains unsupported characters.');
  process.exitCode = 1;
  process.exit();
}
const args = ['exec', 'playwright', 'test'];

const runApiEndToEnd = () => {
  const packageManager = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const build = spawnSync(packageManager, ['-r', 'build'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (build.status !== 0) return build.status ?? 1;
  const apiTests = spawnSync(process.execPath, ['tools/run-tests.mjs', 'e2e'], {
    stdio: 'inherit',
    shell: false,
  });
  return apiTests.status ?? 1;
};

const runPackageVisual = (packageName) => {
  const packageManager = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const result = spawnSync(packageManager, ['--filter', packageName, 'test:visual'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  return result.status ?? 1;
};

if (filter === 'bulk' || filter === 'api') {
  process.exitCode = runApiEndToEnd();
  process.exit();
}
if (filter === 'documents' && mode === 'visual') {
  process.exitCode = runPackageVisual('@woo-ops/documents');
  process.exit();
}

if (mode === 'a11y') args.push('--grep', '@a11y');
else if (mode === 'visual') args.push('--grep', '@visual');
else if (filter) args.push('--grep', filter);

const ignored = new Set(['--filter', filter]);
args.push(...forwarded.filter((argument) => !ignored.has(argument)));
const packageManager = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const result = spawnSync(packageManager, args, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (result.error) {
  console.error(`Unable to start Playwright: ${result.error.message}`);
  process.exitCode = 1;
} else {
  if ((result.status ?? 1) !== 0 || mode !== 'e2e') {
    process.exitCode = result.status ?? 1;
  } else {
    process.exitCode = runApiEndToEnd();
  }
}
