const express = require('express');
const router = express.Router();
const productPricesService = require('./productPricesService');
const productsService = require('./productsService');
const authorsService = require('../authors/authorsService');
const usersService = require('../users/usersService');
const { hasGlobalBusinessScope } = require('../roles/roleCatalog');
const { requireAuth, checkPermission } = require('../../middleware/rbac');
const { auditLog } = require('../../middleware/audit');

// 1. GET /api/product-prices/product/:productId - Get prices for a specific product
router.get('/product/:productId', requireAuth, checkPermission('product_prices.view'), async (req, res) => {
  const productId = parseInt(req.params.productId, 10);

  try {
    const product = await productsService.findById(productId);
    if (!product) {
      return res.status(404).json({ error: 'Not Found', message: 'Product not found.' });
    }

    // Check ownership for author-scoped users
    const userId = req.session.user.id;
    const userRoles = await usersService.getUserRoles(userId);
    const isElevated = hasGlobalBusinessScope(userRoles.map(role => role.name));

    if (!isElevated) {
      const linkedAuthors = await authorsService.getLinkedAuthorsForUser(userId);
      if (linkedAuthors.length > 0) {
        const productAuthorIds = product.authors.map(a => a.id);
        const hasOwnership = productAuthorIds.some(aid => linkedAuthors.includes(aid));
        if (!hasOwnership) {
          return res.status(403).json({
            error: 'Forbidden',
            message: 'Access denied. You do not have permission to view prices for this product.'
          });
        }
      }
    }

    const prices = await productPricesService.getPricesForProduct(productId);
    res.status(200).json(prices);
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// 2. PUT /api/product-prices/product/:productId - Bulk update prices for a product
router.put('/product/:productId', requireAuth, checkPermission('product_prices.update'), auditLog('update_product_prices', 'products'), async (req, res) => {
  const productId = parseInt(req.params.productId, 10);
  const { prices } = req.body;

  if (!prices || !Array.isArray(prices)) {
    return res.status(400).json({ error: 'Bad Request', message: 'Prices must be an array.' });
  }

  try {
    const product = await productsService.findById(productId);
    if (!product) {
      return res.status(404).json({ error: 'Not Found', message: 'Product not found.' });
    }

    await productPricesService.updatePricesForProduct(productId, prices);
    const updatedPrices = await productPricesService.getPricesForProduct(productId);

    res.status(200).json({
      success: true,
      message: 'Product prices updated successfully.',
      prices: updatedPrices
    });
  } catch (err) {
    if (err.message && (err.message.includes('not found') || err.message.includes('positive number') || err.message.includes('inactive') || err.message.includes('does not exist'))) {
      return res.status(400).json({ error: 'Bad Request', message: err.message });
    }
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// 3. GET /api/product-prices/resolve - Resolve price of a book for a specific outlet
router.get('/resolve', requireAuth, checkPermission('product_prices.view'), async (req, res) => {
  const productId = parseInt(req.query.productId, 10);
  const outletId = parseInt(req.query.outletId, 10);

  if (isNaN(productId) || isNaN(outletId)) {
    return res.status(400).json({ error: 'Bad Request', message: 'productId and outletId query parameters are required.' });
  }

  try {
    const resolved = await productPricesService.resolvePrice(productId, outletId);
    if (!resolved) {
      return res.status(404).json({ error: 'Not Found', message: 'Price could not be resolved for the specified product and outlet.' });
    }
    res.status(200).json(resolved);
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

module.exports = router;
