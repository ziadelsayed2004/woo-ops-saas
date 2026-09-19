const express = require('express');
const request = require('supertest');

jest.mock('../../../middleware/rbac', () => ({
  requireAuth: (_req, _res, next) => next(),
  checkPermission: requiredPermission => (req, res) => {
    if (req.get('x-test-permission') === requiredPermission) {
      return res.status(204).end();
    }
    return res.status(403).json({ requiredPermission });
  }
}));

jest.mock('../../../middleware/audit', () => ({
  auditLog: () => (_req, _res, next) => next()
}));

jest.mock('../../authors/authorsService', () => ({}));
jest.mock('../../categories/categoriesService', () => ({}));
jest.mock('../../outlets/outletsService', () => ({}));
jest.mock('../../outlet-types/outletTypesService', () => ({}));
jest.mock('../../users/usersService', () => ({}));
jest.mock('../../../db', () => ({}));

const authorsRouter = require('../../authors/authorsRoutes');
const categoriesRouter = require('../../categories/categoriesRoutes');
const outletsRouter = require('../../outlets/outletsRoutes');
const outletTypesRouter = require('../../outlet-types/outletTypesRoutes');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/authors', authorsRouter);
  app.use('/categories', categoriesRouter);
  app.use('/outlets', outletsRouter);
  app.use('/outlet-types', outletTypesRouter);
  return app;
}

describe('granular master-data route permissions', () => {
  const app = createApp();

  test.each([
    ['get', '/authors', 'authors.view'],
    ['post', '/authors', 'authors.create'],
    ['put', '/authors/1', 'authors.update'],
    ['delete', '/authors/1', 'authors.delete'],
    ['get', '/categories', 'categories.view'],
    ['post', '/categories', 'categories.create'],
    ['put', '/categories/1', 'categories.update'],
    ['delete', '/categories/1', 'categories.delete'],
    ['get', '/outlets', 'outlets.view'],
    ['post', '/outlets', 'outlets.create'],
    ['put', '/outlets/1', 'outlets.update'],
    ['delete', '/outlets/1', 'outlets.delete'],
    ['get', '/outlet-types', 'outlet_types.view'],
    ['post', '/outlet-types', 'outlet_types.create'],
    ['put', '/outlet-types/1', 'outlet_types.update'],
    ['delete', '/outlet-types/1', 'outlet_types.delete']
  ])('%s %s requires %s', async (method, url, permission) => {
    const allowed = await request(app)[method](url).set('x-test-permission', permission);
    expect(allowed.status).toBe(204);

    const denied = await request(app)[method](url).set('x-test-permission', 'unrelated.permission');
    expect(denied.status).toBe(403);
    expect(denied.body.requiredPermission).toBe(permission);
  });
});
