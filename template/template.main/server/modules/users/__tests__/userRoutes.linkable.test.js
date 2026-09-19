const express = require('express');
const request = require('supertest');

const mockUsersService = {
  getUserPermissions: jest.fn(),
  getLinkableUsers: jest.fn()
};
const mockRolesService = {};

jest.mock('../usersService', () => mockUsersService);
jest.mock('../../roles/rolesService', () => mockRolesService);
jest.mock('../../../middleware/audit', () => ({ auditLog: () => (_req, _res, next) => next() }));
jest.mock('../../../middleware/rbac', () => ({
  requireAuth: (req, _res, next) => {
    req.session = { user: { id: 7 } };
    next();
  },
  checkPermission: () => (_req, _res, next) => next()
}));

const router = require('../userRoutes');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/users', router);
  return app;
}

describe('linkable account endpoint', () => {
  const app = createApp();

  beforeEach(() => {
    jest.clearAllMocks();
    mockUsersService.getLinkableUsers.mockResolvedValue([
      { id: 12, username: 'worker', full_name: 'Worker', status: 'active' }
    ]);
  });

  test('returns minimal active accounts for an authorized author linker', async () => {
    mockUsersService.getUserPermissions.mockResolvedValue(['authors.account_link']);

    const response = await request(app).get('/api/users/linkable?target=author');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([{ id: 12, username: 'worker', fullName: 'Worker' }]);
    expect(mockUsersService.getLinkableUsers).toHaveBeenCalledWith({ limit: 200, offset: 0, search: '' });
  });

  test('rejects a linker for the wrong resource', async () => {
    mockUsersService.getUserPermissions.mockResolvedValue(['authors.account_link']);

    const response = await request(app).get('/api/users/linkable?target=outlet');

    expect(response.status).toBe(403);
    expect(response.body.requiredPermission).toBe('outlets.account_link');
    expect(mockUsersService.getLinkableUsers).not.toHaveBeenCalled();
  });
});
