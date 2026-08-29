import fs from "node:fs";
import path from "node:path";

import {
  acquireTaskLock,
  explicitTaskStatus,
  isGitRepository,
  loadManifest,
  loadRegistry,
  loadState,
  releaseTaskLock,
  repositoryRoot,
  resolveWorktreeRoot,
  run,
  saveState,
  slugify,
  taskById
} from "./lib.mjs";

export function createTaskWorktree(taskId) {
  if (!isGitRepository()) throw new Error("Initialize and commit the repository before starting a task.");

  const manifest = loadManifest();
  const registry = loadRegistry();
  const task = taskById(registry, taskId);
  const state = loadState();
  const currentStatus = explicitTaskStatus(state, task.id);

  if (currentStatus === "completed") throw new Error(`Task ${task.id} is already completed.`);
  if (currentStatus === "in-progress") {
    const current = state.tasks[task.id];
    if (!current.worktreePath || !fs.existsSync(current.worktreePath)) {
      throw new Error(`Task ${task.id} is in progress but its worktree is missing. Recover the branch before changing state.`);
    }
    return { task, branch: current.branch, worktreePath: current.worktreePath, reused: true, resumed: false };
  }

  const incomplete = task.dependencies.filter((dependency) => explicitTaskStatus(state, dependency) !== "completed");
  if (incomplete.length > 0) throw new Error(`Task ${task.id} has incomplete dependencies: ${incomplete.join(", ")}`);

  const baseBranch = manifest.sourceControl.baseBranch;
  const verifyBase = run("git", ["rev-parse", "--verify", baseBranch], { check: false });
  if (verifyBase.status !== 0) throw new Error(`Base branch ${baseBranch} does not exist or has no commit.`);

  const slug = slugify(task.title);
  const branch = `${task.type}/${task.id.toLowerCase()}-${slug}`;
  const worktreeRoot = resolveWorktreeRoot(manifest);
  const worktreePath = path.join(worktreeRoot, `${task.id}-${slug}`);

  const branchExists = run("git", ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], { check: false });
  const mayResume = currentStatus === "failed" && branchExists.status === 0;
  const registeredWorktrees = run("git", ["worktree", "list", "--porcelain"]).stdout;
  const registeredAtExpectedPath = registeredWorktrees.includes(`worktree ${worktreePath}\n`);

  if (branchExists.status === 0 && !mayResume) {
    throw new Error(`Branch already exists: ${branch}. Recover it manually instead of creating a duplicate.`);
  }
  if (fs.existsSync(worktreePath) && !registeredAtExpectedPath) {
    throw new Error(`Expected worktree path exists but is not registered: ${worktreePath}`);
  }

  const lock = acquireTaskLock(task.id);
  try {
    fs.mkdirSync(worktreeRoot, { recursive: true });
    if (registeredAtExpectedPath) {
      // Resume the preserved failed-task worktree in place.
    } else if (mayResume) {
      run("git", ["worktree", "add", worktreePath, branch], { stdio: "inherit" });
    } else {
      run("git", ["worktree", "add", "-b", branch, worktreePath, baseBranch], { stdio: "inherit" });
    }

    const now = new Date().toISOString();
    const previousAttempts = state.tasks[task.id]?.attempts ?? 0;
    state.tasks[task.id] = {
      ...state.tasks[task.id],
      status: "in-progress",
      branch,
      worktreePath,
      startedAt: now,
      resumedAt: currentStatus === "failed" ? now : undefined,
      attempts: previousAttempts + 1
    };
    state.worktrees[task.id] = { branch, path: worktreePath, createdAt: now };
    saveState(state);

    return { task, branch, worktreePath, lock, reused: false, resumed: currentStatus === "failed" };
  } catch (error) {
    releaseTaskLock(task.id);
    throw error;
  }
}

export function listGitWorktrees() {
  if (!isGitRepository()) throw new Error("Not a Git repository.");
  return run("git", ["worktree", "list", "--porcelain"]).stdout.trim();
}

export function pruneGitWorktrees() {
  if (!isGitRepository()) throw new Error("Not a Git repository.");
  run("git", ["worktree", "prune"], { stdio: "inherit" });
}
