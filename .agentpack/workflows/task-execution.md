# Task Execution Workflow

## 1. Select

Run pack validation and choose the first ready task by priority/phase. Read its dependencies,
references, scope, acceptance, and validation. If the user explicitly selects another ready task,
honor it.

## 2. Establish evidence before editing

- Inspect current branch/worktree and user changes.
- Reproduce the relevant baseline behavior or run the narrowest current tests.
- Record assumptions that are not already in the PRD/ADR.
- Stop for product/legal/credential/destructive choices that materially alter acceptance.

## 3. Implement inside boundaries

- Keep changes owned by the active task.
- Add or update contracts before consumers.
- Prefer domain tests before infrastructure/UI tests.
- Use idempotent, tenant-scoped application use cases.
- Add failure behavior and telemetry as part of the feature, not a later cleanup.
- Do not change an accepted ADR silently. Create a proposed ADR and block dependent rollout.

## 4. Validate

Run every task validation command that exists after the task's implementation, then affected root
gates. Inspect output, generated files, query plans, screenshots, PDFs, or workbooks where applicable.

Never claim a command passed if it was skipped, unavailable, or only partially ran.

## 5. Record result

Fill `.agentpack/templates/task-result.md` and save it as
`.agentpack/results/<TASK_ID>.md` on the task branch. Include:

- outcome
- changed files/contracts
- acceptance evidence
- exact commands and results
- migrations/indexes/config
- security and tenant review
- screenshots/artifacts for UI/documents
- limitations/follow-ups

## 6. Review and integrate

Commit with task ID. A reviewer follows `.agentpack/workflows/review.md`. Merge only after required
CI and review. Clean the worktree only after merge and after confirming no uncommitted changes.
