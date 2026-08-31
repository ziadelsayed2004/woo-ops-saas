#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { selectWorkspaces } from './workspace-graph.mjs';
import { npmArgs, npmCommand } from './npm-command.mjs';

const requested = selectWorkspaces();
const devWorkspaces = requested.filter((workspace) =>
  ['@woo-ops/api', '@woo-ops/web'].includes(workspace.manifest.name),
);
const children = devWorkspaces.map((workspace) => {
  const child = spawn(npmCommand, npmArgs(['run', 'dev']), {
    cwd: workspace.directory,
    env: process.env,
    stdio: 'inherit',
    shell: false,
  });
  child.once('exit', (code, signal) => {
    if (signal || code !== 0) process.exitCode = code ?? 1;
  });
  return child;
});

const shutdown = () => {
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
