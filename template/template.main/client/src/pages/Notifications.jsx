import React, { useState, useEffect } from 'react';
import { formatEgyptDateTime } from '../utils/formatters';
import { apiClient } from '../services/apiClient';
import LoadingState from '../components/LoadingState';
import {
  Box,
  Typography,
  Paper,
  Tabs,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Button,
  Chip,
  IconButton,
  Tooltip,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Grid,
  Pagination
} from '@mui/material';
import {
  Error as ErrorIcon,
  Warning as WarningIcon,
  Info as InfoIcon,
  CheckCircle as CheckCircleIcon,
  Drafts as ReadIcon,
  Check as ResolveIcon,
  Launch as LaunchIcon
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../app/AuthContext';

import '../styles/Notifications.css';

const categoryLabels = {
  'stock_negative': 'رصيد سالب',
  'stock_low': 'رصيد منخفض',
  'outlet_credit_limit_exceeded': 'تجاوز الحد الائتماني',
  'invoice_overdue': 'فاتورة متأخرة',
  'installment_due': 'قسط مستحق/متأخر',
  'payment_received': 'دفعة مالية مستلمة',
  'shipment_partial': 'شحن جزئي',
  'shipment_delayed': 'شحنة متأخرة',
  'finance_warning': 'تحذير مالي',
  'price_missing': 'سعر منتج غير مهيأ',
  'system': 'تنبيه نظام'
};

const severityLabels = {
  'critical': 'هام',
  'warning': 'تحذير',
  'info': 'معلومة',
  'success': 'نجاح'
};

const statusLabels = {
  'unread': 'غير مقروء',
  'read': 'مقروء',
  'resolved': 'متجاهل / مؤرشف'
};

export const Notifications = () => {
  const { hasPermission } = useAuth();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [statusTab, setStatusTab] = useState('all'); // 'all', 'unread', 'read', 'resolved'
  const [category, setCategory] = useState('');
  const [severity, setSeverity] = useState('');

  // Pagination
  const [page, setPage] = useState(1);
  const [limit] = useState(10);
  const [totalCount, setTotalCount] = useState(0);

  const fetchNotifications = async () => {
    setLoading(true);
    try {
      // 1. Get filtered list
      const queryParams = new URLSearchParams();
      queryParams.append('limit', limit);
      queryParams.append('offset', (page - 1) * limit);

      if (statusTab !== 'all') {
        queryParams.append('status', statusTab);
      }
      if (category) {
        queryParams.append('category', category);
      }
      if (severity) {
        queryParams.append('severity', severity);
      }

      const list = await apiClient.get(`/notifications?${queryParams.toString()}`);
      setNotifications(list || []);

      // 2. Fetch counts to compute total
      const counts = await apiClient.get('/notifications/counts');
      let total = 0;
      if (statusTab === 'all') {
        total = (counts.unread || 0) + (counts.read || 0) + (counts.resolved || 0);
      } else {
        total = counts[statusTab] || 0;
      }
      setTotalCount(total);
    } catch (err) {
      console.error('Error fetching notifications list:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (hasPermission('notifications.view')) {
      fetchNotifications();
    }
  }, [statusTab, category, severity, page, hasPermission]);

  const handleMarkRead = async (id) => {
    if (!hasPermission('notifications.manage')) return;
    try {
      await apiClient.patch(`/notifications/${id}/read`);
      await fetchNotifications();
    } catch (err) {
      console.error('Error marking as read:', err);
    }
  };

  const handleResolve = async (id) => {
    if (!hasPermission('notifications.manage')) return;
    try {
      await apiClient.patch(`/notifications/${id}/resolve`);
      await fetchNotifications();
    } catch (err) {
      console.error('Error resolving notification:', err);
    }
  };

  const getSeverityIcon = (sev) => {
    switch (sev) {
      case 'critical': return <ErrorIcon color="error" />;
      case 'warning': return <WarningIcon color="warning" />;
      case 'success': return <CheckCircleIcon color="success" />;
      case 'info':
      default: return <InfoIcon color="info" />;
    }
  };

  if (!hasPermission('notifications.view')) {
    return (
      <Box sx={{ p: 3 }}>
        <Paper sx={{ p: 3, textAlign: 'center' }}>
          <Typography color="error">لا تمتلك صلاحية لعرض الاشعارات.</Typography>
        </Paper>
      </Box>
    );
  }

  return (
    <Box>
      <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h5" sx={{ fontWeight: 'bold' }}>
          مركز الاشعارات وإدارة العمليات
        </Typography>
      </Box>

      {/* Filter Bar */}
      <Paper sx={{ p: 2.5, mb: 3, borderRadius: 3 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} sm={4}>
            <FormControl fullWidth size="small">
              <InputLabel>تصنيف التنبيه</InputLabel>
              <Select
                value={category}
                label="تصنيف التنبيه"
                onChange={(e) => { setCategory(e.target.value); setPage(1); }}
              >
                <MenuItem value="">الكل</MenuItem>
                {Object.entries(categoryLabels).map(([key, label]) => (
                  <MenuItem key={key} value={key}>{label}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={4}>
            <FormControl fullWidth size="small">
              <InputLabel>الأهمية / الخطورة</InputLabel>
              <Select
                value={severity}
                label="الأهمية / الخطورة"
                onChange={(e) => { setSeverity(e.target.value); setPage(1); }}
              >
                <MenuItem value="">الكل</MenuItem>
                {Object.entries(severityLabels).map(([key, label]) => (
                  <MenuItem key={key} value={key}>{label}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={4} sx={{ textAlign: 'left' }}>
            <Button variant="outlined" size="small" onClick={() => { setCategory(''); setSeverity(''); setStatusTab('all'); setPage(1); }}>
              إعادة تعيين الفلاتر
            </Button>
          </Grid>
        </Grid>
      </Paper>

      {/* Tabs */}
      <Paper sx={{ borderRadius: 3, overflow: 'hidden' }}>
        <Tabs
          value={statusTab}
          onChange={(e, newTab) => { setStatusTab(newTab); setPage(1); }}
          indicatorColor="primary"
          textColor="primary"
          variant="scrollable"
          scrollButtons="auto"
          sx={{ borderBottom: 1, borderColor: 'divider' }}
        >
          <Tab value="all" label="جميع الاشعارات" sx={{ whiteSpace: 'nowrap' }} />
          <Tab value="unread" label="غير المقروءة" sx={{ whiteSpace: 'nowrap' }} />
          <Tab value="read" label="المقروءة" sx={{ whiteSpace: 'nowrap' }} />
          <Tab value="resolved" label="المتجاهلة / المؤرشفة" sx={{ whiteSpace: 'nowrap' }} />
        </Tabs>

        {loading ? (
          <Box sx={{ py: 8 }}>
            <LoadingState message="جاري تحميل الاشعارات..." />
          </Box>
        ) : (
          <TableContainer className="scrollable-table-container">
            <Table sx={{ minWidth: 650 }} aria-label="notifications table">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ textAlign: 'right', fontWeight: 'bold' }} width={80}>الأهمية</TableCell>
                  <TableCell sx={{ textAlign: 'right', fontWeight: 'bold' }} width={120}>التصنيف</TableCell>
                  <TableCell sx={{ textAlign: 'right', fontWeight: 'bold' }}>التفاصيل والرسالة</TableCell>
                  <TableCell sx={{ textAlign: 'right', fontWeight: 'bold' }} width={160}>التاريخ</TableCell>
                  <TableCell sx={{ textAlign: 'right', fontWeight: 'bold' }} width={100}>الحالة</TableCell>
                  <TableCell sx={{ textAlign: 'center', fontWeight: 'bold' }} width={140}>الإجراءات</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {notifications.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} sx={{ textAlign: 'center', py: 6, color: 'text.secondary' }}>
                      لا توجد اشعارات تطابق خيارات البحث الحالية.
                    </TableCell>
                  </TableRow>
                ) : (
                  notifications.map((n) => (
                    <TableRow key={n.id} hover sx={{ backgroundColor: n.status === 'unread' ? 'action.hover' : 'transparent' }}>
                      <TableCell sx={{ textAlign: 'right' }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          {getSeverityIcon(n.severity)}
                          <Typography variant="caption" sx={{ fontWeight: 'bold' }}>
                            {severityLabels[n.severity]}
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell sx={{ textAlign: 'right' }}>
                        <Chip label={categoryLabels[n.category] || n.category} size="small" variant="outlined" />
                      </TableCell>
                      <TableCell sx={{ textAlign: 'right' }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: n.status === 'unread' ? 'bold' : 'normal' }}>
                          {n.title}
                        </Typography>
                        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
                          {n.message}
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ textAlign: 'right' }}>
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                          {formatEgyptDateTime(n.created_at)}
                        </Typography>
                      </TableCell>
                      <TableCell sx={{ textAlign: 'right' }}>
                        <Chip
                          label={statusLabels[n.status]}
                          size="small"
                          color={n.status === 'unread' ? 'error' : n.status === 'read' ? 'primary' : 'default'}
                        />
                      </TableCell>
                      <TableCell sx={{ textAlign: 'center' }}>
                        <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'center' }}>
                          {n.action_url && (
                            <Tooltip title="انتقال للصفحة المصدر">
                              <IconButton
                                size="small"
                                onClick={() => {
                                  const cleanUrl = n.action_url
                                    .replace(/^\/catalog\/products\/\d+/, '/inventory')
                                    .replace(/^\/operations\/outlets\/\d+/, '/outlets')
                                    .replace(/^\/finance\/invoices\/\d+/, '/invoices')
                                    .replace(/^\/finance\/payments/, '/payments')
                                    .replace(/^\/finance\/ledger/, '/finance')
                                    .replace(/^\/operations\/shipments/, '/shipments');
                                  navigate(cleanUrl);
                                }}
                              >
                                <LaunchIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          )}
                          {hasPermission('notifications.manage') && n.status === 'unread' && (
                            <Tooltip title="تحديد كمقروء">
                              <IconButton size="small" color="primary" onClick={() => handleMarkRead(n.id)}>
                                <ReadIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          )}
                          {hasPermission('notifications.manage') && n.status !== 'resolved' && (
                            <Tooltip title="تجاهل التنبيه">
                              <IconButton size="small" color="success" onClick={() => handleResolve(n.id)}>
                                <ResolveIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          )}
                        </Box>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        )}

        {/* Pagination */}
        {totalCount > limit && (
          <Box sx={{ p: 2.5, display: 'flex', justifyContent: 'center' }}>
            <Pagination
              count={Math.ceil(totalCount / limit)}
              page={page}
              onChange={(e, value) => setPage(value)}
              color="primary"
            />
          </Box>
        )}
      </Paper>
    </Box>
  );
};

export default Notifications;
