const express = require('express');
const router = express.Router();
const financeService = require('./financeService');
const outletsService = require('../outlets/outletsService');
const authorsService = require('../authors/authorsService');
const { hasGlobalBusinessScope } = require('../roles/roleCatalog');
const usersService = require('../users/usersService');
const { requireAuth, checkPermission } = require('../../middleware/rbac');
const { auditLog } = require('../../middleware/audit');

// 1. GET /api/finance/summary - Fetch general finance overview
router.get('/summary', requireAuth, checkPermission('finance.view'), async (req, res) => {
  try {
    const userId = req.session.user.id;
    const userRoles = await usersService.getUserRoles(userId);
    const isOutlet = userRoles.some(r => r.name === 'outlet');
    const isAuthor = userRoles.some(r => r.name === 'author');
    const isElevated = hasGlobalBusinessScope(userRoles.map(role => role.name));

    let filterOutletIds = null;
    let filterAuthorIds = null;

    if (isOutlet && !isElevated) {
      filterOutletIds = await outletsService.getLinkedOutletsForUser(userId);
    } else if (isAuthor && !isElevated) {
      filterAuthorIds = await authorsService.getLinkedAuthorsForUser(userId);
    } else if (!isElevated) {
      const linkedOutlets = await outletsService.getLinkedOutletsForUser(userId);
      if (linkedOutlets.length > 0) {
        filterOutletIds = linkedOutlets;
      }
      const linkedAuthors = await authorsService.getLinkedAuthorsForUser(userId);
      if (linkedAuthors.length > 0) {
        filterAuthorIds = linkedAuthors;
      }
    }

    const summary = await financeService.getFinanceSummary(filterOutletIds, filterAuthorIds);
    res.status(200).json(summary);
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// 2. GET /api/finance/balances/history - Fetch finance ledger entry logs
router.get('/balances/history', requireAuth, checkPermission('finance.view'), async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit, 10) : 50;
    const offset = req.query.offset ? parseInt(req.query.offset, 10) : 0;
    const outletId = req.query.outletId || null;
    const startDate = req.query.startDate || '';
    const endDate = req.query.endDate || '';
    const entryType = req.query.entryType || '';
    const supplyStatus = req.query.supplyStatus || '';
    const entryGroup = req.query.entryGroup || '';

    // Apply role scoping
    const { id: userId, role } = req.session.user;
    const isElevated = ['super_admin', 'admin'].includes(role);
    const isOutlet = role === 'outlet';

    let filterOutletIds = null;
    if (isOutlet && !isElevated) {
      filterOutletIds = await outletsService.getLinkedOutletsForUser(userId);
    } else if (!isElevated) {
      const linkedOutlets = await outletsService.getLinkedOutletsForUser(userId);
      if (linkedOutlets.length > 0) {
        filterOutletIds = linkedOutlets;
      }
    }

    const history = await financeService.getLedgerHistory({
      limit,
      offset,
      outletId,
      startDate,
      endDate,
      entryType,
      supplyStatus,
      entryGroup,
      outletIds: filterOutletIds
    });
    res.status(200).json(history);
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// 3. POST /api/finance/manual-adjustments - Record a manual cash or receivable adjustment
router.post('/manual-adjustments', requireAuth, checkPermission('finance.adjust'), auditLog('manual_finance_adjustment', 'finance'), async (req, res) => {
  const { outletId, amount, adjustmentType, title, notes } = req.body;

  const isOutletRequired = !['salary', 'expense'].includes(adjustmentType);

  if ((isOutletRequired && !outletId) || amount === undefined || !adjustmentType || !notes) {
    return res.status(400).json({ error: 'Bad Request', message: 'outletId (for non-salary), amount, adjustmentType, and notes are required.' });
  }

  try {
    const userId = req.session.user.id;
    const adjustment = await financeService.recordManualAdjustment({
      outletId,
      amount,
      adjustmentType,
      title,
      notes,
      userId
    });

    res.status(201).json({
      success: true,
      message: 'Manual adjustment recorded successfully.',
      adjustment
    });
  } catch (err) {
    const msg = (err.message || '').toLowerCase();
    if (msg.includes('required') || msg.includes('positive') || msg.includes('invalid') || msg.includes('not exist')) {
      return res.status(400).json({ error: 'Bad Request', message: err.message });
    }
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// 4. GET /api/finance/outlets - Get balances by outlet
router.get('/outlets', requireAuth, checkPermission('finance.view'), async (req, res) => {
  try {
    const userId = req.session.user.id;
    const userRoles = await usersService.getUserRoles(userId);
    const isOutlet = userRoles.some(r => r.name === 'outlet');
    const isElevated = hasGlobalBusinessScope(userRoles.map(role => role.name));

    let filterOutletIds = null;
    if (isOutlet && !isElevated) {
      filterOutletIds = await outletsService.getLinkedOutletsForUser(userId);
    } else if (!isElevated) {
      const linkedOutlets = await outletsService.getLinkedOutletsForUser(userId);
      if (linkedOutlets.length > 0) {
        filterOutletIds = linkedOutlets;
      }
    }

    const balances = await financeService.getBalancesByOutlet(filterOutletIds);
    res.status(200).json(balances);
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// 5. GET /api/finance/outlets/:id/statement - Fetch per-outlet statement
router.get('/outlets/:id/statement', requireAuth, checkPermission('finance.statement.view'), async (req, res) => {
  const outletId = parseInt(req.params.id, 10);
  try {
    const userId = req.session.user.id;
    const userRoles = await usersService.getUserRoles(userId);
    const isOutlet = userRoles.some(r => r.name === 'outlet');
    const isElevated = hasGlobalBusinessScope(userRoles.map(role => role.name));

    if (!isElevated) {
      if (isOutlet) {
        const linkedOutlets = await outletsService.getLinkedOutletsForUser(userId);
        if (!linkedOutlets.includes(outletId)) {
          return res.status(403).json({
            error: 'Forbidden',
            message: 'Access denied. You do not have permission to view this statement.'
          });
        }
      } else {
        const linkedOutlets = await outletsService.getLinkedOutletsForUser(userId);
        if (linkedOutlets.length > 0 && !linkedOutlets.includes(outletId)) {
          return res.status(403).json({
            error: 'Forbidden',
            message: 'Access denied. You do not have permission to view this statement.'
          });
        }
      }
    }

    const statement = await financeService.getOutletStatement(outletId);
    res.status(200).json(statement);
  } catch (err) {
    const msg = (err.message || '').toLowerCase();
    if (msg.includes('does not exist')) {
      return res.status(404).json({ error: 'Not Found', message: err.message });
    }
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// 6. GET /api/finance/governorates - Get balances by governorate
router.get('/governorates', requireAuth, checkPermission('finance.view'), async (req, res) => {
  try {
    const balances = await financeService.getBalancesByGovernorate();
    res.status(200).json(balances);
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// 6. GET /api/finance/outlet-types - Get balances by outlet type
router.get('/outlet-types', requireAuth, checkPermission('finance.view'), async (req, res) => {
  try {
    const balances = await financeService.getBalancesByOutletType();
    res.status(200).json(balances);
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

module.exports = router;
