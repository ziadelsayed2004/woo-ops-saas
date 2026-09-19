jest.mock('../../../db', () => ({
  all: jest.fn(),
  get: jest.fn(),
  run: jest.fn()
}));

const db = require('../../../db');
const notificationsService = require('../notificationsService');

describe('notification list filters', () => {
  beforeEach(() => jest.clearAllMocks());

  test('filters multiple severities and keeps newest-first pagination', async () => {
    db.all.mockResolvedValue([]);

    await notificationsService.getNotifications({
      status: 'unread',
      severities: ['critical', 'warning'],
      limit: 5,
      offset: 0
    });

    const [sql, params] = db.all.mock.calls[0];
    expect(sql).toContain('status = ?');
    expect(sql).toContain('severity IN (?,?)');
    expect(sql).toContain('ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?');
    expect(params).toEqual(['unread', 'critical', 'warning', 5, 0]);
  });

  test('keeps the existing single-severity filter compatible', async () => {
    db.all.mockResolvedValue([]);
    await notificationsService.getNotifications({ severity: 'info' });
    expect(db.all.mock.calls[0][0]).toContain('severity = ?');
    expect(db.all.mock.calls[0][1]).toEqual(['info', 50, 0]);
  });
});
