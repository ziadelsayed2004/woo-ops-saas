# Worktree Workflow

## Principles

- One task, one branch, one worktree.
- Worktrees are siblings of the repository by default, not nested Git repositories.
- Runtime task locks/state live under the Git common directory and are shared by all worktrees.
- Never remove a worktree containing uncommitted work.

## Commands

```bash
node .agentpack/scripts/agentpack.mjs task start T0303
node .agentpack/scripts/agentpack.mjs worktree list
git worktree remove /exact/path/after-merge
node .agentpack/scripts/agentpack.mjs worktree prune
```

`task start` chooses a branch prefix from task type and creates:

```text
<configured-worktree-root>/<TASK_ID>-<slug>
<type>/<task-id-lowercase>-<slug>
```

## Safe integration

1. Rebase or merge current base according to repository policy.
2. Resolve conflicts in the task worktree and rerun affected validation.
3. Review the complete diff from merge base.
4. Merge through protected workflow.
5. Confirm the worktree is clean and branch is merged.
6. Change directory to the primary repository or another path outside the worktree.
7. Remove the exact worktree path; then prune metadata.

The included CLI intentionally does not force-remove worktrees or delete branches.

## Parallelism

Tasks may run in parallel only when dependencies are complete and file/package ownership is
disjoint. Contract and schema tasks should land before their consumers. Database index/migration,
root configuration, shared contracts, and generated client changes are high-conflict areas and
should be serialized.
