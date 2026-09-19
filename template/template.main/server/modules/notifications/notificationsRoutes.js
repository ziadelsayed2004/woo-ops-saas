const express = require('express');
const router = express.Router();
const notificationsService = require('./notificationsService');
const { requireAuth, checkPermission } = require('../../middleware/rbac');
const { auditLog } = require('../../middleware/audit');

// 1. GET /api/notifications - List/filter notifications
router.get('/', requireAuth, checkPermission('notifications.view'), async (req, res) => {
  const limit = parseInt(req.query.limit || '50', 10);
  const offset = parseInt(req.query.offset || '0', 10);
  const status = req.query.status || null;
  const category = req.query.category || null;
  const severity = req.query.severity || null;
  const severities = req.query.severities
    ? req.query.severities.split(',').map(value => value.trim()).filter(Boolean)
    : null;

  try {
    await notificationsService.checkOverdueInvoicesNotifications();
    const list = await notificationsService.getNotifications({
      limit,
      offset,
      status,
      category,
      severity,
      severities
    });
    res.status(200).json(list);
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// 2. GET /api/notifications/counts - Get counts of unread/read/resolved notifications
router.get('/counts', requireAuth, checkPermission('notifications.view'), async (req, res) => {
  try {
    await notificationsService.checkOverdueInvoicesNotifications();
    const counts = await notificationsService.getNotificationCounts();
    res.status(200).json(counts);
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// 3. PATCH /api/notifications/:id/read - Mark notification as read
router.patch('/:id/read', requireAuth, checkPermission('notifications.manage'), auditLog('notification_read', 'notification', (req) => req.params.id), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json({ error: 'Bad Request', message: 'Invalid notification ID' });
  }

  try {
    const updated = await notificationsService.markAsRead(id);
    if (!updated) {
      return res.status(404).json({ error: 'Not Found', message: 'Notification not found' });
    }
    res.status(200).json({ success: true, message: 'Notification marked as read' });
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// 4. PATCH /api/notifications/:id/resolve - Resolve notification
router.patch('/:id/resolve', requireAuth, checkPermission('notifications.manage'), auditLog('notification_resolve', 'notification', (req) => req.params.id), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json({ error: 'Bad Request', message: 'Invalid notification ID' });
  }

  try {
    const updated = await notificationsService.resolveNotification(id);
    if (!updated) {
      return res.status(404).json({ error: 'Not Found', message: 'Notification not found' });
    }
    res.status(200).json({ success: true, message: 'Notification resolved' });
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

module.exports = router;
