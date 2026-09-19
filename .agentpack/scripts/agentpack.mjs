#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

import {
  displayTaskStatus,
  explicitTaskStatus,
  isGitRepository,
  loadManifest,
  loadRegistry,
  loadState,
  parseOptions,
  relativeToRepository,
  releaseTaskLock,
  repositoryRoot,
  run,
  saveState,
  taskById
} from "./lib.mjs";
import { printValidation, validatePack } from "./validate.mjs";
import { createTaskWorktree, listGitWorktrees, pruneGitWorktrees } from "./worktree.mjs";

const priorityRank = { P0: 0, P1: 1, P2: 2, P3: 3 };

function usage() {
  console.log(`Usage:
  agentpack.mjs doctor
  agentpack.mjs validate
  agentpack.mjs task list
  agentpack.mjs task board
  agentpack.mjs task next
  agentpack.mjs task show <TASK_ID>
  agentpack.mjs task start <TASK_ID>
  agentpack.mjs task complete <TASK_ID> --evidence <PATH>
  agentpack.mjs task fail <TASK_ID> --reason <TEXT>
  agentpack.mjs worktree list
  agentpack.mjs worktree prune`);
}
function assertPackValid() {
  const result = validatePack();
  if (!result.ok) {
    printValidation(result);
    throw new Error("Fix agent-pack validation before continuing.");
  }
  return result;
}

function printTask(task, state) {
  const status = displayTaskStatus(task, state);
  console.log(`${task.id} [${status}] ${task.title}`);
  console.log(`Epic/phase: ${task.epic} / ${task.phase}`);
  console.log(`Type/priority/estimate: ${task.type} / ${task.priority} / ${task.estimate}`);
  console.log(`Parallel group: ${task.parallelGroup}`);
  console.log(`Dependencies: ${task.dependencies.join(", ") || "none"}`);
  if (task.dependencies.length > 0) {
    for (const dependency of task.dependencies) console.log(`  - ${dependency}: ${explicitTaskStatus(state, dependency)}`);
  }
  console.log("References:");
  for (const value of task.references) console.log(`  - ${value}`);
  console.log("Scope:");
  for (const value of task.scope) console.log(`  - ${value}`);
  console.log("Acceptance:");
  for (const value of task.acceptance) console.log(`  - ${value}`);
  console.log("Validation:");
  for (const value of task.validation) console.log(`  - ${value}`);
}

function doctor() {
  const checks = [];
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  checks.push({
    name: "Node 22",
    ok: nodeMajor === 22,
    detail: process.versions.node,
  });

  const gitVersion = run("git", ["--version"], { check: false });
  checks.push({ name: "Git available", ok: gitVersion.status === 0, detail: gitVersion.stdout.trim() || gitVersion.stderr.trim() });
  checks.push({ name: "Git repository", ok: isGitRepository(), detail: isGitRepository() ? repositoryRoot : "run git init -b main and commit" });

  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const npm = run(npmCommand, ["--version"], {
    check: false,
    shell: process.platform === "win32"
  });
  checks.push({ name: "npm available", ok: npm.status === 0, detail: npm.stdout?.trim() || "install with Node.js" });

  let baseBranchOk = false;
  if (isGitRepository()) {
    const base = loadManifest().sourceControl.baseBranch;
    baseBranchOk = run("git", ["rev-parse", "--verify", base], { check: false }).status === 0;
    checks.push({ name: `Base branch ${base}`, ok: baseBranchOk, detail: baseBranchOk ? "resolvable" : "create an initial commit" });
  }

  const validation = validatePack();
  checks.push({ name: "Agent pack", ok: validation.ok, detail: validation.ok ? `${validation.summary.tasks} tasks` : `${validation.errors.length} errors` });

  for (const check of checks) console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name}: ${check.detail}`);
  if (checks.some((check) => !check.ok)) process.exitCode = 1;
}

function listTasks() {
  const registry = loadRegistry();
  const state = loadState();
  const tasks = [...registry.tasks].sort((a, b) => a.phase - b.phase || priorityRank[a.priority] - priorityRank[b.priority] || a.id.localeCompare(b.id));
  for (const task of tasks) {
    console.log([task.id, displayTaskStatus(task, state).padEnd(11), task.priority, `phase=${task.phase}`, task.title].join("  "));
  }
}

function taskBoard() {
  const registry = loadRegistry();
  const state = loadState();
  const tasks = [...registry.tasks].sort((a, b) => a.phase - b.phase || priorityRank[a.priority] - priorityRank[b.priority] || a.id.localeCompare(b.id));
  const counts = { completed: 0, 'in-progress': 0, ready: 0, planned: 0, failed: 0, blocked: 0 };
  for (const task of tasks) counts[displayTaskStatus(task, state)] = (counts[displayTaskStatus(task, state)] ?? 0) + 1;
  console.log(`Task board: ${counts.completed}/${tasks.length} completed | ${counts['in-progress']} in-progress | ${counts.ready} ready | ${counts.planned} planned`);
  console.log('');
  for (const task of tasks) {
    const status = displayTaskStatus(task, state);
    const marker = { completed: '[x]', 'in-progress': '[>]', ready: '[ ]', planned: '[-]', failed: '[!]', blocked: '[?]' }[status] ?? '[ ]';
    console.log(`${marker} ${task.id}  phase=${task.phase}  ${status.padEnd(11)}  ${task.title}`);
  }
  const next = tasks.filter((task) => displayTaskStatus(task, state) === 'ready').sort((a, b) => a.phase - b.phase || priorityRank[a.priority] - priorityRank[b.priority] || a.id.localeCompare(b.id))[0];
  console.log('');
  console.log(next ? `NEXT: ${next.id} — ${next.title}` : 'NEXT: none');
}

function nextTask() {
  const registry = loadRegistry();
  const state = loadState();
  const candidates = registry.tasks
    .filter((task) => displayTaskStatus(task, state) === "ready")
    .sort((a, b) => a.phase - b.phase || priorityRank[a.priority] - priorityRank[b.priority] || a.id.localeCompare(b.id));
  if (candidates.length === 0) {
    console.log("No ready task. Inspect failed/in-progress tasks and dependencies with task list.");
    return;
  }
  printTask(candidates[0], state);
}

function showTask(taskId) {
  const registry = loadRegistry();
  printTask(taskById(registry, taskId), loadState());
}

function startTask(taskId) {
  assertPackValid();
  const result = createTaskWorktree(taskId);
  const action = result.reused ? "Existing" : result.resumed ? "Resumed" : "Created";
  console.log(`${action} task worktree for ${result.task.id}`);
  console.log(`Branch: ${result.branch}`);
  console.log(`Worktree: ${result.worktreePath}`);
  console.log(`Next: cd ${JSON.stringify(result.worktreePath)}`);
  console.log(`Read: .agentpack/prompts/task-executor.md`);
  console.log(`Run: node .agentpack/scripts/agentpack.mjs task show ${result.task.id}`);
}

function completeTask(taskId, evidenceArgument) {
  assertPackValid();
  if (!evidenceArgument || evidenceArgument === true) throw new Error("--evidence <PATH> is required.");
  if (!isGitRepository()) throw new Error("Task completion requires a Git repository.");

  const registry = loadRegistry();
  const task = taskById(registry, taskId);
  const state = loadState();
  const taskState = state.tasks[task.id];
  if (!taskState || taskState.status !== "in-progress") throw new Error(`Task ${task.id} is not in progress.`);

  const evidencePath = path.resolve(process.cwd(), evidenceArgument);
  const evidenceRelative = relativeToRepository(evidencePath);
  if (!fs.existsSync(evidencePath) || !fs.statSync(evidencePath).isFile()) throw new Error(`Evidence file not found: ${evidenceArgument}`);
  if (fs.statSync(evidencePath).size < 120) throw new Error("Evidence file is too small to demonstrate completion.");
  if (!evidenceRelative.startsWith(".agentpack/results/")) throw new Error("Evidence must be stored under .agentpack/results/.");

  const currentBranch = run("git", ["branch", "--show-current"]).stdout.trim();
  if (currentBranch !== taskState.branch) throw new Error(`Complete ${task.id} from its branch ${taskState.branch}; current branch is ${currentBranch}.`);

  state.tasks[task.id] = {
    ...taskState,
    status: "completed",
    completedAt: new Date().toISOString(),
    evidence: evidenceRelative
  };
  saveState(state);
  releaseTaskLock(task.id);
  console.log(`Recorded ${task.id} as completed with evidence ${evidenceRelative}. Review and CI are still required before merge.`);
}

function failTask(taskId, reason) {
  if (!reason || reason === true) throw new Error("--reason <TEXT> is required.");
  const registry = loadRegistry();
  const task = taskById(registry, taskId);
  const state = loadState();
  const taskState = state.tasks[task.id];
  if (!taskState || taskState.status !== "in-progress") throw new Error(`Task ${task.id} is not in progress.`);

  state.tasks[task.id] = {
    ...taskState,
    status: "failed",
    failedAt: new Date().toISOString(),
    reason: String(reason).slice(0, 500)
  };
  saveState(state);
  releaseTaskLock(task.id);
  console.log(`Recorded ${task.id} as failed. Its worktree and branch were preserved.`);
}

function main() {
  const { positionals, options } = parseOptions(process.argv.slice(2));
  const [group, action, value] = positionals;

  if (group === "doctor") return doctor();
  if (group === "validate") {
    const result = validatePack();
    printValidation(result);
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (group === "task") {
    if (action === "list") return listTasks();
    if (action === "board") return taskBoard();
    if (action === "next") return nextTask();
    if (action === "show" && value) return showTask(value);
    if (action === "start" && value) return startTask(value);
    if (action === "complete" && value) return completeTask(value, options.evidence);
    if (action === "fail" && value) return failTask(value, options.reason);
  }

  if (group === "worktree") {
    if (action === "list") return console.log(listGitWorktrees());
    if (action === "prune") return pruneGitWorktrees();
  }

  usage();
  process.exitCode = 1;
}

try {
  main();
} catch (error) {
  console.error(`ERROR ${error.message}`);
  process.exitCode = 1;
}
