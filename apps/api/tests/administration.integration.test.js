import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { SqliteStore } from '@woo-ops/persistence';
import { AuthService } from '../src/auth.js';

const contextFor = (user, correlationId = randomUUID()) => ({
  accountId: user.accountId,
  actorId: user.id,
  role: user.role,
  correlationId,
});

const fixture = () => {
  const directory = mkdtempSync(join(tmpdir(), 'woo-administration-'));
  const store = new SqliteStore(join(directory, 'administration.sqlite'));
  const auth = new AuthService(store.db);
  return { directory, store, auth };
};

test('account administration is scoped, role protected, and revokes member sessions', () => {
  const { directory, store, auth } = fixture();
  try {
    const owner = auth.register(
      'owner-admin@example.test',
      'correct horse battery staple',
      'Owner',
    );
    const invitee = auth.register(
      'operator-admin@example.test',
      'correct horse battery staple',
      'Invitee',
    );
    const ownerContext = contextFor(owner);
    const invitation = store.createInvitation(ownerContext, {
      email: invitee.email,
      role: 'operator',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    assert.match(invitation.acceptToken ?? '', /^[A-Za-z0-9_-]{43}$/u);
    assert.equal(store.listInvitations(ownerContext).length, 1);
    const accepted = store.acceptInvitation(
      invitee.id,
      invitation.id,
      invitation.acceptToken,
      randomUUID(),
    );
    assert.equal(accepted.role, 'operator');
    assert.equal(
      store.listMembers(ownerContext).filter((member) => member.status === 'active').length,
      2,
    );

    store.db
      .prepare('UPDATE account_memberships SET created_at = ? WHERE account_id = ? AND user_id = ?')
      .run('2000-01-01T00:00:00.000Z', owner.accountId, invitee.id);
    const memberLogin = auth.login(invitee.email, 'correct horse battery staple');
    assert.equal(memberLogin.user.accountId, owner.accountId);
    const memberSession = store.db
      .prepare('SELECT id, revoked_at FROM sessions WHERE token_hash = ?')
      .get(hashSession(memberLogin.session));
    // The membership timestamp above makes this a session in the administered account.
    assert.equal(memberSession?.revoked_at ?? null, null);
    assert.throws(
      () => store.changeMemberRole(ownerContext, owner.id, 'admin'),
      /MEMBER_SELF_ROLE_CHANGE/,
    );
    const changed = store.changeMemberRole(ownerContext, invitee.id, 'viewer');
    assert.equal(changed.role, 'viewer');
    assert.equal(
      store.db
        .prepare(
          'SELECT COUNT(*) AS count FROM sessions WHERE user_id = ? AND revoked_at IS NOT NULL',
        )
        .get(invitee.id).count,
      1,
    );
    assert.throws(() => store.revokeMembership(ownerContext, owner.id), /MEMBER_SELF_REVOKE/);

    const other = auth.register(
      'other-admin@example.test',
      'correct horse battery staple',
      'Other',
    );
    assert.throws(
      () => store.listMembers({ ...contextFor(other), accountId: owner.accountId }),
      /ACCOUNT_ADMIN_PERMISSION_DENIED|BULK_PERMISSION_DENIED/,
    );
    assert.equal(store.getAccount(contextFor(other)).id, other.accountId);
    assert.notEqual(store.getAccount(ownerContext).id, other.accountId);
  } finally {
    if (store.db.open) store.db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('password reset tokens are hashed, expire, and are one-time while sessions are revoked', () => {
  const { directory, store, auth } = fixture();
  try {
    const user = auth.register('reset-admin@example.test', 'old correct password', 'Reset');
    const oldLogin = auth.login(user.email, 'old correct password');
    let token = '';
    auth.requestPasswordReset(user.email, randomUUID(), (deliveredToken) => {
      token = deliveredToken;
    });
    assert.match(token, /^[A-Za-z0-9_-]{43}$/u);
    assert.equal(
      store.db.prepare('SELECT token_hash FROM password_reset_tokens').get().token_hash === token,
      false,
    );
    auth.confirmPasswordReset(token, 'new correct password', randomUUID());
    assert.equal(
      auth.current({ headers: { cookie: `woo_ops_session=${oldLogin.session}` } }),
      null,
    );
    assert.throws(
      () => auth.confirmPasswordReset(token, 'another password', randomUUID()),
      /AUTH_RESET_INVALID/,
    );
    assert.equal(auth.login(user.email, 'new correct password').user.id, user.id);
    assert.throws(() => auth.login(user.email, 'old correct password'), /AUTH_INVALID_CREDENTIALS/);
  } finally {
    if (store.db.open) store.db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('password changes rotate the current session and require the existing secret', () => {
  const { directory, store, auth } = fixture();
  try {
    const user = auth.register('change-admin@example.test', 'old correct password', 'Change');
    const oldLogin = auth.login(user.email, 'old correct password');
    const rotated = auth.changePassword(
      user.id,
      user.accountId,
      'old correct password',
      'new correct password',
      randomUUID(),
    );
    assert.equal(rotated.user.id, user.id);
    assert.equal(
      auth.current({ headers: { cookie: `woo_ops_session=${oldLogin.session}` } }),
      null,
    );
    assert.equal(auth.login(user.email, 'new correct password').user.id, user.id);
    assert.throws(
      () => auth.changePassword(user.id, user.accountId, 'wrong old password', 'third password'),
      /AUTH_INVALID_CREDENTIALS/,
    );
  } finally {
    if (store.db.open) store.db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('account settings validate timezone and health exposes migration and queue state', () => {
  const { directory, store, auth } = fixture();
  try {
    const owner = auth.register(
      'settings-admin@example.test',
      'correct horse battery staple',
      'Settings',
    );
    const context = contextFor(owner);
    const updated = store.updateAccount(context, {
      name: 'Operations',
      locale: 'en-US',
      direction: 'ltr',
      timezone: 'UTC',
      baseCurrency: 'usd',
    });
    assert.deepEqual(
      {
        name: updated.name,
        locale: updated.locale,
        direction: updated.direction,
        timezone: updated.timezone,
        baseCurrency: updated.baseCurrency,
      },
      {
        name: 'Operations',
        locale: 'en-US',
        direction: 'ltr',
        timezone: 'UTC',
        baseCurrency: 'USD',
      },
    );
    assert.throws(
      () => store.updateAccount(context, { timezone: 'Not/A/Timezone' }),
      /ACCOUNT_TIMEZONE_INVALID/,
    );
    const health = store.healthSnapshot();
    assert.equal(health.database, 'connected');
    assert.equal(health.schemaVersion, 17);
    assert.deepEqual(health.queue, { queued: 0, running: 0, deadLettered: 0 });
  } finally {
    if (store.db.open) store.db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

const hashSession = (token) => {
  // SHA-256 is deliberately reproduced only for the fixture lookup; production code never
  // exposes or logs the raw session token.
  return createHash('sha256').update(token).digest();
};
