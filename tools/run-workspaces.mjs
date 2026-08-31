#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { dependencyFirst, selectWorkspaces } from './workspace-graph.mjs';
import { npmArgs, npmCommand } from './npm-command.mjs';

const [script, ...argumentsList] = process.argv.slice(2);
if (!script) {
  console.error('Usage: node tools/run-workspaces.mjs <script> [--filter <workspace>] [args...]');
  process.exit(1);
}

const filterIndex = argumentsList.indexOf('--filter');
const filter = filterIndex >= 0 ? argumentsList[filterIndex + 1] : undefined;
if (filterIndex >= 0 && !filter) {
  console.error('--filter requires a workspace name.');
  process.exit(1);
}
const forwarded = argumentsList.filter(
  (value, index) => index !== filterIndex && index !== filterIndex + 1,
);
const selected = selectWorkspaces(filter);
const ordered = dependencyFirst(selected);
for (const workspace of ordered) {
  if (!workspace.manifest.scripts?.[script]) continue;
  console.log(`\n[npm-workspaces] ${workspace.manifest.name} npm run ${script}`);
  const result = spawnSync(
    npmCommand,
    npmArgs(['run', script, ...(forwarded.length > 0 ? ['--', ...forwarded] : [])]),
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
