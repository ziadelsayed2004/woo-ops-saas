import React, { useEffect, useState } from 'react';
import { useAuth } from '../app/AuthContext';
import {
  Box,
  Typography,
  Paper,
  Button,
  Alert,
  Snackbar,
  Divider,
  Stack,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  CircularProgress,
  TableContainer,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  IconButton,
  Tooltip,
  TextField
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  SettingsBackupRestore as RestoreIcon,
  Backup as BackupIcon,
  Delete as DeleteIcon,
  CloudDownload as CloudDownloadIcon,
  Lock as LockIcon
} from '@mui/icons-material';
import { t } from '../locales/t';

export const Backups = () => {
  const { hasPermission } = useAuth();
  
  // Verification State
  const readOnlyAccess = hasPermission('backup.view') && !hasPermission('backup.create');
  const [verified, setVerified] = useState(readOnlyAccess);
  const [password, setPassword] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [authError, setAuthError] = useState('');

  // Backup State
  const [backups, setBackups] = useState([]);
  const [backupLoading, setBackupLoading] = useState(false);
  
  // Dialog Actions Confirmation
  const [confirmRestoreOpen, setConfirmRestoreOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [selectedBackupFilename, setSelectedBackupFilename] = useState('');

  // Toast State
  const [toastMsg, setToastMsg] = useState('');
  const [toastSeverity, setToastSeverity] = useState('success');

  const showToast = (msg, severity = 'success') => {
    setToastMsg(msg);
    setToastSeverity(severity);
  };

  const fetchBackups = async () => {
    setBackupLoading(true);
    try {
      const res = await fetch('/api/admin/backups');
      if (!res.ok) throw new Error('فشل جلب قائمة النسخ الاحتياطية');
      const data = await res.json();
      setBackups(data);
    } catch (err) {
      console.error(err);
      showToast(err.message, 'error');
    } finally {
      setBackupLoading(false);
    }
  };

  useEffect(() => {
    if (readOnlyAccess) fetchBackups();
  }, [readOnlyAccess]);

  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    setVerifying(true);
    setAuthError('');
    try {
      const res = await fetch('/api/admin/backups/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'كلمة المرور غير صحيحة');
      }
      setVerified(true);
      // Fetch backups immediately after verification succeeds
      setBackupLoading(true);
      const getRes = await fetch('/api/admin/backups');
      if (getRes.ok) {
        const getList = await getRes.json();
        setBackups(getList);
      }
      setBackupLoading(false);
    } catch (err) {
      setAuthError(err.message);
    } finally {
      setVerifying(false);
    }
  };

  const handleCreateBackup = async () => {
    setBackupLoading(true);
    try {
      const res = await fetch('/api/admin/backup', { method: 'POST' });
      if (!res.ok) throw new Error('فشل إنشاء نسخة احتياطية جديدة');
      const data = await res.json();
      showToast(data.message || 'تم إنشاء النسخة الاحتياطية بنجاح.', 'success');
      fetchBackups();
    } catch (err) {
      console.error(err);
      showToast(err.message, 'error');
    } finally {
      setBackupLoading(false);
    }
  };

  const handleDownloadBackup = (filename) => {
    window.open(`/api/admin/backups/${filename}/download`, '_blank');
  };

  const handleRestoreBackupClick = (filename) => {
    setSelectedBackupFilename(filename);
    setConfirmRestoreOpen(true);
  };

  const handleConfirmRestore = async () => {
    setConfirmRestoreOpen(false);
    setBackupLoading(true);
    showToast('جاري استعادة قاعدة البيانات... يرجى الانتظار.', 'info');
    try {
      const res = await fetch('/api/admin/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: selectedBackupFilename })
      });
      if (!res.ok) throw new Error('فشلت عملية استعادة قاعدة البيانات');
      const data = await res.json();
      showToast(data.message || 'تم استعادة قاعدة البيانات بنجاح. سيتم إعادة تحميل الصفحة لتطبيق التغييرات.', 'success');
      setTimeout(() => {
        window.location.reload();
      }, 2000);
    } catch (err) {
      console.error(err);
      showToast(err.message, 'error');
      setBackupLoading(false);
    }
  };

  const handleDeleteBackupClick = (filename) => {
    setSelectedBackupFilename(filename);
    setConfirmDeleteOpen(true);
  };

  const handleConfirmDelete = async () => {
    setConfirmDeleteOpen(false);
    setBackupLoading(true);
    try {
      const res = await fetch(`/api/admin/backups/${selectedBackupFilename}`, {
        method: 'DELETE'
      });
      if (!res.ok) throw new Error('فشل حذف ملف النسخة الاحتياطية');
      const data = await res.json();
      showToast(data.message || 'تم حذف ملف النسخة الاحتياطية بنجاح.', 'success');
      fetchBackups();
    } catch (err) {
      console.error(err);
      showToast(err.message, 'error');
    } finally {
      setBackupLoading(false);
    }
  };

  const formatBytes = (bytes, decimals = 2) => {
    if (!+bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
  };

  if (!verified) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '65vh' }}>
        <Paper sx={{ p: 4, maxWidth: 420, width: '100%', textAlign: 'center', borderRadius: 3, boxShadow: 4, border: '1px solid', borderColor: 'divider' }}>
          <LockIcon sx={{ fontSize: 64, color: 'primary.main', mb: 2 }} />
          <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 1, color: 'text.primary' }}>
            تأكيد الهوية للنسخ الاحتياطي
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            الرجاء إدخال كلمة المرور الخاصة بحسابك للتأكيد والدخول لإدارة النسخ الاحتياطية.
          </Typography>

          {authError && <Alert severity="error" sx={{ mb: 2, textAlign: 'right' }}>{authError}</Alert>}

          <form onSubmit={handlePasswordSubmit}>
            <TextField
              fullWidth
              type="password"
              label="كلمة المرور"
              variant="outlined"
              size="small"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={verifying}
              sx={{ mb: 3 }}
              required
              autoFocus
            />
            <Button
              fullWidth
              type="submit"
              variant="contained"
              color="primary"
              disabled={verifying}
            >
              {verifying ? 'جاري التحقق...' : 'تأكيد الدخول'}
            </Button>
          </form>
        </Paper>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 1 }}>
      <Paper sx={{ p: 3, borderRadius: 3 }} className="backup-panel">
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
              إدارة النسخ الاحتياطي واستعادة النظام
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              قم بأخذ نسخ احتياطية لقاعدة البيانات وحفظها بأمان، أو تنزيلها محلياً، أو استرجاع النظام لحالة سابقة.
            </Typography>
          </Box>
          <Stack direction="row" spacing={1}>
            <Button
              variant="outlined"
              startIcon={<RefreshIcon />}
              onClick={fetchBackups}
              disabled={backupLoading}
              size="small"
            >
              تحديث القائمة
            </Button>
            {hasPermission('backup.create') && (
              <Button
                variant="contained"
                color="success"
                startIcon={<BackupIcon />}
                onClick={handleCreateBackup}
                disabled={backupLoading}
                size="small"
              >
                إنشاء نسخة احتياطية
              </Button>
            )}
          </Stack>
        </Box>

        <Divider sx={{ my: 2 }} />

        {backupLoading && backups.length === 0 ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress size={30} />
          </Box>
        ) : backups.length === 0 ? (
          <Alert severity="info">لا توجد نسخ احتياطية مسجلة حالياً في المستودع. انقر على إنشاء نسخة احتياطية لتوليد ملف جديد.</Alert>
        ) : (
          <TableContainer component={Paper} sx={{ boxShadow: 'none', border: '1px solid', borderColor: 'divider' }}>
            <Table size="small">
              <TableHead sx={{ bgcolor: 'action.hover' }}>
                <TableRow>
                  <TableCell align="right" sx={{ fontWeight: 'bold' }}>اسم ملف النسخة الاحتياطية</TableCell>
                  <TableCell align="center" sx={{ fontWeight: 'bold' }}>تاريخ الإنشاء</TableCell>
                  <TableCell align="center" sx={{ fontWeight: 'bold' }}>الحجم</TableCell>
                  <TableCell align="center" sx={{ fontWeight: 'bold' }}>الإجراءات</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {backups.map((file) => (
                  <TableRow key={file.filename} hover>
                    <TableCell align="right" sx={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{file.filename}</TableCell>
                    <TableCell align="center" sx={{ fontSize: '0.85rem' }}>{new Date(file.createdAt).toLocaleString('ar-EG')}</TableCell>
                    <TableCell align="center" sx={{ fontSize: '0.85rem' }}>{formatBytes(file.size)}</TableCell>
                    <TableCell align="center">
                      <Stack direction="row" spacing={1} justifyContent="center">
                        <Tooltip title="تنزيل الملف">
                          <IconButton 
                            color="primary" 
                            size="small" 
                            onClick={() => handleDownloadBackup(file.filename)}
                          >
                            <CloudDownloadIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>

                        {hasPermission('backup.restore') && (
                          <Tooltip title="استعادة النظام لهذه الحالة">
                            <IconButton 
                              color="warning" 
                              size="small" 
                              onClick={() => handleRestoreBackupClick(file.filename)}
                              disabled={backupLoading}
                            >
                              <RestoreIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}

                        {hasPermission('backup.restore') && (
                          <Tooltip title="حذف النسخة الاحتياطية">
                            <IconButton 
                              color="error" 
                              size="small" 
                              onClick={() => handleDeleteBackupClick(file.filename)}
                              disabled={backupLoading}
                            >
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>

      {/* Dialog for Confirm Database Restore */}
      <Dialog open={confirmRestoreOpen} onClose={() => setConfirmRestoreOpen(false)}>
        <DialogTitle sx={{ fontWeight: 'bold' }}>تأكيد استعادة قاعدة البيانات</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 1 }}>
            هل أنت متأكد تماماً من رغبتك في استعادة قاعدة البيانات إلى النسخة المحددة؟
          </Typography>
          <Typography variant="body2" color="error.main" sx={{ fontWeight: 'bold' }}>
            تحذير: سيؤدي هذا الإجراء إلى الكتابة فوق البيانات الحالية للنظام وفقدان أي تعديلات غير محفوظة منذ أخذ هذه النسخة الاحتياطية!
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmRestoreOpen(false)} color="inherit">إلغاء</Button>
          <Button onClick={handleConfirmRestore} color="warning" variant="contained">تأكيد الاستعادة</Button>
        </DialogActions>
      </Dialog>

      {/* Dialog for Confirm Backup Delete */}
      <Dialog open={confirmDeleteOpen} onClose={() => setConfirmDeleteOpen(false)}>
        <DialogTitle sx={{ fontWeight: 'bold' }}>حذف ملف النسخة الاحتياطية</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            هل أنت متأكد من رغبتك في حذف ملف النسخة الاحتياطية بشكل نهائي من الخادم؟
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDeleteOpen(false)} color="inherit">إلغاء</Button>
          <Button onClick={handleConfirmDelete} color="error" variant="contained">حذف</Button>
        </DialogActions>
      </Dialog>

      {/* Toast Alert */}
      <Snackbar open={!!toastMsg} autoHideDuration={4000} onClose={() => setToastMsg('')}>
        <Alert severity={toastSeverity} sx={{ width: '100%' }}>{toastMsg}</Alert>
      </Snackbar>
    </Box>
  );
};

export default Backups;
