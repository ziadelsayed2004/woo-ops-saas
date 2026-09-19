const INCOMPLETE_SHIPPING_STATUSES = Object.freeze(['pending', 'partially_shipped']);
const {
  RESTRICTED_INVOICE_ROLE_NAMES,
  UNRESTRICTED_INVOICE_ROLE_NAMES,
  UNRESTRICTED_INVOICE_ROLE_SET,
  hasAnyRole
} = require('../roles/roleCatalog');
const RESTRICTED_INVOICE_ROLES = RESTRICTED_INVOICE_ROLE_NAMES;
const INVOICE_VISIBILITY_BYPASS_ROLES = UNRESTRICTED_INVOICE_ROLE_NAMES;

/**
 * Build the invoice visibility scope for a user's role names.
 * Elevated roles take precedence when a user also has a restricted role.
 */
function getInvoiceVisibilityScope(roleNames = []) {
  const normalizedRoleNames = Array.isArray(roleNames) ? roleNames : [];
  const hasBypassRole = hasAnyRole(normalizedRoleNames, UNRESTRICTED_INVOICE_ROLE_SET);
  const hasFullReadRole = normalizedRoleNames.some(roleName =>
    ['readonly_viewer', 'author', 'outlet'].includes(roleName)
  );
  const restricted = normalizedRoleNames.length > 0 && !hasBypassRole && !hasFullReadRole;

  return {
    restricted,
    allowedShippingStatuses: restricted ? INCOMPLETE_SHIPPING_STATUSES : null,
    excludeCancelled: restricted
  };
}

/**
 * Check a loaded invoice against a previously computed visibility scope.
 */
function isInvoiceVisible(invoice, scope) {
  if (!invoice) return false;
  if (!scope || !scope.restricted) return true;

  const allowedShippingStatuses = scope.allowedShippingStatuses || INCOMPLETE_SHIPPING_STATUSES;
  if (!allowedShippingStatuses.includes(invoice.shipping_status)) return false;
  if (scope.excludeCancelled && invoice.payment_status === 'cancelled') return false;

  return true;
}

module.exports = {
  INCOMPLETE_SHIPPING_STATUSES,
  RESTRICTED_INVOICE_ROLES,
  INVOICE_VISIBILITY_BYPASS_ROLES,
  getInvoiceVisibilityScope,
  isInvoiceVisible
};
