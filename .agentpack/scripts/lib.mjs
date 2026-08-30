import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));

export const repositoryRoot = path.resolve(scriptDirectory, "../..");
export const agentpackRoot = path.join(repositoryRoot, ".agentpack");

export function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read JSON ${filePath}: ${error.message}`);
  }
}
export function loadManifest() {
  return readJson(path.join(agentpackRoot, "manifest.json"));
}

export function loadRegistry() {
  return readJson(path.join(agentpackRoot, "tasks", "registry.json"));
}

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    encoding: "utf8",
    env: options.env ?? process.env,
    stdio: options.stdio ?? "pipe",
    shell: options.shell ?? false
  });

  if (result.error) {
    if (options.check === false) return result;
    throw new Error(`${command} failed to start: ${result.error.message}`);
  }

  if (result.status !== 0 && options.check !== false) {
    const detail = (result.stderr || result.stdout || "unknown error").trim();
    throw new Error(`${command} ${args.join(" ")} failed: ${detail}`);
  }

  return result;
}

export function isGitRepository() {
  const result = run("git", ["rev-parse", "--is-inside-work-tree"], { check: false });
  return result.status === 0 && result.stdout.trim() === "true";
}

export function gitCommonDirectory() {
  if (!isGitRepository()) {
    return path.join(agentpackRoot, ".runtime", "git-fallback");
  }

  const raw = run("git", ["rev-parse", "--git-common-dir"]).stdout.trim();
  return path.isAbsolute(raw) ? raw : path.resolve(repositoryRoot, raw);
}

export function runtimeDirectory() {
  return path.join(gitCommonDirectory(), "agentpack");
}

export function primaryRepositoryRoot() {
  if (!isGitRepository()) return repositoryRoot;

  const commonDirectory = gitCommonDirectory();
  if (path.basename(commonDirectory) === ".git") return path.dirname(commonDirectory);

  const worktreeList = run("git", ["worktree", "list", "--porcelain"]).stdout;
  const firstWorktreeLine = worktreeList.split("\n").find((line) => line.startsWith("worktree "));
  if (!firstWorktreeLine) throw new Error("Unable to resolve the primary Git worktree.");
  return firstWorktreeLine.slice("worktree ".length);
}

export function statePath() {
  return path.join(runtimeDirectory(), "state.json");
}

export function initialState() {
  return {
    schemaVersion: 1,
    tasks: {},
    worktrees: {},
    updatedAt: null
  };
}

export function loadState() {
  const filePath = statePath();
  if (!fs.existsSync(filePath)) return initialState();
  const state = readJson(filePath);
  if (state.schemaVersion !== 1 || typeof state.tasks !== "object" || typeof state.worktrees !== "object") {
    throw new Error(`Unsupported or corrupt runtime state: ${filePath}`);
  }
  return state;
}

export function saveState(state) {
  const directory = runtimeDirectory();
  fs.mkdirSync(directory, { recursive: true });
  const target = statePath();
  const temporary = `${target}.${process.pid}.tmp`;
  const value = { ...state, updatedAt: new Date().toISOString() };
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, target);
}

export function taskById(registry, taskId) {
  const normalized = String(taskId ?? "").toUpperCase();
  const task = registry.tasks.find((item) => item.id === normalized);
  if (!task) throw new Error(`Unknown task ID: ${taskId}`);
  return task;
}

export function explicitTaskStatus(state, taskId) {
  return state.tasks[taskId]?.status ?? "planned";
}

export function dependenciesComplete(task, state) {
  return task.dependencies.every((dependency) => explicitTaskStatus(state, dependency) === "completed");
}

export function displayTaskStatus(task, state) {
  const explicit = explicitTaskStatus(state, task.id);
  if (explicit !== "planned") return explicit;
  return dependenciesComplete(task, state) ? "ready" : "planned";
}

export function slugify(input, maxLength = 52) {
  const slug = String(input)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
  return (slug || "task").slice(0, maxLength).replace(/-+$/g, "");
}

export function parseOptions(argumentsList) {
  const positionals = [];
  const options = {};

  for (let index = 0; index < argumentsList.length; index += 1) {
    const value = argumentsList[index];
    if (!value.startsWith("--")) {
      positionals.push(value);
      continue;
    }

    const key = value.slice(2);
    const next = argumentsList[index + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
    } else {
      options[key] = next;
      index += 1;
    }
  }

  return { positionals, options };
}

export function lockPath(taskId) {
  return path.join(runtimeDirectory(), "locks", `${taskId}.lock`);
}

export function acquireTaskLock(taskId) {
  const locksRoot = path.join(runtimeDirectory(), "locks");
  fs.mkdirSync(locksRoot, { recursive: true });
  const target = lockPath(taskId);

  try {
    fs.mkdirSync(target);
    fs.writeFileSync(
      path.join(target, "owner.json"),
      `${JSON.stringify({ pid: process.pid, host: os.hostname(), acquiredAt: new Date().toISOString() }, null, 2)}\n`,
      { mode: 0o600 }
    );
  } catch (error) {
    if (error.code === "EEXIST") {
      throw new Error(`Task ${taskId} is locked. Inspect ${target} and runtime state before recovery.`);
    }
    throw error;
  }

  return target;
}

export function releaseTaskLock(taskId) {
  const target = lockPath(taskId);
  const expectedRoot = path.join(runtimeDirectory(), "locks") + path.sep;
  if (!target.startsWith(expectedRoot)) throw new Error("Refusing to release an unsafe lock path");
  fs.rmSync(target, { recursive: true, force: true });
}

export function resolveWorktreeRoot(manifest) {
  const configured = manifest.sourceControl.worktreeRoot;
  const primaryRoot = primaryRepositoryRoot();
  const resolved = path.resolve(primaryRoot, configured);
  const unsafe = new Set([path.parse(resolved).root, os.homedir(), primaryRoot, repositoryRoot]);
  if (unsafe.has(resolved) || !path.basename(resolved).toLowerCase().includes("worktree")) {
    throw new Error(`Unsafe worktreeRoot in manifest: ${configured}`);
  }
  return resolved;
}

export function relativeToRepository(filePath) {
  const resolved = path.resolve(filePath);
  const prefix = repositoryRoot + path.sep;
  if (!resolved.startsWith(prefix)) throw new Error(`Path is outside repository: ${filePath}`);
  return path.relative(repositoryRoot, resolved).split(path.sep).join("/");
}
