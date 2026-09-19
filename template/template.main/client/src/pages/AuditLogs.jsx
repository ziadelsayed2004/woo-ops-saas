import React, { useState, useEffect } from 'react';
import { formatEgyptDateTime } from '../utils/formatters';
import { useAuth } from '../app/AuthContext';
import { apiClient } from '../services/apiClient';
import LoadingState from '../components/LoadingState';
import EmptyState from '../components/EmptyState';
import {
  Box,
  Typography,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Grid,
  Chip
} from '@mui/material';
import {
  Visibility as VisibilityIcon,
  FilterList as FilterListIcon
} from '@mui/icons-material';

import '../styles/AuditLogs.css';

const actionTranslations = {
  'login': 'تسجيل الدخول',
  'logout': 'تسجيل الخروج',
  'change_password': 'تغيير كلمة المرور',
  'reset_password_by_admin': 'إعادة تعيين كلمة المرور',
  'create_user': 'إنشاء مستخدم',
  'update_user': 'تحديث بيانات مستخدم',
  'disable_user': 'تعطيل حساب مستخدم',
  'enable_user': 'تفعيل حساب مستخدم',
  'archive_user': 'أرشفة حساب مستخدم',
  'update_role_permissions': 'تحديث صلاحيات الأدوار',
  'backup_db': 'إنشاء نسخة احتياطية',
  'restore_db': 'استعادة نسخة احتياطية'
};

const typeTranslations = {
  'users': 'حسابات المستخدمين',
  'roles': 'أدوار المستخدمين',
  'invoices': 'الفواتير',
  'products': 'المنتجات',
  'outlets': 'المنافذ والفروع'
};

export const AuditLogs = () => {
  const { hasPermission } = useAuth();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Filters state
  const [actionFilter, setActionFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  // Details dialog state
  const [openDialog, setOpenDialog] = useState(false);
  const [selectedLog, setSelectedLog] = useState(null);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      if (hasPermission('audit.view')) {
        let query = `/users/audit-logs?limit=50`;
        if (actionFilter) query += `&action=${actionFilter}`;
        if (typeFilter) query += `&targetType=${typeFilter}`;
        
        const data = await apiClient.get(query);
        setLogs(data);
      }
    } catch (err) {
      console.error('Failed to fetch audit logs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [actionFilter, typeFilter]);

  const handleOpenDetails = (log) => {
    setSelectedLog(log);
    setOpenDialog(true);
  };

  if (loading && logs.length === 0) {
    return <LoadingState type="skeleton" />;
  }

  return (
    <Box>
      <Typography variant="h5" sx={{ fontWeight: 'bold', mb: 3, color: 'primary.main' }}>
        سجل عمليات النظام (Audit Logs)
      </Typography>

      {/* Filter controls */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} sm={1} sx={{ display: 'flex', alignItems: 'center' }}>
            <FilterListIcon sx={{ mr: 1, color: 'text.secondary' }} />
            <Typography variant="body2" sx={{ fontWeight: 'bold' }}>تصفية:</Typography>
          </Grid>
          <Grid item xs={12} sm={4}>
            <FormControl fullWidth size="small">
              <InputLabel id="action-filter-label">نوع العملية</InputLabel>
              <Select
                labelId="action-filter-label"
                value={actionFilter}
                label="نوع العملية"
                onChange={(e) => setActionFilter(e.target.value)}
              >
                <MenuItem value="">جميع العمليات</MenuItem>
                {Object.keys(actionTranslations).map((action) => (
                  <MenuItem key={action} value={action}>
                    {actionTranslations[action]}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={4}>
            <FormControl fullWidth size="small">
              <InputLabel id="type-filter-label">القسم المستهدف</InputLabel>
              <Select
                labelId="type-filter-label"
                value={typeFilter}
                label="القسم المستهدف"
                onChange={(e) => setTypeFilter(e.target.value)}
              >
                <MenuItem value="">جميع الأقسام</MenuItem>
                {Object.keys(typeTranslations).map((type) => (
                  <MenuItem key={type} value={type}>
                    {typeTranslations[type]}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={3}>
            <Button
              variant="outlined"
              color="primary"
              fullWidth
              onClick={() => { setActionFilter(''); setTypeFilter(''); }}
            >
              إعادة تعيين الفلاتر
            </Button>
          </Grid>
        </Grid>
      </Paper>

      {logs.length === 0 ? (
        <EmptyState title="لا توجد سجلات" description="لم نتمكن من العثور على أي سجلات مطابقة للفلاتر النشطة." />
      ) : (
        <TableContainer className="scrollable-table-container" component={Paper}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell align="right" sx={{ fontWeight: 'bold' }}>التاريخ والوقت</TableCell>
                <TableCell align="right" sx={{ fontWeight: 'bold' }}>المستخدم</TableCell>
                <TableCell align="right" sx={{ fontWeight: 'bold' }}>العملية</TableCell>
                <TableCell align="right" sx={{ fontWeight: 'bold' }}>القسم المستهدف</TableCell>
                <TableCell align="right" sx={{ fontWeight: 'bold' }}>عنوان IP</TableCell>
                <TableCell align="center" sx={{ fontWeight: 'bold' }}>التفاصيل</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {logs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell align="right">
                    {formatEgyptDateTime(log.created_at)}
                  </TableCell>
                  <TableCell align="right">
                    {log.full_name || log.username || 'النظام'}
                  </TableCell>
                  <TableCell align="right">
                    <Chip
                      label={actionTranslations[log.action] || log.action}
                      color="primary"
                      variant="outlined"
                      size="small"
                    />
                  </TableCell>
                  <TableCell align="right">
                    {typeTranslations[log.target_type] || log.target_type || '-'}
                  </TableCell>
                  <TableCell align="right">
                    {log.ip_address || '-'}
                  </TableCell>
                  <TableCell align="center">
                    <IconButton color="secondary" onClick={() => handleOpenDetails(log)} title="عرض التفاصيل">
                      <VisibilityIcon />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Details Dialog */}
      <Dialog open={openDialog} onClose={() => setOpenDialog(false)} fullWidth maxWidth="sm">
        <DialogTitle sx={{ fontWeight: 'bold' }}>
          تفاصيل سجل العملية
        </DialogTitle>
        <DialogContent dividers>
          {selectedLog && (
            <Box sx={{ fontFamily: 'monospace', fontSize: '13px', direction: 'ltr', textAlign: 'left', backgroundColor: '#fafafa', p: 2, borderRadius: 2 }}>
              <pre className="audit-log-pre">
                {JSON.stringify(selectedLog.details, null, 2)}
              </pre>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenDialog(false)} color="secondary" sx={{ fontWeight: 'bold' }}>
            إغلاق
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default AuditLogs;
