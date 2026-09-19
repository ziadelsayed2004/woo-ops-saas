const express = require('express');
const request = require('supertest');

jest.mock('../returnsService', () => ({
  getReturns: jest.fn(),
  getReturnById: jest.fn(),
  createReturn: jest.fn()
}));
jest.mock('../../outlets/outletsService', () => ({
  getLinkedOutletsForUser: jest.fn()
}));
jest.mock('../../users/usersService', () => ({
  getUserRoles: jest.fn()
}));
jest.mock('../../../middleware/rbac', () => ({
  requireAuth: (_req, _res, next) => next(),
  checkPermission: () => (_req, _res, next) => next()
}));
jest.mock('../../../middleware/audit', () => ({
  auditLog: () => (_req, _res, next) => next()
}));

const returnsService = require('../returnsService');
const usersService = require('../../users/usersService');
const returnsRouter = require('../returnsRoutes');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { user: { id: 91 } };
    next();
  });
  app.use('/api/returns', returnsRouter);
  return app;
}

function useRoles(...roleNames) {
  usersService.getUserRoles.mockResolvedValue(roleNames.map(name => ({ name })));
}

describe('returns routes do not inherit restricted invoice visibility', () => {
  const app = createApp();

  beforeEach(() => {
    jest.clearAllMocks();
    returnsService.getReturns.mockResolvedValue([]);
    returnsService.getReturnById.mockResolvedValue({ id: 1, outlet_id: 5 });
  });

  test.each(['inventory_manager', 'shipping_user'])(
    'blocks the returns list for restricted role %s',
    async role => {
      useRoles(role);

      const response = await request(app).get('/api/returns');

      expect(response.status).toBe(403);
      expect(returnsService.getReturns).not.toHaveBeenCalled();
    }
  );

  test('blocks direct return details for a restricted role', async () => {
    useRoles('shipping_user');

    const response = await request(app).get('/api/returns/1');

    expect(response.status).toBe(403);
    expect(returnsService.getReturnById).not.toHaveBeenCalled();
  });

  test('keeps returns access unchanged when a bypass role is also present', async () => {
    useRoles('inventory_manager', 'assistant');

    const response = await request(app).get('/api/returns');

    expect(response.status).toBe(200);
    expect(returnsService.getReturns).toHaveBeenCalled();
  });
});
