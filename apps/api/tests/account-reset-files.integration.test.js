import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { purgeAccountPrivateFiles } from '../src/account-reset-files.js';

test('account reset removes only the selected account private files', () => {
  const directory = mkdtempSync(join(tmpdir(), 'woo-account-reset-files-'));
  try {
    const roots = ['exports', 'documents', 'payment-proofs'].map((name) => join(directory, name));
    for (const root of roots) {
      mkdirSync(join(root, 'account-a', 'batch'), { recursive: true });
      mkdirSync(join(root, 'account-b'), { recursive: true });
      writeFileSync(join(root, 'account-a', 'batch', 'artifact.txt'), 'delete me');
      writeFileSync(join(root, 'account-b', 'artifact.txt'), 'keep me');
    }

    purgeAccountPrivateFiles(roots, 'account-a');

    for (const root of roots) {
      assert.equal(existsSync(join(root, 'account-a')), false);
      assert.equal(existsSync(join(root, 'account-b', 'artifact.txt')), true);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('account reset rejects unsafe account paths', () => {
  assert.throws(
    () => purgeAccountPrivateFiles([tmpdir()], '../another-account'),
    /ACCOUNT_RESET_PATH_INVALID/,
  );
});
