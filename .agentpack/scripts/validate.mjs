import fs from 'node:fs';
import path from 'node:path';

import {
  agentpackRoot,
  dependenciesComplete,
  displayTaskStatus,
  loadManifest,
  loadRegistry,
  loadState,
  repositoryRoot,
} from './lib.mjs';

const requiredFiles = [
  'README.md',
  'AGENTS.md',
  '.agentpack/manifest.json',
  '.agentpack/product/PRD.md',
  '.agentpack/product/UI_SPEC.md',
  '.agentpack/architecture/ARCHITECTURE.md',
  '.agentpack/architecture/DATA_MODEL.md',
  '.agentpack/architecture/API.md',
  '.agentpack/architecture/SYNC_AND_CONNECTORS.md',
  '.agentpack/architecture/SECURITY.md',
  '.agentpack/architecture/DEPLOYMENT.md',
  '.agentpack/architecture/TESTING.md',
  '.agentpack/tasks/README.md',
  '.agentpack/tasks/ROADMAP.md',
  '.agentpack/tasks/registry.json',
  '.agentpack/prompts/orchestrator.md',
  '.agentpack/prompts/task-executor.md',
  '.agentpack/prompts/reviewer.md',
  '.agentpack/workflows/worktrees.md',
  '.agentpack/workflows/release.md',
];

function assert(condition, message, errors) {
  if (!condition) errors.push(message);
}

function detectCycles(tasks, errors) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const visiting = new Set();
  const visited = new Set();

  function visit(taskId, stack) {
    if (visiting.has(taskId)) {
      errors.push(`Task dependency cycle: ${[...stack, taskId].join(' -> ')}`);
      return;
    }
    if (visited.has(taskId)) return;

    visiting.add(taskId);
    const task = byId.get(taskId);
    for (const dependency of task?.dependencies ?? []) visit(dependency, [...stack, taskId]);
    visiting.delete(taskId);
    visited.add(taskId);
  }

  for (const task of tasks) visit(task.id, []);
}

export function validatePack({ includeState = true } = {}) {
  const errors = [];
  const warnings = [];
  const manifest = loadManifest();
  const registry = loadRegistry();

  for (const relativePath of requiredFiles) {
    const absolutePath = path.join(repositoryRoot, relativePath);
    assert(fs.existsSync(absolutePath), `Missing required file: ${relativePath}`, errors);
    if (fs.existsSync(absolutePath)) {
      assert(fs.statSync(absolutePath).size > 0, `Required file is empty: ${relativePath}`, errors);
    }
  }

  assert(manifest.schemaVersion === 1, 'manifest.schemaVersion must be 1', errors);
  assert(
    manifest.pack?.id === registry.project,
    'Manifest pack ID must match task registry project',
    errors,
  );
  assert(
    manifest.product?.connectorDirection === 'read-only',
    'Connector direction must remain read-only',
    errors,
  );
  assert(
    manifest.product?.manualOrders === 'local-only',
    'Manual orders must remain local-only',
    errors,
  );
  assert(
    manifest.product?.database === 'sqlite-file',
    'Production database decision must remain sqlite-file',
    errors,
  );
  assert(
    manifest.sourceControl?.oneTaskPerWorktree === true,
    'oneTaskPerWorktree must be true',
    errors,
  );
  assert(
    Array.isArray(manifest.qualityGates) && manifest.qualityGates.length > 0,
    'Quality gates are required',
    errors,
  );

  assert(registry.schemaVersion === 1, 'registry.schemaVersion must be 1', errors);
  assert(
    Array.isArray(registry.tasks) && registry.tasks.length > 0,
    'Task registry must contain tasks',
    errors,
  );

  const ids = new Set();
  const allowedTypes = new Set(['feat', 'fix', 'chore', 'test', 'docs', 'security', 'ops']);
  const allowedPriorities = new Set(['P0', 'P1', 'P2', 'P3']);
  const allowedEstimates = new Set(['S', 'M', 'L', 'XL']);

  for (const task of registry.tasks) {
    assert(/^T\d{4}$/.test(task.id), `Invalid task ID: ${task.id}`, errors);
    assert(!ids.has(task.id), `Duplicate task ID: ${task.id}`, errors);
    ids.add(task.id);
    assert(/^E\d{2}$/.test(task.epic), `Invalid epic for ${task.id}`, errors);
    assert(
      typeof task.title === 'string' && task.title.length >= 5,
      `Task ${task.id} needs a title`,
      errors,
    );
    assert(allowedTypes.has(task.type), `Invalid type for ${task.id}`, errors);
    assert(allowedPriorities.has(task.priority), `Invalid priority for ${task.id}`, errors);
    assert(allowedEstimates.has(task.estimate), `Invalid estimate for ${task.id}`, errors);
    assert(Number.isInteger(task.phase) && task.phase >= 0, `Invalid phase for ${task.id}`, errors);
    assert(
      typeof task.parallelGroup === 'string' && task.parallelGroup.length > 0,
      `Missing parallelGroup for ${task.id}`,
      errors,
    );

    for (const field of ['dependencies', 'references', 'scope', 'acceptance', 'validation']) {
      assert(Array.isArray(task[field]), `Task ${task.id}.${field} must be an array`, errors);
    }
    assert(task.references?.length > 0, `Task ${task.id} needs references`, errors);
    assert(task.scope?.length > 0, `Task ${task.id} needs scope`, errors);
    assert(task.acceptance?.length > 0, `Task ${task.id} needs acceptance`, errors);
    assert(task.validation?.length > 0, `Task ${task.id} needs validation`, errors);

    for (const reference of task.references ?? []) {
      const absolute = path.resolve(repositoryRoot, reference);
      assert(
        absolute.startsWith(repositoryRoot + path.sep),
        `Task ${task.id} has unsafe reference: ${reference}`,
        errors,
      );
      assert(
        fs.existsSync(absolute),
        `Task ${task.id} references missing file: ${reference}`,
        errors,
      );
    }
  }

  for (const task of registry.tasks) {
    for (const dependency of task.dependencies ?? []) {
      assert(ids.has(dependency), `Task ${task.id} has unknown dependency ${dependency}`, errors);
      assert(dependency !== task.id, `Task ${task.id} depends on itself`, errors);
      const dependencyTask = registry.tasks.find((candidate) => candidate.id === dependency);
      if (dependencyTask && dependencyTask.phase > task.phase) {
        warnings.push(
          `Task ${task.id} phase ${task.phase} depends on later phase ${dependencyTask.phase} task ${dependency}`,
        );
      }
    }
  }

  detectCycles(registry.tasks, errors);

  let state = null;
  if (includeState) {
    state = loadState();
    for (const [taskId, taskState] of Object.entries(state.tasks)) {
      assert(ids.has(taskId), `Runtime state contains unknown task ${taskId}`, errors);
      assert(
        registry.statuses.includes(taskState.status),
        `Runtime task ${taskId} has invalid status ${taskState.status}`,
        errors,
      );
    }
  }

  const ready = state
    ? registry.tasks
        .filter((task) => displayTaskStatus(task, state) === 'ready')
        .map((task) => task.id)
    : registry.tasks.filter((task) => task.dependencies.length === 0).map((task) => task.id);

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    summary: {
      filesChecked: requiredFiles.length,
      tasks: registry.tasks.length,
      readyTasks: ready,
      agentpackRoot,
    },
  };
}

export function printValidation(result) {
  if (result.errors.length > 0) {
    console.error('Agent pack validation failed:');
    for (const error of result.errors) console.error(`  ERROR ${error}`);
  }
  for (const warning of result.warnings) console.warn(`  WARN  ${warning}`);

  if (result.ok) {
    console.log(
      `Agent pack valid: ${result.summary.tasks} tasks, ${result.summary.filesChecked} required files.`,
    );
    console.log(`Ready tasks: ${result.summary.readyTasks.join(', ') || 'none'}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPathSafe(import.meta.url)) {
  const result = validatePack();
  printValidation(result);
  process.exitCode = result.ok ? 0 : 1;
}

function fileURLToPathSafe(url) {
  return new URL(url).pathname;
}
