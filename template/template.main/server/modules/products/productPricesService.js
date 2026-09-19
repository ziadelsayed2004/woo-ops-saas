const db = require('../../db');
const notificationsService = require('../notifications/notificationsService');

/**
 * Get all prices for a product, showing all active outlet types and their corresponding prices.
 */
async function getPricesForProduct(productId) {
  const sql = `
    SELECT ot.id as outletTypeId, ot.name as outletTypeName, pp.price
    FROM outlet_types ot
    LEFT JOIN product_prices pp ON pp.outlet_type_id = ot.id AND pp.product_id = ?
    WHERE ot.status = 'active'
    ORDER BY ot.name ASC
  `;
  return await db.all(sql, [productId]);
}

/**
 * Bulk update prices for a product.
 * @param {number} productId
 * @param {Array<{ outletTypeId: number, price: number|null }>} prices
 */
async function updatePricesForProduct(productId, prices) {
  if (!Array.isArray(prices)) {
    throw new Error('Prices must be an array');
  }

  // Validate that the product exists
  const product = await db.get('SELECT id FROM products WHERE id = ?', [productId]);
  if (!product) {
    throw new Error('Product not found');
  }

  for (const item of prices) {
    const { outletTypeId, price } = item;

    if (!outletTypeId) {
      throw new Error('Outlet type ID is required');
    }

    if (price === null || price === undefined || price === '') {
      // Clear price
      await db.run('DELETE FROM product_prices WHERE product_id = ? AND outlet_type_id = ?', [productId, outletTypeId]);
    } else {
      const parsedPrice = parseFloat(price);
      if (isNaN(parsedPrice) || parsedPrice < 0) {
        throw new Error('Price must be a positive number');
      }

      // Check if outlet type exists and is active
      const ot = await db.get('SELECT id, status FROM outlet_types WHERE id = ?', [outletTypeId]);
      if (!ot) {
        throw new Error(`Outlet type ID ${outletTypeId} does not exist`);
      }
      if (ot.status !== 'active') {
        throw new Error(`Outlet type ID ${outletTypeId} is inactive`);
      }

      // Save price using delete-then-insert pattern
      await db.run('DELETE FROM product_prices WHERE product_id = ? AND outlet_type_id = ?', [productId, outletTypeId]);
      await db.run(
        'INSERT INTO product_prices (product_id, outlet_type_id, price) VALUES (?, ?, ?)',
        [productId, outletTypeId, parsedPrice]
      );
    }
  }

  try {
    await notificationsService.checkProductPriceNotifications(productId);
  } catch (e) {
    console.error('Error running checkProductPriceNotifications in updatePricesForProduct:', e);
  }

  return true;
}

/**
 * Resolve price of a product for a specific outlet.
 */
async function resolvePrice(productId, outletId) {
  // Find outlet's type
  const outlet = await db.get('SELECT outlet_type_id, status FROM outlets WHERE id = ?', [outletId]);
  if (!outlet) {
    return null;
  }

  const sql = `
    SELECT price, outlet_type_id as outletTypeId
    FROM product_prices
    WHERE product_id = ? AND outlet_type_id = ?
  `;
  const priceRow = await db.get(sql, [productId, outlet.outlet_type_id]);
  if (!priceRow) {
    return null;
  }

  return {
    productId,
    outletId,
    outletTypeId: priceRow.outletTypeId,
    price: priceRow.price
  };
}

module.exports = {
  getPricesForProduct,
  updatePricesForProduct,
  resolvePrice
};
