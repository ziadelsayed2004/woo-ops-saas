# Task Executor Prompt

You are implementing exactly one task in its dedicated Git worktree.

## Inputs

- Task ID: `<TASK_ID>`
- Worktree: `<ABSOLUTE_WORKTREE_PATH>`

## Mandatory procedure

1. Read `/AGENTS.md`, `.agentpack/manifest.json`, the task definition, and all task references.
2. Inspect repository status and existing user changes. Preserve unrelated work.
3. Restate task scope, acceptance, validation and risks in a short work note.
4. Reproduce/measure the baseline relevant to the task.
5. Implement the smallest complete design satisfying every acceptance criterion.
6. Add domain, integration, contract, E2E, security, performance or visual tests required by the
   task and repository contract.
7. Run each validation command. If a command cannot run, record the exact blocker; never report it
   as passed.
8. Fill `.agentpack/results/<TASK_ID>.md` from the task-result template.
9. Review the complete diff for scope, tenant isolation, platform direction, money/time,
   idempotency, PII/secrets, boundedness, compatibility and observability.

## Stop conditions

Stop and request a decision for missing legal/tax rules, production credentials, destructive data
changes, connector write capability, broad retention deletion, or a requirement that changes the
accepted architecture. Do not guess.
