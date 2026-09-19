const PERMISSIONS = Object.freeze([
  'users.view', 'users.create', 'users.update', 'users.disable', 'users.archive',
  'roles.view', 'roles.manage', 'permissions.manage',
  'authors.view', 'authors.create', 'authors.update', 'authors.delete',
  'authors.account_link',
  'products.view', 'products.create', 'products.update', 'products.delete',
  'categories.view', 'categories.create', 'categories.update', 'categories.delete',
  'product_prices.view', 'product_prices.update',
  'outlet_types.view', 'outlet_types.create', 'outlet_types.update', 'outlet_types.delete',
  'outlets.view', 'outlets.create', 'outlets.update', 'outlets.delete', 'outlets.disable',
  'outlets.account_link',
  'invoices.view', 'invoices.create', 'invoices.update', 'invoices.cancel', 'invoices.export',
  'invoices.pay', 'invoices.ship', 'invoices.return', 'invoices.archive.view', 'invoices.archive', 'invoices.trash',
  'payments.view', 'payments.create', 'payments.reverse', 'payments.receipt.view', 'payments.receipt.upload',
  'payments.receipt.review', 'payments.supply.reverse',
  'payments.mark_supplied', 'payments.supply_batch',
  'payments.supply.amount', 'payments.methods.manage',
  'inventory.view', 'inventory.receipts.create', 'inventory.receipts.reverse', 'inventory.adjustments.create',
  'shipments.view', 'shipments.create', 'shipments.update',
  'returns.view', 'returns.create',
  'reports.view', 'reports.export', 'exports.run',
  'audit.view', 'settings.update',
  'backup.view', 'backup.create', 'backup.restore',
  'finance.view', 'finance.adjust', 'finance.export', 'finance.statement.view',
  'notifications.view', 'notifications.manage'
]);

const ROLE_DEFINITIONS = Object.freeze({
  super_admin: Object.freeze({
    description: 'System owner with unrestricted access',
    isSystem: true,
    isAssignable: true,
    isActive: true,
    permissions: '*'
  }),
  assistant: Object.freeze({
    description: 'Operational assistant with limited account-linking and without financial access',
    isSystem: true,
    isAssignable: true,
    isActive: true,
    permissions: Object.freeze([
      'authors.view', 'authors.create', 'authors.update', 'authors.delete',
      'authors.account_link',
      'products.view', 'products.create', 'products.update', 'products.delete',
      'categories.view', 'categories.create', 'categories.update', 'categories.delete',
      'product_prices.view', 'product_prices.update',
      'outlet_types.view', 'outlet_types.create', 'outlet_types.update', 'outlet_types.delete',
      'outlets.view', 'outlets.create', 'outlets.update', 'outlets.delete', 'outlets.disable',
      'outlets.account_link',
      'invoices.view', 'invoices.create', 'invoices.update', 'invoices.cancel', 'invoices.export',
      'invoices.ship', 'invoices.return', 'invoices.archive.view', 'invoices.archive',
      'inventory.view', 'inventory.receipts.create', 'inventory.adjustments.create',
      'shipments.view', 'shipments.create', 'shipments.update',
      'returns.view', 'returns.create',
      'reports.view', 'reports.export', 'exports.run',
      'notifications.view', 'notifications.manage'
    ])
  }),
  invoice_payment_operator: Object.freeze({
    description: 'Invoice collection operator; must be assigned with the assistant role',
    isSystem: true,
    isAssignable: true,
    isActive: true,
    permissions: Object.freeze([
      'invoices.pay',
      'payments.view', 'payments.create',
      'payments.receipt.view', 'payments.receipt.upload'
    ])
  }),
  readonly_viewer: Object.freeze({
    description: 'General read-only system monitor',
    isSystem: true,
    isAssignable: true,
    isActive: true,
    permissions: Object.freeze([
      'users.view', 'roles.view',
      'authors.view', 'products.view', 'categories.view', 'product_prices.view',
      'outlet_types.view', 'outlets.view',
      'invoices.view', 'invoices.export', 'invoices.archive.view',
      'payments.view', 'payments.receipt.view',
      'inventory.view', 'shipments.view', 'returns.view',
      'reports.view', 'reports.export', 'exports.run', 'audit.view',
      'finance.view', 'finance.export', 'finance.statement.view',
      'backup.view', 'notifications.view'
    ])
  }),
  shipping_user: Object.freeze({
    description: 'Shipping and logistics operator',
    isSystem: true,
    isAssignable: true,
    isActive: true,
    permissions: Object.freeze([
      'invoices.view', 'invoices.export', 'invoices.ship',
      'shipments.view', 'shipments.create', 'shipments.update'
    ])
  }),
  inventory_manager: Object.freeze({
    description: 'Inventory and stocktaking operator',
    isSystem: true,
    isAssignable: true,
    isActive: true,
    permissions: Object.freeze([
      'products.view', 'categories.view',
      'invoices.view', 'invoices.export',
      'inventory.view', 'inventory.receipts.create', 'inventory.adjustments.create'
    ])
  }),
  author: Object.freeze({
    description: 'Author account restricted to linked author data',
    isSystem: true,
    isAssignable: true,
    isActive: true,
    permissions: Object.freeze(['products.view', 'categories.view', 'invoices.view', 'finance.view'])
  }),
  outlet: Object.freeze({
    description: 'Outlet account restricted to linked outlet data',
    isSystem: true,
    isAssignable: true,
    isActive: true,
    permissions: Object.freeze(['invoices.view', 'invoices.export', 'payments.view', 'payments.receipt.view', 'shipments.view', 'finance.view', 'finance.statement.view'])
  }),
  admin: Object.freeze({
    description: 'Deprecated administrator role',
    isSystem: true,
    isAssignable: false,
    isActive: false,
    permissions: Object.freeze([])
  }),
  accountant: Object.freeze({
    description: 'Deprecated accountant role',
    isSystem: true,
    isAssignable: false,
    isActive: false,
    permissions: Object.freeze([])
  }),
  sales_staff: Object.freeze({
    description: 'Deprecated sales role',
    isSystem: true,
    isAssignable: false,
    isActive: false,
    permissions: Object.freeze([])
  }),
  visitor: Object.freeze({
    description: 'Deprecated visitor role',
    isSystem: true,
    isAssignable: false,
    isActive: false,
    permissions: Object.freeze([])
  })
});

const SYSTEM_ROLE_NAMES = Object.freeze(Object.keys(ROLE_DEFINITIONS));
const ASSIGNABLE_SYSTEM_ROLE_NAMES = Object.freeze(
  SYSTEM_ROLE_NAMES.filter(name => ROLE_DEFINITIONS[name].isAssignable)
);
const LEGACY_ROLE_NAMES = Object.freeze(
  SYSTEM_ROLE_NAMES.filter(name => !ROLE_DEFINITIONS[name].isActive)
);
const UNRESTRICTED_INVOICE_ROLE_NAMES = Object.freeze([
  'super_admin',
  'assistant'
]);
const RESTRICTED_INVOICE_ROLE_NAMES = Object.freeze(
  SYSTEM_ROLE_NAMES.filter(name => !UNRESTRICTED_INVOICE_ROLE_NAMES.includes(name))
);
const GLOBAL_BUSINESS_ROLE_NAMES = Object.freeze([
  'super_admin',
  'assistant',
  'readonly_viewer',
  'inventory_manager',
  'shipping_user'
]);
const ROLE_REQUIREMENTS = Object.freeze({
  invoice_payment_operator: Object.freeze(['assistant'])
});
const PROTECTED_PERMISSION_NAMES = Object.freeze([
  'users.create', 'users.update', 'users.disable', 'users.archive',
  'roles.manage', 'permissions.manage',
  'invoices.pay',
  'payments.create', 'payments.reverse', 'payments.receipt.upload',
  'payments.receipt.review', 'payments.supply.reverse',
  'payments.mark_supplied', 'payments.supply_batch',
  'payments.supply.amount', 'payments.methods.manage',
  'finance.adjust',
  'backup.create', 'backup.restore',
  'settings.update',
  'invoices.trash'
]);
const ASSISTANT_FORBIDDEN_PERMISSION_NAMES = Object.freeze([
  'users.view', 'users.create', 'users.update', 'users.disable', 'users.archive',
  'roles.view', 'roles.manage', 'permissions.manage',
  'audit.view', 'settings.update',
  'backup.view', 'backup.create', 'backup.restore',
  'finance.view', 'finance.adjust', 'finance.export', 'finance.statement.view',
  'invoices.pay',
  'payments.create', 'payments.reverse', 'payments.receipt.upload',
  'payments.receipt.review', 'payments.supply.reverse',
  'payments.mark_supplied', 'payments.supply_batch',
  'payments.supply.amount', 'payments.methods.manage',
  'invoices.trash'
]);

const SYSTEM_ROLE_SET = new Set(SYSTEM_ROLE_NAMES);
const ASSIGNABLE_SYSTEM_ROLE_SET = new Set(ASSIGNABLE_SYSTEM_ROLE_NAMES);
const LEGACY_ROLE_SET = new Set(LEGACY_ROLE_NAMES);
const UNRESTRICTED_INVOICE_ROLE_SET = new Set(UNRESTRICTED_INVOICE_ROLE_NAMES);
const RESTRICTED_INVOICE_ROLE_SET = new Set(RESTRICTED_INVOICE_ROLE_NAMES);
const GLOBAL_BUSINESS_ROLE_SET = new Set(GLOBAL_BUSINESS_ROLE_NAMES);
const PROTECTED_PERMISSION_SET = new Set(PROTECTED_PERMISSION_NAMES);
const ASSISTANT_FORBIDDEN_PERMISSION_SET = new Set(ASSISTANT_FORBIDDEN_PERMISSION_NAMES);

function isSystemRole(roleName) {
  return SYSTEM_ROLE_SET.has(roleName);
}

function isAssignableSystemRole(roleName) {
  return ASSIGNABLE_SYSTEM_ROLE_SET.has(roleName);
}

function isLegacyRole(roleName) {
  return LEGACY_ROLE_SET.has(roleName);
}

function getRolePermissions(roleName) {
  const definition = ROLE_DEFINITIONS[roleName];
  if (!definition) return null;
  return definition.permissions === '*' ? '*' : [...definition.permissions];
}

function hasAnyRole(roleNames, roleSet) {
  return Array.isArray(roleNames) && roleNames.some(roleName => roleSet.has(roleName));
}

function hasGlobalBusinessScope(roleNames) {
  return hasAnyRole(roleNames, GLOBAL_BUSINESS_ROLE_SET);
}

function validateRoleCombination(roleNames) {
  const names = new Set(roleNames);
  for (const [roleName, requiredRoles] of Object.entries(ROLE_REQUIREMENTS)) {
    if (names.has(roleName) && requiredRoles.some(requiredRole => !names.has(requiredRole))) {
      return {
        valid: false,
        roleName,
        requiredRoles: [...requiredRoles]
      };
    }
  }
  return { valid: true };
}

module.exports = {
  PERMISSIONS,
  ROLE_DEFINITIONS,
  SYSTEM_ROLE_NAMES,
  ASSIGNABLE_SYSTEM_ROLE_NAMES,
  LEGACY_ROLE_NAMES,
  UNRESTRICTED_INVOICE_ROLE_NAMES,
  RESTRICTED_INVOICE_ROLE_NAMES,
  GLOBAL_BUSINESS_ROLE_NAMES,
  ROLE_REQUIREMENTS,
  PROTECTED_PERMISSION_NAMES,
  ASSISTANT_FORBIDDEN_PERMISSION_NAMES,
  SYSTEM_ROLE_SET,
  ASSIGNABLE_SYSTEM_ROLE_SET,
  LEGACY_ROLE_SET,
  UNRESTRICTED_INVOICE_ROLE_SET,
  RESTRICTED_INVOICE_ROLE_SET,
  GLOBAL_BUSINESS_ROLE_SET,
  PROTECTED_PERMISSION_SET,
  ASSISTANT_FORBIDDEN_PERMISSION_SET,
  isSystemRole,
  isAssignableSystemRole,
  isLegacyRole,
  getRolePermissions,
  hasAnyRole,
  hasGlobalBusinessScope,
  validateRoleCombination
};
