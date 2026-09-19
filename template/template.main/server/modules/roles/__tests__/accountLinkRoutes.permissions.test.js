const express = require('express');
const request = require('supertest');

const mockAuthorsService = {
  createAuthor: jest.fn(),
  findById: jest.fn(),
  updateAuthor: jest.fn()
};
const mockOutletsService = {
  createOutlet: jest.fn(),
  findById: jest.fn(),
  updateOutlet: jest.fn(),
  getLinkedOutletsForUser: jest.fn()
};
const mockOutletTypesService = {
  findById: jest.fn()
};
const mockUsersService = {
  getUserPermissions: jest.fn(),
  getUserRoles: jest.fn(),
  findById: jest.fn()
};

jest.mock('../../authors/authorsService', () => mockAuthorsService);
jest.mock('../../outlets/outletsService', () => mockOutletsService);
jest.mock('../../outlet-types/outletTypesService', () => mockOutletTypesService);
jest.mock('../../users/usersService', () => mockUsersService);
jest.mock('../../../middleware/audit', () => ({ auditLog: () => (_req, _res, next) => next() }));
jest.mock('../../../middleware/rbac', () => ({
  requireAuth: (req, _res, next) => {
    req.session = { user: { id: 7 } };
    next();
  },
  checkPermission: required => (req, res, next) => {
    const permissions = String(req.headers['x-test-permissions'] || '').split(',').filter(Boolean);
    req.userPermissions = permissions;
    if (!permissions.includes(required)) return res.status(403).json({ requiredPermission: required });
    next();
  }
}));

const authorsRouter = require('../../authors/authorsRoutes');
const outletsRouter = require('../../outlets/outletsRoutes');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/authors', authorsRouter);
  app.use('/outlets', outletsRouter);
  return app;
}

describe('resource-specific account-link permissions', () => {
  const app = createApp();

  beforeEach(() => {
    jest.clearAllMocks();
    mockUsersService.findById.mockResolvedValue({ id: 12, status: 'active' });
    mockAuthorsService.createAuthor.mockResolvedValue({ id: 1, name: 'Author', userId: 12 });
    mockOutletsService.createOutlet.mockResolvedValue({ id: 2, name: 'Outlet', userId: 12 });
    mockOutletTypesService.findById.mockResolvedValue({ id: 3, status: 'active' });
  });

  test('allows a master-data create without an account link', async () => {
    const response = await request(app)
      .post('/authors')
      .set('x-test-permissions', 'authors.create')
      .send({ name: 'Author' });

    expect(response.status).toBe(201);
    expect(mockAuthorsService.createAuthor).toHaveBeenCalledWith(expect.objectContaining({ userId: undefined }));
  });

  test('allows an assistant account-link permission to link an active account', async () => {
    const response = await request(app)
      .post('/authors')
      .set('x-test-permissions', 'authors.create,authors.account_link')
      .send({ name: 'Author', userId: 12 });

    expect(response.status).toBe(201);
    expect(mockAuthorsService.createAuthor).toHaveBeenCalledWith(expect.objectContaining({ userId: 12 }));
  });

  test('rejects a forged account link when the narrow permission is absent', async () => {
    const response = await request(app)
      .post('/outlets')
      .set('x-test-permissions', 'outlets.create')
      .send({ name: 'Outlet', outletTypeId: 3, governorate: 'Cairo', userId: 12 });

    expect(response.status).toBe(403);
    expect(response.body.requiredPermission).toBe('outlets.account_link');
    expect(mockOutletsService.createOutlet).not.toHaveBeenCalled();
  });
});
