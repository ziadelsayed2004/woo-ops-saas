# Task System

`registry.json` is the immutable task-definition source. Runtime status is stored in the Git common
directory at `.git/agentpack/state.json`, so concurrent worktrees do not edit a shared tracked status
file.

## Lifecycle

```text
planned -> ready -> in-progress -> blocked | failed | completed
                                      failed -> in-progress
```

`ready` is derived: a planned task is ready when every dependency is completed. The runtime file
stores only explicit starts, blocks, failures, and completions.

## Start a task

```bash
node .agentpack/scripts/agentpack.mjs task show T0001
node .agentpack/scripts/agentpack.mjs task start T0001
```

The start command:

1. Validates the complete pack and dependency graph.
2. Requires a Git repository and resolvable base branch.
3. Acquires a task lock in the Git common directory.
4. Creates a branch and sibling worktree.
5. Records task/worktree state without changing tracked files.
6. Prints the exact worktree path and implementation prompt.

Run the implementation agent from that worktree. It must read the task's `references`, stay within
`scope`, and satisfy every `acceptance` and `validation` entry.

## Completion evidence

Copy `.agentpack/templates/task-result.md` into `.agentpack/results/<TASK_ID>.md` in the task branch,
fill it with commands/results, changed contracts, risks, migrations, screenshots/artifacts where
applicable, and follow-ups. Then run:

```bash
node .agentpack/scripts/agentpack.mjs task complete T0001 \
  --evidence .agentpack/results/T0001.md
```

The command verifies the evidence file is non-empty and records completion state. It does not claim
tests passed on the agent's behalf; reviewers must inspect evidence and CI.

## Parallel work

- Use different task IDs and different worktrees.
- Dependencies must be complete first.
- Prefer tasks in different `parallelGroup` values.
- If two tasks own the same package or contract, serialize them even when the graph technically
  permits parallel work.
- Recommended maximum is defined in `manifest.json`; increase only after CI and integration risk are
  understood.

## Blocking

Do not guess a product, legal, credential, infrastructure, or destructive decision. Record the
blocker in task evidence and run:

```bash
node .agentpack/scripts/agentpack.mjs task fail T0001 --reason "Concise blocker"
```

Use failure for an implementation/check failure and document a product blocker in the result file.
Do not mark a task complete with deferred acceptance criteria.

## Review

Use `.agentpack/prompts/reviewer.md`. Review from the merge diff and task evidence, not from the
implementer's summary alone. Security, tenant scope, money, idempotency, and connector direction are
mandatory review dimensions even when not repeated in a task.
