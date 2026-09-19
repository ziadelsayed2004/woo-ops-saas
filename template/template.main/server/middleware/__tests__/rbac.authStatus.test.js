function createResponse() {
  const response = {
    statusCode: 200,
    body: null,
    status: jest.fn(code => {
      response.statusCode = code;
      return response;
    }),
    json: jest.fn(body => {
      response.body = body;
      return response;
    })
  };
  return response;
}

describe('RBAC authentication status checks', () => {
  let usersService;
  let requireAuth;
  let checkPermission;
  let requireSuperAdmin;

  beforeEach(() => {
    jest.resetModules();
    usersService = {
      findById: jest.fn(),
      getUserPermissions: jest.fn(),
      getUserRoles: jest.fn()
    };
    jest.doMock('../../modules/users/usersService', () => usersService);
    ({ requireAuth, checkPermission, requireSuperAdmin } = require('../rbac'));
  });

  afterEach(() => {
    jest.dontMock('../../modules/users/usersService');
  });

  test.each(['disabled', 'archived'])('requireAuth rejects and destroys a %s account session', async status => {
    usersService.findById.mockResolvedValue({
      id: 7,
      username: 'user',
      full_name: 'User',
      status
    });
    const destroy = jest.fn(callback => callback());
    const request = { session: { user: { id: 7 }, destroy } };
    const response = createResponse();
    const next = jest.fn();

    await requireAuth(request, response, next);

    expect(response.statusCode).toBe(401);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(next).not.toHaveBeenCalled();
  });

  test('requireAuth refreshes active session identity before continuing', async () => {
    usersService.findById.mockResolvedValue({
      id: 7,
      username: 'renamed',
      full_name: 'Updated Name',
      status: 'active'
    });
    const request = { session: { user: { id: 7, username: 'old' } } };
    const response = createResponse();
    const next = jest.fn();

    await requireAuth(request, response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(request.session.user).toEqual({
      id: 7,
      username: 'renamed',
      fullName: 'Updated Name',
      status: 'active'
    });
  });

  test('checkPermission reuses the active user and enforces current grants', async () => {
    usersService.findById.mockResolvedValue({ id: 7, username: 'user', full_name: 'User', status: 'active' });
    usersService.getUserPermissions.mockResolvedValue(['products.view']);
    const request = { session: { user: { id: 7 } } };
    const response = createResponse();

    await requireAuth(request, response, jest.fn());
    const next = jest.fn();
    await checkPermission('products.update')(request, response, next);

    expect(response.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
    expect(usersService.findById).toHaveBeenCalledTimes(1);
  });

  test.each([
    [['super_admin'], 200, true],
    [['assistant'], 403, false]
  ])('requireSuperAdmin enforces the active owner role for %s', async (roleNames, expectedStatus, shouldContinue) => {
    usersService.getUserRoles.mockResolvedValue(roleNames.map(name => ({ name })));
    const request = { session: { user: { id: 7 } } };
    const response = createResponse();
    const next = jest.fn();

    await requireSuperAdmin(request, response, next);

    expect(response.statusCode).toBe(expectedStatus);
    expect(next).toHaveBeenCalledTimes(shouldContinue ? 1 : 0);
  });
});
