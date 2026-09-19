const db = require('../../db');

/**
 * Get all active payment methods (for dropdown usage).
 */
async function getActivePaymentMethods() {
  return await db.all(
    'SELECT id, key, label_ar, label_en, sort_order FROM payment_methods WHERE is_active = 1 ORDER BY sort_order ASC, label_ar ASC'
  );
}

/**
 * Get all payment methods including disabled (for admin management).
 */
async function getAllPaymentMethods() {
  return await db.all(
    'SELECT * FROM payment_methods ORDER BY sort_order ASC, label_ar ASC'
  );
}

/**
 * Create a new payment method.
 */
async function createPaymentMethod({ key, labelAr, labelEn = null, sortOrder = 0 }) {
  if (!key || !labelAr) {
    throw new Error('key and labelAr are required');
  }

  // Validate key format (alphanumeric + underscores)
  if (!/^[a-z][a-z0-9_]*$/.test(key)) {
    throw new Error('Key must start with a letter and contain only lowercase letters, numbers, and underscores');
  }

  const existing = await db.get('SELECT id FROM payment_methods WHERE key = ?', [key]);
  if (existing) {
    throw new Error(`Payment method with key "${key}" already exists`);
  }

  const result = await db.run(
    'INSERT INTO payment_methods (key, label_ar, label_en, is_active, sort_order) VALUES (?, ?, ?, 1, ?)',
    [key.trim(), labelAr.trim(), labelEn ? labelEn.trim() : null, sortOrder]
  );

  return await db.get('SELECT * FROM payment_methods WHERE id = ?', [result.lastID]);
}

/**
 * Update a payment method.
 */
async function updatePaymentMethod(id, { labelAr, labelEn, isActive, sortOrder }) {
  const method = await db.get('SELECT * FROM payment_methods WHERE id = ?', [id]);
  if (!method) {
    throw new Error(`Payment method with ID ${id} does not exist`);
  }

  const updates = [];
  const params = [];

  if (labelAr !== undefined) {
    updates.push('label_ar = ?');
    params.push(labelAr.trim());
  }
  if (labelEn !== undefined) {
    updates.push('label_en = ?');
    params.push(labelEn ? labelEn.trim() : null);
  }
  if (isActive !== undefined) {
    updates.push('is_active = ?');
    params.push(isActive ? 1 : 0);
  }
  if (sortOrder !== undefined) {
    updates.push('sort_order = ?');
    params.push(sortOrder);
  }

  if (updates.length === 0) {
    return method;
  }

  updates.push('updated_at = CURRENT_TIMESTAMP');
  params.push(id);

  await db.run(
    `UPDATE payment_methods SET ${updates.join(', ')} WHERE id = ?`,
    params
  );

  return await db.get('SELECT * FROM payment_methods WHERE id = ?', [id]);
}

/**
 * Toggle payment method active status.
 */
async function togglePaymentMethod(id, isActive) {
  const method = await db.get('SELECT * FROM payment_methods WHERE id = ?', [id]);
  if (!method) {
    throw new Error(`Payment method with ID ${id} does not exist`);
  }

  await db.run(
    'UPDATE payment_methods SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [isActive ? 1 : 0, id]
  );

  return await db.get('SELECT * FROM payment_methods WHERE id = ?', [id]);
}

/**
 * Delete a payment method (only if no payments use it).
 */
async function deletePaymentMethod(id) {
  const method = await db.get('SELECT * FROM payment_methods WHERE id = ?', [id]);
  if (!method) {
    throw new Error(`Payment method with ID ${id} does not exist`);
  }

  // Check if any payments use this method
  const usageCount = await db.get(
    'SELECT COUNT(*) as count FROM invoice_payments WHERE payment_method = ?',
    [method.key]
  );

  if (usageCount && usageCount.count > 0) {
    throw new Error(`لا يمكن حذف طريقة الدفع "${method.label_ar}" لأنها مرتبطة بـ ${usageCount.count} عملية دفع. يمكنك تعطيلها بدلاً من ذلك.`);
  }

  await db.run('DELETE FROM payment_methods WHERE id = ?', [id]);
  return { success: true, deletedId: id };
}

/**
 * Validate that a payment method key exists and is active.
 */
async function validatePaymentMethod(key) {
  const method = await db.get(
    'SELECT id, key, is_active FROM payment_methods WHERE key = ?',
    [key]
  );
  if (!method) {
    throw new Error(`طريقة الدفع "${key}" غير موجودة`);
  }
  if (!method.is_active) {
    throw new Error(`طريقة الدفع "${key}" معطلة حالياً`);
  }
  return true;
}

module.exports = {
  getActivePaymentMethods,
  getAllPaymentMethods,
  createPaymentMethod,
  updatePaymentMethod,
  togglePaymentMethod,
  deletePaymentMethod,
  validatePaymentMethod
};
