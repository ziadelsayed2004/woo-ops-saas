# Run Next Woo Ops Task

Paste this prompt in Codex from the primary repository root:

> Follow `AGENTS.md` and `.agentpack/prompts/orchestrator.md` exactly. Run `node .agentpack/scripts/agentpack.mjs task board`, select the first ready task by phase and priority, show it, read every reference, start its dedicated worktree, and implement only that task. Run all task and affected repository validations. Create `.agentpack/results/<TASK_ID>.md`, commit with the task ID, execute `task complete` with the evidence path, merge the branch into `main`, and finish by running `node .agentpack/scripts/agentpack.mjs task board`. Report changed files, exact validation results, commit and updated board. If blocked, do not fake completion: record the blocker and leave the task failed/blocked according to the workflow.
