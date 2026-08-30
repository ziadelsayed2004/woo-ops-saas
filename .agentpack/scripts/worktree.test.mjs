import assert from "node:assert/strict";
import test from "node:test";

import { isRegisteredWorktreePath } from "./worktree.mjs";

test("matches a registered worktree when Git uses alternate separators", () => {
  const expectedPath = `${process.cwd()}\\fixture-worktree`;
  const gitPath = expectedPath.replaceAll("\\", "/");
  const registered = `worktree ${gitPath}\nHEAD deadbeef\n\n`;

  assert.equal(isRegisteredWorktreePath(registered, expectedPath), true);
});

test("matches case differences on Windows", () => {
  const expectedPath = `${process.cwd()}\\fixture-worktree`;
  const alternateCase = expectedPath.toUpperCase().replaceAll("\\", "/");
  const registered = `worktree ${alternateCase}\nHEAD deadbeef\n\n`;

  assert.equal(isRegisteredWorktreePath(registered, expectedPath), process.platform === "win32");
});

test("rejects an existing path that is not registered", () => {
  const registered = `worktree ${process.cwd().replaceAll("\\", "/")}\\other-worktree\n`;

  assert.equal(isRegisteredWorktreePath(registered, `${process.cwd()}\\expected-worktree`), false);
});
