import { spawnSync } from 'node:child_process';
import { dependencyFirst, selectWorkspaces, workspaces } from './workspace-graph.mjs';
import { npmArgs, npmCommand } from './npm-command.mjs';

const [kind, ...argumentsList] = process.argv.slice(2);
if (!kind || !/^[a-z0-9:_-]+$/i.test(kind)) {
  console.error('Usage: node tools/run-tests.mjs <kind> [--filter <workspace-or-test-name>]');
  process.exit(1);
}

const filterIndex = argumentsList.indexOf('--filter');
const filter = filterIndex >= 0 ? argumentsList[filterIndex + 1] : undefined;
if (filterIndex >= 0 && (!filter || filter.startsWith('--'))) {
  console.error('--filter requires a workspace name or test-name pattern.');
  process.exit(1);
}
if (filter && !/^[a-z0-9@._-]+$/i.test(filter)) {
  console.error('Test filter contains unsupported characters.');
  process.exit(1);
}

const workspaceAliases = new Map([
  ...[
    'auth',
    'sessions',
    'permissions',
    'audit',
    'privilege',
    'jobs',
    'job-runner',
    'manual-orders',
    'bulk',
    'admin',
    'administration',
    'analytics',
  ].map((value) => [value, '@woo-ops/api']),
  ...[
    'sqlite',
    'restart',
    'catalog-sync',
    'order-sync',
    'webhook-replay',
    'order-query',
    'order-repository',
    'query-input',
    'field-mapping',
    'raw-data',
    'selection',
    'backup',
    'restore',
    'export-state',
    'export-history',
    'document-jobs',
  ].map((value) => [value, '@woo-ops/persistence']),
  ...[
    'connectors',
    'callbacks',
    'sync',
    'woocommerce',
    'woo-auth',
    'woo-products',
    'woocommerce-orders',
  ].map((value) => [value, '@woo-ops/connectors']),
  ...['export-engine', 'exports', 'spreadsheets'].map((value) => [value, '@woo-ops/exports']),
  ...['documents', 'thermal', 'templates'].map((value) => [value, '@woo-ops/documents']),
]);
const matchedWorkspace = filter
  ? (() => {
      try {
        return selectWorkspaces(filter);
      } catch {
        const alias = workspaceAliases.get(filter.toLowerCase());
        return alias ? selectWorkspaces(alias) : undefined;
      }
    })()
  : undefined;
const selected = matchedWorkspace ?? workspaces;
const ordered = dependencyFirst(selected).filter(
  (workspace) => !matchedWorkspace || matchedWorkspace.includes(workspace),
);
const forwarded = argumentsList.filter(
  (value, index) => index !== filterIndex && index !== filterIndex + 1,
);
if (filter && !matchedWorkspace) forwarded.push('--test-name-pattern', filter);

for (const workspace of ordered) {
  if (!workspace.manifest.scripts?.[`test:${kind}`]) continue;
  console.log(`\n[npm-workspaces] ${workspace.manifest.name} npm run test:${kind}`);
  const result = spawnSync(
    npmCommand,
    npmArgs(['run', `test:${kind}`, ...(forwarded.length > 0 ? ['--', ...forwarded] : [])]),
    {
      cwd: workspace.directory,
      stdio: 'inherit',
      shell: false,
      env: process.env,
    },
  );
  if (result.error) {
    console.error(
      `[npm-workspaces] unable to start ${workspace.manifest.name}: ${result.error.message}`,
    );
    process.exit(result.status ?? 1);
  }
  if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1);
}
