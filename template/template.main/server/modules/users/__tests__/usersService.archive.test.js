const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

function openMemoryDatabase() {
  return new Promise((resolve, reject) => {
    const database = new sqlite3.Database(':memory:', error => {
      if (error) reject(error);
      else resolve(database);
    });
  });
}

function createDbHelper(database) {
  return {
    exec(sql) {
      return new Promise((resolve, reject) => {
        database.exec(sql, error => error ? reject(error) : resolve());
      });
    },
    run(sql, params = []) {
      return new Promise((resolve, reject) => {
        database.run(sql, params, function onRun(error) {
          if (error) reject(error);
          else resolve({ lastID: this.lastID, changes: this.changes });
        });
      });
    },
    get(sql, params = []) {
      return new Promise((resolve, reject) => {
        database.get(sql, params, (error, row) => error ? reject(error) : resolve(row));
      });
    },
    all(sql, params = []) {
      return new Promise((resolve, reject) => {
        database.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows));
      });
    }
  };
}

function close(database) {
  return new Promise((resolve, reject) => {
    database.close(error => error ? reject(error) : resolve());
  });
}

describe('usersService terminal archive', () => {
  let database;
  let db;
  let usersService;

  beforeEach(async () => {
    database = await openMemoryDatabase();
    db = createDbHelper(database);
    const migrations = path.join(__dirname, '..', '..', '..', 'db', 'migrations');
    await db.exec(fs.readFileSync(path.join(migrations, '001_initial_schema.sql'), 'utf8'));
    await db.exec(fs.readFileSync(path.join(migrations, '005_outlet_users.sql'), 'utf8'));
    await db.exec(fs.readFileSync(
      path.join(migrations, '022_unify_roles_and_archive_users.sql'),
      'utf8'
    ));

    const superAdminRole = await db.get("SELECT id FROM roles WHERE name = 'super_admin'");
    const inventoryRole = await db.get("SELECT id FROM roles WHERE name = 'inventory_manager'");
    await db.exec(`
      INSERT INTO users (id, username, password_hash, full_name, status) VALUES
        (1, 'owner', 'hash', 'Owner', 'active'),
        (2, 'worker', 'hash', 'Worker', 'active'),
        (3, 'operator', 'hash', 'Operator', 'active');
      INSERT INTO user_roles (user_id, role_id) VALUES
        (1, ${superAdminRole.id}),
        (2, ${inventoryRole.id});
      INSERT INTO authors (id, name) VALUES (10, 'Worker Author');
      INSERT INTO author_users (author_id, user_id) VALUES (10, 2);
      INSERT INTO outlet_types (id, name) VALUES (20, 'Retail');
      INSERT INTO outlets (id, name, outlet_type_id, governorate)
        VALUES (30, 'Worker Outlet', 20, 'Cairo');
      INSERT INTO outlet_users (outlet_id, user_id) VALUES (30, 2);
    `);

    jest.resetModules();
    jest.doMock('../../../db', () => db);
    jest.doMock('bcrypt', () => ({ hash: jest.fn().mockResolvedValue('new-hash') }));
    usersService = require('../usersService');
  });

  afterEach(async () => {
    jest.dontMock('../../../db');
    jest.dontMock('bcrypt');
    await close(database);
  });

  test('archives atomically, preserves a snapshot, and releases the original username', async () => {
    await usersService.archiveUser({
      targetUserId: 2,
      actorUserId: 1,
      ipAddress: '127.0.0.1'
    });

    const archived = await db.get(`
      SELECT username, archived_username, archived_at, status
      FROM users WHERE id = 2
    `);
    expect(archived).toMatchObject({ archived_username: 'worker', status: 'archived' });
    expect(archived.username).toMatch(/^__archived__2__[a-f0-9]{32}$/);
    expect(archived.archived_at).toBeTruthy();

    for (const table of ['user_roles', 'author_users', 'outlet_users']) {
      expect((await db.get(`SELECT COUNT(*) AS count FROM ${table} WHERE user_id = 2`)).count)
        .toBe(0);
    }
    const audit = await db.get(`
      SELECT user_id, details FROM audit_logs
      WHERE action = 'archive_user' AND target_id = '2'
    `);
    expect(audit.user_id).toBe(1);
    expect(JSON.parse(audit.details)).toMatchObject({
      originalUsername: 'worker',
      roles: ['inventory_manager'],
      authorIds: [10],
      outletIds: [30]
    });

    const assistant = await db.get("SELECT id FROM roles WHERE name = 'assistant'");
    const replacement = await usersService.createUser({
      username: 'WORKER',
      password: 'password',
      fullName: 'Replacement Worker',
      roleIds: [assistant.id]
    });
    expect(replacement.username).toBe('worker');
    expect((await usersService.findByUsername('worker')).id).toBe(replacement.id);
  });

  test('archive is terminal and archived accounts cannot be reactivated', async () => {
    await usersService.archiveUser({ targetUserId: 2, actorUserId: 1 });

    await expect(usersService.archiveUser({ targetUserId: 2, actorUserId: 1 }))
      .rejects.toMatchObject({ statusCode: 409, code: 'ARCHIVE_IS_TERMINAL' });
    await expect(usersService.updateStatus(2, 'active', { actorUserId: 1 }))
      .rejects.toMatchObject({ statusCode: 409, code: 'ARCHIVE_IS_TERMINAL' });
    await expect(usersService.updatePassword(2, 'new-password'))
      .rejects.toMatchObject({ statusCode: 409, code: 'ARCHIVE_IS_TERMINAL' });
  });

  test('protects the current account and the last active system owner', async () => {
    await expect(usersService.archiveUser({ targetUserId: 1, actorUserId: 1 }))
      .rejects.toMatchObject({ statusCode: 403, code: 'SELF_DEACTIVATION_FORBIDDEN' });
    await expect(usersService.archiveUser({ targetUserId: 1, actorUserId: 3 }))
      .rejects.toMatchObject({ statusCode: 409, code: 'LAST_ACTIVE_OWNER' });
    await expect(usersService.updateStatus(1, 'disabled', { actorUserId: 3 }))
      .rejects.toMatchObject({ statusCode: 409, code: 'LAST_ACTIVE_OWNER' });
  });

  test('rejects reserved usernames and races with a conflict response', async () => {
    await expect(usersService.createUser({
      username: '__archived__manual',
      password: 'password',
      fullName: 'Reserved',
      roleIds: []
    })).rejects.toMatchObject({ statusCode: 400 });

    await expect(usersService.createUser({
      username: 'owner',
      password: 'password',
      fullName: 'Duplicate',
      roleIds: []
    })).rejects.toMatchObject({ statusCode: 409, code: 'USERNAME_CONFLICT' });
  });
});
