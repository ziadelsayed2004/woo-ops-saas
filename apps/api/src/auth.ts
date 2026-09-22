import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import type { SqliteDatabase } from '@woo-ops/persistence';

const SESSION_COOKIE = 'woo_ops_session';
const CSRF_COOKIE = 'woo_ops_csrf';
const SESSION_DAYS = 14;
const MAX_PASSWORD_LENGTH = 1024;
const MAX_ACCOUNT_NAME_LENGTH = 160;

type AuthUser = { id: string; email: string; accountId: string; role: string };
type SessionRow = {
  user_id: string;
  account_id: string;
  csrf_hash: string;
  expires_at: string;
  revoked_at: string | null;
  email: string;
  role: string;
};

const hashToken = (token: string): Buffer => createHash('sha256').update(token).digest();

export const hashPassword = (password: string): string => {
  if (password.length < 12 || password.length > MAX_PASSWORD_LENGTH)
    throw new Error('AUTH_INVALID_INPUT');
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64url')}$${derived.toString('base64url')}`;
};

export const verifyPassword = (password: string, encoded: string): boolean => {
  const [algorithm, saltText, digestText] = encoded.split('$');
  if (algorithm !== 'scrypt' || !saltText || !digestText) return false;
  const expected = Buffer.from(digestText, 'base64url');
  const salt = Buffer.from(saltText, 'base64url');
  if (password.length > MAX_PASSWORD_LENGTH || salt.length !== 16 || expected.length !== 64)
    return false;
  const actual = scryptSync(password, salt, expected.length, {
    N: 16384,
    r: 8,
    p: 1,
  });
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};

const cookieValue = (request: Request, name: string): string | undefined => {
  const header = request.headers.cookie ?? '';
  const item = header
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return item?.slice(name.length + 1);
};

const setCookies = (response: Response, session: string, csrf: string): void => {
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  const secure = process.env.NODE_ENV === 'development' ? '' : ' Secure;';
  response.setHeader('Set-Cookie', [
    `${SESSION_COOKIE}=${session}; HttpOnly; SameSite=Lax;${secure} Path=/; Max-Age=${maxAge}`,
    `${CSRF_COOKIE}=${csrf}; SameSite=Lax;${secure} Path=/; Max-Age=${maxAge}`,
  ]);
};

export class AuthService {
  constructor(private readonly db: SqliteDatabase) {}

  registrationOpen(): boolean {
    if (process.env.NODE_ENV !== 'production') return true;
    const row = this.db.prepare('SELECT COUNT(*) AS total FROM accounts').get() as {
      total: number;
    };
    return row.total === 0;
  }

  private createSession(row: { id: string; email: string; account_id: string; role: string }): {
    user: AuthUser;
    session: string;
    csrf: string;
  } {
    const session = randomBytes(32).toString('base64url');
    const csrf = randomBytes(24).toString('base64url');
    const now = new Date();
    const expires = new Date(now.getTime() + SESSION_DAYS * 86400000).toISOString();
    this.db
      .prepare(
        'INSERT INTO sessions (id, user_id, account_id, token_hash, csrf_hash, expires_at, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        randomUUID(),
        row.id,
        row.account_id,
        hashToken(session),
        hashToken(csrf),
        expires,
        now.toISOString(),
        now.toISOString(),
      );
    return {
      user: { id: row.id, email: row.email, accountId: row.account_id, role: row.role },
      session,
      csrf,
    };
  }

  register(email: string, password: string, accountName: string): AuthUser {
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedAccountName = accountName.trim();
    if (
      !/^\S+@\S+\.\S+$/.test(normalizedEmail) ||
      password.length < 12 ||
      password.length > MAX_PASSWORD_LENGTH ||
      normalizedAccountName.length > MAX_ACCOUNT_NAME_LENGTH
    )
      throw new Error('AUTH_INVALID_INPUT');
    const existing = this.db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
    if (existing) throw new Error('AUTH_ACCOUNT_EXISTS');
    const userId = randomUUID();
    const accountId = randomUUID();
    const now = new Date().toISOString();
    this.db.transaction(() => {
      if (!this.registrationOpen()) throw new Error('AUTH_REGISTRATION_CLOSED');
      this.db
        .prepare('INSERT INTO accounts (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
        .run(accountId, normalizedAccountName || 'Woo Ops Account', now, now);
      this.db
        .prepare(
          'INSERT INTO users (id, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        )
        .run(userId, normalizedEmail, hashPassword(password), now, now);
      this.db
        .prepare(
          "INSERT INTO account_memberships (account_id, user_id, role, status, updated_at, created_at) VALUES (?, ?, ?, 'active', ?, ?)",
        )
        .run(accountId, userId, 'owner', now, now);
    })();
    return { id: userId, email: normalizedEmail, accountId, role: 'owner' };
  }

  login(email: string, password: string): { user: AuthUser; session: string; csrf: string } {
    const row = this.db
      .prepare(
        "SELECT u.id, u.email, u.password_hash, m.account_id, m.role FROM users u JOIN account_memberships m ON m.user_id = u.id WHERE u.email = ? AND m.status = 'active' ORDER BY m.created_at LIMIT 1",
      )
      .get(email.trim().toLowerCase()) as
      | { id: string; email: string; password_hash: string; account_id: string; role: string }
      | undefined;
    if (!row || !verifyPassword(password, row.password_hash))
      throw new Error('AUTH_INVALID_CREDENTIALS');
    return this.createSession(row);
  }

  current(request: Request): AuthUser | null {
    const token = cookieValue(request, SESSION_COOKIE);
    if (!token) return null;
    const row = this.db
      .prepare(
        "SELECT s.user_id, s.account_id, s.csrf_hash, s.expires_at, s.revoked_at, u.email, m.role FROM sessions s JOIN users u ON u.id = s.user_id JOIN account_memberships m ON m.user_id = s.user_id AND m.account_id = s.account_id AND m.status = 'active' WHERE s.token_hash = ? LIMIT 1",
      )
      .get(hashToken(token)) as SessionRow | undefined;
    if (!row || row.revoked_at || row.expires_at <= new Date().toISOString()) return null;
    this.db
      .prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ? AND revoked_at IS NULL')
      .run(new Date().toISOString(), hashToken(token));
    return { id: row.user_id, email: row.email, accountId: row.account_id, role: row.role };
  }

  verifyCurrentPassword(userId: string, accountId: string, currentPassword: string): void {
    const row = this.db
      .prepare(
        "SELECT u.password_hash FROM users u JOIN account_memberships m ON m.user_id = u.id AND m.account_id = ? AND m.status = 'active' WHERE u.id = ?",
      )
      .get(accountId, userId) as { password_hash: string } | undefined;
    if (!row || !verifyPassword(currentPassword, row.password_hash))
      throw new Error('AUTH_INVALID_CREDENTIALS');
  }

  changePassword(
    userId: string,
    accountId: string,
    currentPassword: string,
    newPassword: string,
    correlationId = 'auth-password-change',
  ): { user: AuthUser; session: string; csrf: string } {
    if (currentPassword === newPassword) throw new Error('AUTH_PASSWORD_REUSE');
    const row = this.db
      .prepare(
        "SELECT u.id, u.email, u.password_hash, m.account_id, m.role FROM users u JOIN account_memberships m ON m.user_id = u.id AND m.account_id = ? AND m.status = 'active' WHERE u.id = ?",
      )
      .get(accountId, userId) as
      | { id: string; email: string; password_hash: string; account_id: string; role: string }
      | undefined;
    if (!row) throw new Error('AUTH_INVALID_CREDENTIALS');
    this.verifyCurrentPassword(userId, accountId, currentPassword);
    const passwordHash = hashPassword(newPassword);
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db
        .prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
        .run(passwordHash, now, userId);
      this.db
        .prepare(
          'UPDATE sessions SET revoked_at = ? WHERE account_id = ? AND user_id = ? AND revoked_at IS NULL',
        )
        .run(now, accountId, userId);
      recordAudit(this.db, {
        accountId,
        actorId: userId,
        action: 'auth.password-changed',
        targetType: 'user',
        targetId: userId,
        correlationId,
        summary: {},
      });
    })();
    return this.createSession(row);
  }

  requestPasswordReset(
    email: string,
    correlationId = 'auth-password-reset-request',
    deliver?: (token: string) => void,
  ): void {
    const normalizedEmail = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/u.test(normalizedEmail) || normalizedEmail.length > 320)
      throw new Error('AUTH_INVALID_INPUT');
    const row = this.db
      .prepare(
        "SELECT u.id, u.email, m.account_id FROM users u JOIN account_memberships m ON m.user_id = u.id AND m.status = 'active' WHERE u.email = ? ORDER BY m.created_at LIMIT 1",
      )
      .get(normalizedEmail) as { id: string; email: string; account_id: string } | undefined;
    if (!row) return;
    const token = randomBytes(32).toString('base64url');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 30 * 60 * 1000).toISOString();
    this.db.transaction(() => {
      this.db
        .prepare(
          'DELETE FROM password_reset_tokens WHERE user_id = ? OR expires_at <= ? OR used_at IS NOT NULL',
        )
        .run(row.id, now.toISOString());
      this.db
        .prepare(
          'INSERT INTO password_reset_tokens (id, user_id, account_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(randomUUID(), row.id, row.account_id, hashToken(token), expiresAt, now.toISOString());
      recordAudit(this.db, {
        accountId: row.account_id,
        action: 'auth.password-reset-requested',
        targetType: 'user',
        targetId: row.id,
        correlationId,
        summary: {},
      });
    })();
    deliver?.(token);
  }

  confirmPasswordReset(
    token: string,
    newPassword: string,
    correlationId = 'auth-password-reset-confirmed',
  ): void {
    if (!/^[A-Za-z0-9_-]{32,80}$/u.test(token)) throw new Error('AUTH_RESET_INVALID');
    const passwordHash = hashPassword(newPassword);
    const now = new Date().toISOString();
    this.db.transaction(() => {
      const row = this.db
        .prepare(
          'SELECT id, user_id, account_id, expires_at FROM password_reset_tokens WHERE token_hash = ? AND used_at IS NULL',
        )
        .get(hashToken(token)) as
        { id: string; user_id: string; account_id: string; expires_at: string } | undefined;
      if (!row || row.expires_at <= now) throw new Error('AUTH_RESET_INVALID');
      this.db
        .prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
        .run(passwordHash, now, row.user_id);
      this.db
        .prepare('UPDATE password_reset_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL')
        .run(now, row.id);
      this.db
        .prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
        .run(now, row.user_id);
      recordAudit(this.db, {
        accountId: row.account_id,
        action: 'auth.password-reset-completed',
        targetType: 'user',
        targetId: row.user_id,
        correlationId,
        summary: {},
      });
    })();
  }

  csrfValid(request: Request): boolean {
    const session = cookieValue(request, SESSION_COOKIE);
    const csrf = request.header('x-csrf-token');
    if (!session || !csrf) return false;
    const row = this.db
      .prepare('SELECT csrf_hash FROM sessions WHERE token_hash = ? AND revoked_at IS NULL')
      .get(hashToken(session)) as { csrf_hash: Buffer } | undefined;
    if (!row) return false;
    const expected = Buffer.from(row.csrf_hash);
    const actual = hashToken(csrf);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  logout(request: Request, response: Response): void {
    const token = cookieValue(request, SESSION_COOKIE);
    if (token)
      this.db
        .prepare('UPDATE sessions SET revoked_at = ? WHERE token_hash = ?')
        .run(new Date().toISOString(), hashToken(token));
    response.setHeader('Set-Cookie', [
      `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax;${process.env.NODE_ENV === 'development' ? '' : ' Secure;'} Path=/; Max-Age=0`,
      `${CSRF_COOKIE}=; SameSite=Lax;${process.env.NODE_ENV === 'development' ? '' : ' Secure;'} Path=/; Max-Age=0`,
    ]);
  }

  setCookies(response: Response, auth: { session: string; csrf: string }): void {
    setCookies(response, auth.session, auth.csrf);
  }
}

export const can = (
  role: string,
  permission:
    | 'account:write'
    | 'audit:read'
    | 'operations:write'
    | 'members:read'
    | 'members:write'
    | 'sessions:read'
    | 'sessions:write'
    | 'security:write',
): boolean => {
  if (permission === 'audit:read') return ['owner', 'admin', 'operator', 'viewer'].includes(role);
  if (permission === 'operations:write') return ['owner', 'admin', 'operator'].includes(role);
  if (permission === 'members:read' || permission === 'members:write')
    return ['owner', 'admin'].includes(role);
  if (permission === 'sessions:read' || permission === 'sessions:write')
    return ['owner', 'admin', 'operator', 'viewer'].includes(role);
  if (permission === 'security:write')
    return ['owner', 'admin', 'operator', 'viewer'].includes(role);
  return ['owner', 'admin'].includes(role);
};

export const recordAudit = (
  db: SqliteDatabase,
  input: {
    accountId: string;
    actorId?: string;
    action: string;
    targetType: string;
    targetId?: string;
    correlationId: string;
    summary: Record<string, unknown>;
  },
): void => {
  db.prepare(
    'INSERT INTO audit_events (id, account_id, actor_id, action, target_type, target_id, summary_json, correlation_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    randomUUID(),
    input.accountId,
    input.actorId ?? null,
    input.action,
    input.targetType,
    input.targetId ?? null,
    JSON.stringify(input.summary),
    input.correlationId,
    new Date().toISOString(),
  );
};
