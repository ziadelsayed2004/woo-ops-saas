const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { requireAuth, checkPermission } = require('../../middleware/rbac');
const { auditLog } = require('../../middleware/audit');
const config = require('../../config');
const { restoreDatabase } = require('../../db');
const bcrypt = require('bcrypt');
const usersService = require('../users/usersService');

// POST /api/admin/backup - Trigger database copy/backup
router.post('/backup', requireAuth, checkPermission('backup.create'), auditLog('create_backup', 'admin'), (req, res) => {
  try {
    const dbFile = config.databasePath;
    const backupDir = config.backupDir;

    if (!fs.existsSync(dbFile)) {
      return res.status(400).json({ error: 'Bad Request', message: 'Source database file does not exist.' });
    }

    // Ensure backup directory exists
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFileName = `backup_${timestamp}.sqlite`;
    const backupPath = path.join(backupDir, backupFileName);

    // Copy SQLite database file
    fs.copyFileSync(dbFile, backupPath);

    return res.status(200).json({
      message: 'Database backup successfully created.',
      filename: backupFileName,
      path: backupPath
    });
  } catch (err) {
    return res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// GET /api/admin/backups - List backups
router.get('/backups', requireAuth, checkPermission('backup.view'), (req, res) => {
  try {
    const backupDir = config.backupDir;
    if (!fs.existsSync(backupDir)) {
      return res.status(200).json([]);
    }
    const files = fs.readdirSync(backupDir)
      .filter(file => file.startsWith('backup_') && file.endsWith('.sqlite'))
      .map(file => {
        const filePath = path.join(backupDir, file);
        const stats = fs.statSync(filePath);
        return {
          filename: file,
          size: stats.size,
          createdAt: stats.birthtime || stats.mtime
        };
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return res.status(200).json(files);
  } catch (err) {
    return res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// GET /api/admin/backups/:filename/download - Download a backup file
router.get('/backups/:filename/download', requireAuth, checkPermission('backup.view'), (req, res) => {
  try {
    const filename = req.params.filename;
    // Prevent directory traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({ error: 'Bad Request', message: 'Invalid file name.' });
    }
    const filePath = path.join(config.backupDir, filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Not Found', message: 'Backup file not found.' });
    }
    return res.download(filePath, filename);
  } catch (err) {
    return res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// POST /api/admin/restore - Restore database from backup
router.post('/restore', requireAuth, checkPermission('backup.restore'), auditLog('restore_backup', 'admin'), async (req, res) => {
  try {
    const { filename } = req.body;
    if (!filename) {
      return res.status(400).json({ error: 'Bad Request', message: 'Filename is required.' });
    }
    // Prevent directory traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({ error: 'Bad Request', message: 'Invalid file name.' });
    }
    const filePath = path.join(config.backupDir, filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Not Found', message: 'Backup file not found.' });
    }

    // Call restoreDatabase in server/db/index.js
    await restoreDatabase(filePath);

    return res.status(200).json({
      message: 'Database backup successfully restored.'
    });
  } catch (err) {
    console.error('Error during database restore:', err);
    return res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// DELETE /api/admin/backups/:filename - Delete a backup file
router.delete('/backups/:filename', requireAuth, checkPermission('backup.restore'), auditLog('delete_backup', 'admin'), (req, res) => {
  try {
    const filename = req.params.filename;
    // Prevent directory traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({ error: 'Bad Request', message: 'Invalid file name.' });
    }
    const filePath = path.join(config.backupDir, filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Not Found', message: 'Backup file not found.' });
    }

    fs.unlinkSync(filePath);

    return res.status(200).json({
      message: 'Backup file successfully deleted.'
    });
  } catch (err) {
    return res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

// POST /api/admin/backups/verify - Verify admin password before accessing backups
router.post('/backups/verify', requireAuth, checkPermission('backup.create'), async (req, res) => {
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ error: 'Bad Request', message: 'كلمة المرور مطلوبة.' });
  }

  try {
    const user = await usersService.findByUsername(req.session.user.username);
    if (!user) {
      return res.status(404).json({ error: 'Not Found', message: 'المستخدم غير موجود.' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Unauthorized', message: 'كلمة المرور غير صحيحة.' });
    }

    return res.status(200).json({ success: true, message: 'تم التحقق من كلمة المرور بنجاح.' });
  } catch (err) {
    return res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

module.exports = router;
