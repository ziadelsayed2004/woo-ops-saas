import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { SqliteStore } from '@woo-ops/persistence';
import { AuthService } from '../src/auth.js';
import { privateDocumentPath, writePrivatePdf } from '../src/document-files.js';

test('production sessions set secure cookie attributes and revoked memberships stop access', () => {
  const directory = mkdtempSync(join(tmpdir(), 'woo-auth-security-'));
  const store = new SqliteStore(join(directory, 'auth.sqlite'));
  const previousNodeEnv = process.env.NODE_ENV;
  try {
    const auth = new AuthService(store.db);
    const user = auth.register('security@example.test', 'correct horse battery staple', 'Security');
    const loggedIn = auth.login('security@example.test', 'correct horse battery staple');
    const response = { setHeader: (name, value) => ((response[name] = value), response) };
    process.env.NODE_ENV = 'production';
    auth.setCookies(response, loggedIn);
    assert.equal(
      response['Set-Cookie'].every((cookie) => cookie.includes('Secure')),
      true,
    );
    assert.equal(response['Set-Cookie'][0].includes('HttpOnly'), true);
    const request = { headers: { cookie: `woo_ops_session=${loggedIn.session}` } };
    assert.equal(auth.current(request).accountId, user.accountId);
    store.db
      .prepare('DELETE FROM account_memberships WHERE account_id = ? AND user_id = ?')
      .run(user.accountId, user.id);
    assert.equal(auth.current(request), null);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (store.db.open) store.db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('private document storage rejects traversal and protects the path chain', () => {
  const directory = mkdtempSync(join(tmpdir(), 'woo-files-security-'));
  try {
    assert.throws(
      () => privateDocumentPath(directory, '../outside.pdf'),
      /DOCUMENT_FILE_PATH_INVALID/,
    );
    const stored = writePrivatePdf(directory, 'account-a', 'file-a', Buffer.from('%PDF-test'));
    assert.equal(stored.relativePath, 'account-a/file-a.pdf');
    assert.throws(
      () => privateDocumentPath(directory, 'account-a/../outside.pdf'),
      /DOCUMENT_FILE_PATH_INVALID/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
