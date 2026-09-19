const express = require('express');
const request = require('supertest');

class UserServiceError extends Error {
  constructor(message, statusCode, code) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

const mockUsersService = {
  UserServiceError,
  getUserRoles: jest.fn(),
  createUser: jest.fn(),
  updateUser: jest.fn(),
  findById: jest.fn()
};
const mockRolesService = {
  getAssignableRolesByNames: jest.fn()
};

jest.mock('../usersService', () => mockUsersService);
jest.mock('../../roles/rolesService', () => mockRolesService);
jest.mock('../../../middleware/audit', () => ({ auditLog: () => (_req, _res, next) => next() }));
jest.mock('../../../middleware/rbac', () => ({
  requireAuth: (req, _res, next) => {
    req.session = { user: { id: Number(req.headers['x-actor-id'] || 1) } };
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

describe('Super Admin role assignment protection', () => {
  const app = createApp();

  beforeEach(() => {
    jest.clearAllMocks();
    mockRolesService.getAssignableRolesByNames.mockResolvedValue([{ id: 7, name: 'super_admin' }]);
    mockUsersService.createUser.mockResolvedValue({ id: 20, username: 'owner2', fullName: 'Owner Two', status: 'active' });
  });

  test('rejects granting super_admin by a non-Super Admin actor', async () => {
    mockUsersService.getUserRoles.mockResolvedValue([]);
    const response = await request(app).post('/api/users').send({
      username: 'owner2', password: 'secret', fullName: 'Owner Two', roles: ['super_admin']
    });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('SUPER_ADMIN_REQUIRED');
    expect(mockUsersService.createUser).not.toHaveBeenCalled();
  });

  test('allows a Super Admin to create another exclusive Super Admin', async () => {
    mockUsersService.getUserRoles.mockResolvedValue([{ name: 'super_admin' }]);
    const response = await request(app).post('/api/users').send({
      username: 'owner2', password: 'secret', fullName: 'Owner Two', roles: ['super_admin']
    });

    expect(response.status).toBe(201);
    expect(response.body.user.roles).toEqual(['super_admin']);
    expect(mockUsersService.createUser).toHaveBeenCalledWith(expect.objectContaining({ roleIds: [7] }));
  });

  test('rejects mixing super_admin with any other role', async () => {
    const response = await request(app).post('/api/users').send({
      username: 'owner2', password: 'secret', fullName: 'Owner Two', roles: ['super_admin', 'assistant']
    });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('SUPER_ADMIN_ROLE_EXCLUSIVE');
    expect(mockRolesService.getAssignableRolesByNames).not.toHaveBeenCalled();
  });
});
