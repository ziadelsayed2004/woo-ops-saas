import assert from 'node:assert/strict';
import test from 'node:test';
import { can, hashPassword, verifyPassword } from '../../src/auth.js';

test('operation permissions allow operators but not viewers', () => {
  assert.equal(can('operator', 'operations:write'), true);
  assert.equal(can('viewer', 'operations:write'), false);
  assert.equal(can('admin', 'account:write'), true);
});

test('password hashing remains one-way and verifiable', () => {
  const encoded = hashPassword('correct horse battery staple');
  assert.equal(verifyPassword('correct horse battery staple', encoded), true);
  assert.equal(verifyPassword('wrong password', encoded), false);
});
