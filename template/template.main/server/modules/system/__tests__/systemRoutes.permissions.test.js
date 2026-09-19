const express = require('express');
const request = require('supertest');

jest.mock('../../../db', () => ({
  get: jest.fn().mockResolvedValue(null)
}));
jest.mock('../../../middleware/rbac', () => ({
  requireAuth: (_req, _res, next) => next(),
  checkPermission: permission => (req, res, next) => {
    if (req.allowedPermissions.has(permission)) return next();
    return res.status(403).json({ error: 'Forbidden', requiredPermission: permission });
  }
}));

const systemRouter = require('../systemRoutes');

function createApp() {
  const app = express();
  app.use((req, _res, next) => {
    req.allowedPermissions = new Set(
      String(req.headers['x-test-permissions'] || '').split(',').filter(Boolean)
    );
    next();
  });
  app.use('/api/system', systemRouter);
  return app;
}

describe('next-code permission mapping', () => {
  const app = createApp();

  test.each([
    ['product', 'products.create'],
    ['book', 'products.create'],
    ['outlet', 'outlets.create'],
    ['invoice', 'invoices.create']
  ])('%s codes require %s', async (type, permission) => {
    const denied = await request(app).get(`/api/system/next-code?type=${type}`);
    expect(denied.status).toBe(403);
    expect(denied.body.requiredPermission).toBe(permission);

    const allowed = await request(app)
      .get(`/api/system/next-code?type=${type}`)
      .set('x-test-permissions', permission);
    expect(allowed.status).toBe(200);
    expect(allowed.body.code).toMatch(/^(BOK|OUT|INV)-0000001$/);
  });
});
