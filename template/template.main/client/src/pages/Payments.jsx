import React, { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { formatCurrencyEGP, formatEgyptDate } from '../utils/formatters';
import { compressImageAndConvertToBase64 } from '../utils/fileCompressor';
import '../styles/Payments.css';
import { useAuth } from '../app/AuthContext';
import { apiClient } from '../services/apiClient';
import LoadingState from '../components/LoadingState';
import EmptyState from '../components/EmptyState';
import EntityDrawer from '../components/EntityDrawer';
import Returns from './Returns';
import { FormSection } from '../components/forms/FormSection';
import { FieldGrid } from '../components/forms/FieldGrid';
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
  Button,
  IconButton,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Grid,
  Alert,
  Snackbar,
  InputAdornment,
  Divider,
  Card,
  CardContent,
  Collapse,
  LinearProgress,
  Tooltip,
  Checkbox,
  Tab,
  Tabs
} from '@mui/material';
import {
  Add as AddIcon,
  Search as SearchIcon,
  Visibility as VisibilityIcon,
  Undo as UndoIcon,
  FilterList as FilterIcon,
  Clear as ClearIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  Warning as WarningIcon,
  CheckCircle as CheckCircleIcon,
  Sync as SyncIcon,
  Receipt as ReceiptIcon,
  AccountBalanceWallet as WalletIcon
} from '@mui/icons-material';

export const Payments = () => {
  const { hasPermission } = useAuth();
  const location = useLocation();
  const canReviewReceipts = hasPermission('payments.receipt.review');
  const canSupplyPayments = hasPermission('payments.mark_supplied');
  const canReverseSupply = hasPermission('payments.supply.reverse');

  // Data states
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);

  // Pagination
  const [limit, setLimit] = useState(25);
  const [offset, setOffset] = useState(0);

  // Filters
  const [showFilters, setShowFilters] = useState(false);
  const [filterInvoiceId, setFilterInvoiceId] = useState('');
  const [filterOutletId, setFilterOutletId] = useState('');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');
  const [filterSupplyStatus, setFilterSupplyStatus] = useState('');
  const [filterPaymentMethod, setFilterPaymentMethod] = useState('');

  // Dropdown list
  const [outlets, setOutlets] = useState([]);
  const [paymentMethods, setPaymentMethods] = useState([]);

  // Selections
  const [selectedPaymentIds, setSelectedPaymentIds] = useState([]);
  const [batchSubmitting, setBatchSubmitting] = useState(false);

  // Toast
  const [toastMsg, setToastMsg] = useState('');
  const [toastSeverity, setToastSeverity] = useState('success');

  // Active Tab
  const [activeTab, setActiveTab] = useState(0);

  // Add Payment Dialog
  const [openAddPayment, setOpenAddPayment] = useState(false);
  const [payFormOutletId, setPayFormOutletId] = useState('');
  const [outletInvoices, setOutletInvoices] = useState([]);
  const [loadingInvoices, setLoadingInvoices] = useState(false);
  const [payFormInvoiceId, setPayFormInvoiceId] = useState('');
  const [payFormAmount, setPayFormAmount] = useState('');
  const [payFormMethod, setPayFormMethod] = useState('cash');
  const [payFormDate, setPayFormDate] = useState(new Date().toISOString().split('T')[0]);
  const [payFormReference, setPayFormReference] = useState('');
  const [payFormNotes, setPayFormNotes] = useState('');
  const [payFormReceiptName, setPayFormReceiptName] = useState('');
  const [payFormReceiptData, setPayFormReceiptData] = useState('');
  const [payFormSupplyStatus, setPayFormSupplyStatus] = useState('not_supplied');
  const [payFormSubmitting, setPayFormSubmitting] = useState(false);
  const [payFormMetrics, setPayFormMetrics] = useState(null);
  const [payFormMetricsLoading, setPayFormMetricsLoading] = useState(false);

  // Review Queue states
  const [reviewQueue, setReviewQueue] = useState([]);
  const [reviewQueueLoading, setReviewQueueLoading] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectTargetId, setRejectTargetId] = useState(null);
  const [rejectNotes, setRejectNotes] = useState('');
  const [rejectSubmitting, setRejectSubmitting] = useState(false);

  // Review Queue filters
  const [reviewFilterOutletId, setReviewFilterOutletId] = useState('');
  const [reviewFilterInvoiceId, setReviewFilterInvoiceId] = useState('');
  const [reviewFilterStatus, setReviewFilterStatus] = useState('pending_review');

  // Invoice Metrics Detail Dialog
  const [openMetrics, setOpenMetrics] = useState(false);
  const [metricsData, setMetricsData] = useState(null);
  const [metricsPayments, setMetricsPayments] = useState([]);
  const [metricsLoading, setMetricsLoading] = useState(false);

  // Reverse Payment Dialog
  const [openReverseDialog, setOpenReverseDialog] = useState(false);
  const [reversePaymentTarget, setReversePaymentTarget] = useState(null);
  const [reverseNotes, setReverseNotes] = useState('');
  const [reverseSubmitting, setReverseSubmitting] = useState(false);

  const showToast = (msg, severity = 'success') => {
    setToastMsg(msg);
    setToastSeverity(severity);
  };

  // ---- Data fetching ----

  const fetchReviewQueue = useCallback(async () => {
    setReviewQueueLoading(true);
    try {
      let query = `/payments/receipts/review-queue?status=${reviewFilterStatus}`;
      if (reviewFilterOutletId) query += `&outletId=${reviewFilterOutletId}`;
      if (reviewFilterInvoiceId) query += `&invoiceId=${reviewFilterInvoiceId}`;
      const data = await apiClient.get(query);
      setReviewQueue(data);
    } catch (err) {
      console.error(err);
      showToast(err.message || 'فشل تحميل قائمة مراجعة الإيصالات المعلقة.', 'error');
    } finally {
      setReviewQueueLoading(false);
    }
  }, [reviewFilterStatus, reviewFilterOutletId, reviewFilterInvoiceId]);

  const handleExportReviewQueue = () => {
    if (reviewQueue.length === 0) return;
    
    const headers = ['رقم الدفعة', 'منفذ البيع', 'رقم الفاتورة', 'المبلغ', 'طريقة الدفع', 'تاريخ الدفع', 'بواسطة', 'حالة المراجعة'];
    const rows = reviewQueue.map(row => [
      row.id,
      row.outlet_name,
      row.invoice_number,
      row.amount,
      translateMethod(row.payment_method),
      row.payment_date ? formatEgyptDate(row.payment_date) : '-',
      row.recorder_full_name || 'غير معروف',
      row.receipt_status === 'pending_review' ? 'قيد المراجعة' : (row.receipt_status === 'approved' ? 'معتمد' : 'مرفوض')
    ]);

    const csvContent = "\uFEFF" 
      + [headers.join(','), ...rows.map(e => e.map(val => `"${String(val).replace(/"/g, '""')}"`).join(','))].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `مراجعة_الايصالات_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const fetchPayments = useCallback(async () => {
    setLoading(true);
    try {
      let query = `/payments?limit=${limit}&offset=${offset}`;
      if (filterInvoiceId) query += `&invoiceId=${filterInvoiceId}`;
      if (filterOutletId) query += `&outletId=${filterOutletId}`;
      if (filterStartDate) query += `&startDate=${filterStartDate}`;
      if (filterEndDate) query += `&endDate=${filterEndDate}`;
      if (filterSupplyStatus) query += `&supplyStatus=${filterSupplyStatus}`;
      if (filterPaymentMethod) query += `&paymentMethod=${filterPaymentMethod}`;

      const data = await apiClient.get(query);
      setPayments(data);
      setSelectedPaymentIds([]); // Clear selection when criteria changes
    } catch (err) {
      console.error(err);
      showToast(err.message || 'فشل تحميل سجل المدفوعات.', 'error');
    } finally {
      setLoading(false);
    }
  }, [limit, offset, filterInvoiceId, filterOutletId, filterStartDate, filterEndDate, filterSupplyStatus, filterPaymentMethod]);

  useEffect(() => {
    fetchPayments();
    if (canReviewReceipts) {
      fetchReviewQueue();
    }
  }, [fetchPayments, fetchReviewQueue, canReviewReceipts]);

  useEffect(() => {
    const fetchOutlets = async () => {
      if (!hasPermission('outlets.view')) return;
      try {
        const data = await apiClient.get('/outlets');
        setOutlets(data);
      } catch (err) {
        console.error('Failed to load outlets:', err);
      }
    };
    const fetchMethods = async () => {
      try {
        const data = await apiClient.get('/payments/methods');
        setPaymentMethods(data || []);
        setPayFormMethod(current => (data || []).some(method => method.key === current) ? current : ((data || [])[0]?.key || ''));
      } catch (err) {
        console.error('Failed to load payment methods:', err);
      }
    };
    fetchOutlets();
    fetchMethods();
  }, []);

  // Deep linking from Invoices
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const invId = params.get('invoiceId');
    const act = params.get('action');
    const amountHint = params.get('amount');
    if (invId && act === 'create' && hasPermission('payments.create')) {
      handleOpenAddPayment(invId, amountHint || '');
    }
  }, [location.search]);

  // ---- Pagination ----

  const handlePrevPage = () => {
    if (offset >= limit) setOffset(offset - limit);
  };

  const handleNextPage = () => {
    setOffset(offset + limit);
  };

  // ---- Filters ----

  const handleApplyFilters = () => {
    setOffset(0);
    fetchPayments();
  };

  const handleResetFilters = () => {
    setFilterInvoiceId('');
    setFilterOutletId('');
    setFilterStartDate('');
    setFilterEndDate('');
    setFilterSupplyStatus('');
    setOffset(0);

    setLoading(true);
    apiClient.get(`/payments?limit=${limit}&offset=0`)
      .then(data => {
        setPayments(data);
        setSelectedPaymentIds([]);
      })
      .catch(err => {
        console.error(err);
        showToast(err.message || 'فشل تحميل سجل المدفوعات.', 'error');
      })
      .finally(() => setLoading(false));
  };

  // ---- Helpers ----

  const translateMethod = (m) => {
    const method = paymentMethods.find(pm => pm.key === m);
    if (method) return method.label_ar;
    switch (m) {
      case 'cash': return 'نقدي';
      case 'check': return 'شيك';
      case 'bank_transfer': return 'تحويل بنكي';
      case 'deferred': return 'آجل';
      case 'e_wallet': return 'محفظة إلكترونية';
      default: return m || 'غير محدد';
    }
  };

  // ---- Selection ----

  const handleSelectAll = (e) => {
    if (e.target.checked) {
      setSelectedPaymentIds(payments.map(p => p.id));
    } else {
      setSelectedPaymentIds([]);
    }
  };

  const handleSelectRow = (id) => {
    setSelectedPaymentIds(prev => {
      const copy = [...prev];
      const idx = copy.indexOf(id);
      if (idx > -1) {
        copy.splice(idx, 1);
      } else {
        copy.push(id);
      }
      return copy;
    });
  };

  // ---- Actions ----

  const handleSupplyPayment = async (paymentId) => {
    try {
      await apiClient.post(`/payments/${paymentId}/supply`);
      showToast('تم تأكيد توريد الدفعة للشركة بنجاح.');
      fetchPayments();
    } catch (err) {
      console.error(err);
      showToast(err.message || 'فشل تأكيد توريد الدفعة.', 'error');
    }
  };

  const handleReverseSupply = async (paymentId) => {
    const notes = window.prompt('اكتب سبب عكس التوريد قبل التأكيد:');
    if (!notes || !notes.trim()) return;
    try {
      await apiClient.post(`/payments/${paymentId}/reverse-supply`, { notes: notes.trim() });
      showToast('تم إلغاء توريد الدفعة وإعادتها للعهد المالية.');
      fetchPayments();
    } catch (err) {
      console.error(err);
      showToast(err.message || 'فشل إلغاء توريد الدفعة.', 'error');
    }
  };

  const handleBatchSupply = async () => {
    if (selectedPaymentIds.length === 0) return;
    setBatchSubmitting(true);
    try {
      await apiClient.post('/payments/supply-batch', { paymentIds: selectedPaymentIds });
      showToast(`تم تأكيد توريد عدد ${selectedPaymentIds.length} دفعة مالية بنجاح.`);
      setSelectedPaymentIds([]);
      fetchPayments();
    } catch (err) {
      console.error(err);
      showToast(err.message || 'فشل توريد الدفعات المحددة.', 'error');
    } finally {
      setBatchSubmitting(false);
    }
  };

  // ---- Add Payment ----

  // ---- Add Payment ----

  const handlePayFormOutletChange = async (outletId) => {
    setPayFormOutletId(outletId);
    setPayFormInvoiceId('');
    setPayFormMetrics(null);
    setOutletInvoices([]);
    if (!outletId) return;

    setLoadingInvoices(true);
    try {
      const data = await apiClient.get(`/invoices?outletId=${outletId}&limit=100`);
      const activeInvoices = data.filter(inv => inv.payment_status !== 'cancelled' && inv.remaining_amount > 0);
      setOutletInvoices(activeInvoices);
    } catch (err) {
      console.error(err);
      showToast('فشل تحميل فواتير المنفذ المختار.', 'error');
    } finally {
      setLoadingInvoices(false);
    }
  };

  const handleOpenAddPayment = async (prefilledInvoiceId = '', amountHint = '') => {
    if (!hasPermission('payments.create')) {
      showToast('ليس لديك صلاحية لتسجيل المدفوعات.', 'error');
      return;
    }
    setPayFormOutletId('');
    setPayFormInvoiceId(prefilledInvoiceId ? String(prefilledInvoiceId) : '');
    setPayFormAmount(amountHint || '');
    setPayFormMethod(paymentMethods.some(method => method.key === payFormMethod) ? payFormMethod : (paymentMethods[0]?.key || ''));
    setPayFormDate(new Date().toISOString().split('T')[0]);
    setPayFormReference('');
    setPayFormNotes('');
    setPayFormSupplyStatus('not_supplied');
    setPayFormReceiptName('');
    setPayFormReceiptData('');
    setPayFormMetrics(null);
    setOutletInvoices([]);
    setOpenAddPayment(true);

    if (prefilledInvoiceId) {
      setPayFormMetricsLoading(true);
      try {
        const metrics = await apiClient.get(`/payments/invoice/${prefilledInvoiceId}/metrics`);
        setPayFormMetrics(metrics);

        const invoiceDetails = await apiClient.get(`/invoices/${prefilledInvoiceId}`);
        if (invoiceDetails) {
          setPayFormOutletId(invoiceDetails.outlet_id);
          const data = await apiClient.get(`/invoices?outletId=${invoiceDetails.outlet_id}&limit=100`);
          const activeInvoices = data.filter(inv => inv.payment_status !== 'cancelled' && inv.remaining_amount > 0);
          setOutletInvoices(activeInvoices);
          if (!amountHint) {
            setPayFormAmount(String(invoiceDetails.remaining_amount));
          }
        }
      } catch (err) {
        console.error('Failed to prefill invoice details:', err);
      } finally {
        setPayFormMetricsLoading(false);
      }
    }
  };

  const loadPayFormMetrics = async (invoiceId) => {
    if (!invoiceId) {
      setPayFormMetrics(null);
      return;
    }
    setPayFormMetricsLoading(true);
    try {
      const data = await apiClient.get(`/payments/invoice/${invoiceId}/metrics`);
      setPayFormMetrics(data);
    } catch (err) {
      console.error(err);
      setPayFormMetrics(null);
    } finally {
      setPayFormMetricsLoading(false);
    }
  };

  const handlePayFormInvoiceBlur = () => {
    const id = parseInt(payFormInvoiceId, 10);
    if (id > 0) loadPayFormMetrics(id);
    else setPayFormMetrics(null);
  };

  const handleSubmitPayment = async (e) => {
    e.preventDefault();
    if (!hasPermission('payments.create')) {
      showToast('ليس لديك صلاحية لتسجيل المدفوعات.', 'error');
      return;
    }
    if (!payFormInvoiceId || !payFormAmount || !payFormMethod) {
      showToast('رقم الفاتورة والمبلغ وطريقة الدفع مطلوبة.', 'error');
      return;
    }
    setPayFormSubmitting(true);
    try {
      await apiClient.post('/payments', {
        invoiceId: parseInt(payFormInvoiceId, 10),
        amount: parseFloat(payFormAmount),
        paymentMethod: payFormMethod,
        paymentDate: payFormDate || undefined,
        referenceNumber: payFormReference,
        notes: payFormNotes,
        supplyStatus: payFormSupplyStatus,
        receiptName: payFormReceiptName || undefined,
        receiptData: payFormReceiptData || undefined
      });
      showToast('تم تسجيل الدفعة بنجاح وتحديث حالة الفاتورة.');
      setOpenAddPayment(false);
      fetchPayments();
    } catch (err) {
      console.error(err);
      showToast(err.message || 'فشل تسجيل الدفعة.', 'error');
    } finally {
      setPayFormSubmitting(false);
    }
  };

  // ---- Review Receipts ----

  const handleApproveReceipt = async (paymentId) => {
    try {
      await apiClient.post(`/payments/${paymentId}/review`, { action: 'approve' });
      showToast('تم اعتماد إيصال الدفع بنجاح وتأثير الدفعة مالياً.');
      fetchPayments();
      fetchReviewQueue();
    } catch (err) {
      console.error(err);
      showToast(err.message || 'فشل اعتماد الإيصال.', 'error');
    }
  };

  const handleOpenReject = (paymentId) => {
    setRejectTargetId(paymentId);
    setRejectNotes('');
    setRejectDialogOpen(true);
  };

  const handleSubmitReject = async () => {
    if (!rejectTargetId) return;
    setRejectSubmitting(true);
    try {
      await apiClient.post(`/payments/${rejectTargetId}/review`, {
        action: 'reject',
        notes: rejectNotes
      });
      showToast('تم رفض إيصال الدفع وإخطار المسؤول بالسبب.');
      setRejectDialogOpen(false);
      fetchPayments();
      fetchReviewQueue();
    } catch (err) {
      console.error(err);
      showToast(err.message || 'فشل رفض الإيصال.', 'error');
    } finally {
      setRejectSubmitting(false);
    }
  };

  // ---- Reverse Payment ----

  const handleOpenReverse = (payment) => {
    setReversePaymentTarget(payment);
    setReverseNotes('');
    setOpenReverseDialog(true);
  };

  const handleSubmitReverse = async () => {
    if (!reversePaymentTarget) return;
    setReverseSubmitting(true);
    try {
      await apiClient.post(`/payments/${reversePaymentTarget.id}/reverse`, {
        notes: reverseNotes
      });
      showToast('تم إلغاء/عكس الدفعة وإعادة حساب رصيد الفاتورة بنجاح.');
      setOpenReverseDialog(false);
      fetchPayments();
    } catch (err) {
      console.error(err);
      showToast(err.message || 'فشل عكس الدفعة.', 'error');
    } finally {
      setReverseSubmitting(false);
    }
  };

  // ---- Invoice Metrics Viewer ----

  const handleOpenMetrics = async (invoiceId) => {
    setMetricsData(null);
    setMetricsPayments([]);
    setMetricsLoading(true);
    setOpenMetrics(true);
    try {
      const data = await apiClient.get(`/payments/invoice/${invoiceId}/metrics`);
      setMetricsData(data);
      const history = await apiClient.get(`/payments?invoiceId=${invoiceId}&limit=100`);
      setMetricsPayments(history);
    } catch (err) {
      console.error(err);
      showToast(err.message || 'فشل تحميل بيانات تحصيلات الفاتورة.', 'error');
      setOpenMetrics(false);
    } finally {
      setMetricsLoading(false);
    }
  };

  return (
    <Box sx={{ p: 1 }}>
      {/* Title & Top Action Bar */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="h5" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
          سجل المدفوعات والتحصيل
        </Typography>

        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
          {activeTab === 0 && hasPermission('payments.create') && (
            <Button
              variant="contained"
              color="primary"
              startIcon={<AddIcon />}
              onClick={() => handleOpenAddPayment()}
            >
              تسجيل دفعة جديدة
            </Button>
          )}
          {activeTab === 2 && canReviewReceipts && reviewQueue.length > 0 && (
            <Button
              variant="outlined"
              color="secondary"
              onClick={handleExportReviewQueue}
            >
              تصدير المراجعة للـ CSV
            </Button>
          )}
        </Box>
      </Box>

      {/* Tabs Menu */}
      <Tabs
        value={activeTab}
        onChange={(e, newValue) => setActiveTab(newValue)}
        sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}
        textColor="primary"
        indicatorColor="primary"
      >
        <Tab value={0} label="سجل المقبوضات والتحصيل" />
        {hasPermission('returns.view') && <Tab value={1} label="المرتجعات المالية" />}
        {canReviewReceipts && <Tab value={2} label="مراجعة إيصالات الدفع المعلقة" />}
      </Tabs>

      {activeTab === 0 && (
        <>
          {/* Expandable Filters */}
      <Card sx={{ mb: 3 }}>
        <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
          <Box
            sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
            onClick={() => setShowFilters(!showFilters)}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <FilterIcon color="action" />
              <Typography variant="subtitle1" className="filter-panel-title" sx={{ fontWeight: 'bold' }}>
                خيارات البحث والتصفية
              </Typography>
            </Box>
            <IconButton size="small">
              {showFilters ? <ExpandLessIcon /> : <ExpandMoreIcon />}
            </IconButton>
          </Box>

          <Collapse in={showFilters} sx={{ mt: 2 }}>
            <Divider sx={{ my: 1.5 }} />
            <Grid container spacing={2} alignItems="center" className="filter-grid">
              <Grid item xs={12} sm={4} md={3}>
                <TextField
                  fullWidth
                  label="رقم الفاتورة (Invoice ID)"
                  size="small"
                  type="number"
                  value={filterInvoiceId}
                  onChange={(e) => setFilterInvoiceId(e.target.value)}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchIcon fontSize="small" />
                      </InputAdornment>
                    )
                  }}
                />
              </Grid>
              <Grid item xs={12} sm={4} md={3}>
                <FormControl fullWidth size="small">
                  <InputLabel id="filter-outlet-pay-select-label">منفذ البيع (Outlet)</InputLabel>
                  <Select
                    labelId="filter-outlet-pay-select-label"
                    value={filterOutletId}
                    onChange={(e) => setFilterOutletId(e.target.value)}
                    label="منفذ البيع (Outlet)"
                  >
                    <MenuItem value="">الكل (All Outlets)</MenuItem>
                    {outlets.map(o => (
                      <MenuItem key={o.id} value={o.id}>{o.name}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              {canSupplyPayments && <Grid item xs={12} sm={4} md={2}>
                <FormControl fullWidth size="small">
                  <InputLabel id="filter-supply-pay-select-label">حالة التوريد</InputLabel>
                  <Select
                    labelId="filter-supply-pay-select-label"
                    value={filterSupplyStatus}
                    onChange={(e) => setFilterSupplyStatus(e.target.value)}
                    label="حالة التوريد"
                  >
                    <MenuItem value="">الكل</MenuItem>
                    <MenuItem value="supplied">موردة للشركة</MenuItem>
                    <MenuItem value="not_supplied">غير موردة (مع المندوب)</MenuItem>
                  </Select>
                </FormControl>
              </Grid>}
              <Grid item xs={12} sm={4} md={2}>
                <FormControl fullWidth size="small">
                  <InputLabel id="filter-payment-method-select-label">طريقة الدفع</InputLabel>
                  <Select
                    labelId="filter-payment-method-select-label"
                    value={filterPaymentMethod}
                    onChange={(e) => setFilterPaymentMethod(e.target.value)}
                    label="طريقة الدفع"
                  >
                    <MenuItem value="">الكل</MenuItem>
                    {paymentMethods.map(m => (
                      <MenuItem key={m.key} value={m.key}>{m.label_ar}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={6} sm={3} md={2}>
                <TextField
                  fullWidth
                  label="من تاريخ"
                  size="small"
                  type="date"
                  InputLabelProps={{ shrink: true }}
                  InputProps={{ notched: true }}
                  value={filterStartDate}
                  onChange={(e) => setFilterStartDate(e.target.value)}
                />
              </Grid>
              <Grid item xs={6} sm={3} md={2}>
                <TextField
                  fullWidth
                  label="إلى تاريخ"
                  size="small"
                  type="date"
                  InputLabelProps={{ shrink: true }}
                  InputProps={{ notched: true }}
                  value={filterEndDate}
                  onChange={(e) => setFilterEndDate(e.target.value)}
                />
              </Grid>
              <Grid item xs={12} sx={{ display: 'flex', gap: 1, mt: 1 }}>
                <Button variant="contained" color="secondary" startIcon={<FilterIcon />} onClick={handleApplyFilters}>
                  تطبيق التصفية
                </Button>
                <Button variant="outlined" color="inherit" startIcon={<ClearIcon />} onClick={() => {
                  setFilterInvoiceId('');
                  setFilterOutletId('');
                  setFilterStartDate('');
                  setFilterEndDate('');
                  setFilterSupplyStatus('');
                  setFilterPaymentMethod('');
                  handleApplyFilters();
                }}>
                  إعادة تعيين
                </Button>
              </Grid>
            </Grid>
          </Collapse>
        </CardContent>
      </Card>

      {/* Bulk Action Header Banner */}
      {selectedPaymentIds.length > 0 && (
        <Box sx={{ mb: 2, p: 1.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'action.hover', borderRadius: 1 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
            تم تحديد {selectedPaymentIds.length} دفعة مالية
          </Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
            {hasPermission('payments.supply_batch') && (
              <Button
                variant="contained"
                color="success"
                size="small"
                startIcon={<CheckCircleIcon />}
                onClick={handleBatchSupply}
                disabled={batchSubmitting}
              >
                تأكيد توريد الدفعات المحددة ({selectedPaymentIds.length})
              </Button>
            )}
            <Button variant="outlined" color="inherit" size="small" onClick={() => setSelectedPaymentIds([])}>
              إلغاء التحديد
            </Button>
          </Box>
        </Box>
      )}

      {/* Summary Stats Row */}
      {!loading && payments.length > 0 && (
        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid item xs={12} sm={4}>
            <Card sx={{ backgroundColor: 'success.light', color: 'success.contrastText' }}>
              <CardContent sx={{ py: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                  <WalletIcon />
                  <Typography variant="subtitle2">إجمالي الدفعات المعروضة</Typography>
                </Box>
                <Typography variant="h5" sx={{ fontWeight: 'bold' }}>
                  {formatCurrencyEGP(payments.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0))}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={4}>
            <Card sx={{ backgroundColor: 'primary.light', color: 'primary.contrastText' }}>
              <CardContent sx={{ py: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                  <ReceiptIcon />
                  <Typography variant="subtitle2">عدد الدفعات</Typography>
                </Box>
                <Typography variant="h5" sx={{ fontWeight: 'bold' }}>
                  {payments.length}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={4}>
            <Card sx={{ backgroundColor: 'warning.light', color: 'warning.contrastText' }}>
              <CardContent sx={{ py: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                  <CheckCircleIcon />
                  <Typography variant="subtitle2">فواتير مشمولة</Typography>
                </Box>
                <Typography variant="h5" sx={{ fontWeight: 'bold' }}>
                  {new Set(payments.map(p => p.invoice_id)).size}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {/* Main Payments Table */}
      <Paper className="main-table-paper">
        {loading ? (
          <LoadingState message="جاري تحميل سجل المدفوعات..." />
        ) : payments.length === 0 ? (
          <EmptyState
            title="لا يوجد دفعات مسجلة"
            description="لم يتم تسجيل أي دفعات بعد، أو لا توجد دفعات تطابق معايير التصفية."
          />
        ) : (
          <TableContainer className="scrollable-table-container" sx={{ maxHeight: 600 }}>
            <Table stickyHeader size="small">
              <TableHead>
                <TableRow>
                  {hasPermission('payments.supply_batch') && (
                    <TableCell padding="checkbox">
                      <Checkbox
                        color="primary"
                        indeterminate={selectedPaymentIds.length > 0 && selectedPaymentIds.length < payments.length}
                        checked={payments.length > 0 && selectedPaymentIds.length === payments.length}
                        onChange={handleSelectAll}
                      />
                    </TableCell>
                  )}
                  <TableCell sx={{ fontWeight: 'bold' }}>#</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>رقم الفاتورة</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>تاريخ الدفع</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>طريقة الدفع</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 'bold' }}>المبلغ</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>المرجع</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>سجّلت بواسطة</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>ملاحظات</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>حالة التوريد</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>الإيصال</TableCell>
                  <TableCell align="center" sx={{ fontWeight: 'bold', minWidth: 160 }}>خيارات</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {payments.map((row) => (
                  <TableRow key={row.id} hover>
                    {hasPermission('payments.supply_batch') && (
                      <TableCell padding="checkbox">
                        <Checkbox
                          color="primary"
                          checked={selectedPaymentIds.includes(row.id)}
                          onChange={() => handleSelectRow(row.id)}
                        />
                      </TableCell>
                    )}
                    <TableCell sx={{ fontFamily: 'monospace' }}>{row.id}</TableCell>
                    <TableCell>
                      <Chip
                        label={row.invoice_number}
                        size="small"
                        color="primary"
                        variant="outlined"
                        sx={{ fontFamily: 'monospace', cursor: 'pointer' }}
                        onClick={() => handleOpenMetrics(row.invoice_id)}
                      />
                    </TableCell>
                    <TableCell>
                      {row.payment_date
                        ? formatEgyptDate(row.payment_date)
                        : '-'}
                    </TableCell>
                    <TableCell>{translateMethod(row.payment_method)}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 'bold', color: 'success.main' }}>
                      {formatCurrencyEGP(row.amount)}
                    </TableCell>
                    <TableCell sx={{ fontFamily: 'monospace', color: 'text.secondary' }}>
                      {row.reference_number || '-'}
                    </TableCell>
                    <TableCell>{row.user_full_name || 'غير معروف'}</TableCell>
                    <TableCell sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {row.notes || '-'}
                    </TableCell>
                    <TableCell>
                      {row.supply_status === 'supplied' ? (
                        <Chip label="تم توريدها للخزينة" color="success" size="small" />
                      ) : (
                        <Chip label="مع المندوب (لم تورد)" color="warning" size="small" variant="outlined" />
                      )}
                    </TableCell>
                    <TableCell>
                      {hasPermission('payments.receipt.view') && row.receipt_stored_path ? (
                        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 0.5 }}>
                          <Chip label="تم رفع الإيصال" color="info" size="small" variant="outlined" sx={{ height: 20, fontSize: '0.7rem' }} />
                          <Button 
                            size="small" 
                            variant="outlined" 
                            color="primary"
                            startIcon={<ReceiptIcon sx={{ fontSize: '0.9rem !important' }} />}
                            onClick={() => window.open(`/api/payments/${row.id}/receipt`, '_blank')}
                            sx={{ py: 0.5, px: 1.5, fontSize: '0.75rem', borderRadius: '4px' }}
                          >
                            عرض الإيصال
                          </Button>
                        </Box>
                      ) : (
                        <Chip label="لا يوجد إيصال" size="small" variant="outlined" sx={{ height: 20, fontSize: '0.7rem', color: 'text.secondary', borderColor: 'divider' }} />
                      )}
                    </TableCell>
                    <TableCell align="center">
                      <Tooltip title="عرض تفاصيل تحصيلات الفاتورة">
                        <IconButton color="primary" onClick={() => handleOpenMetrics(row.invoice_id)}>
                          <VisibilityIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>

                      {canSupplyPayments && !row.reversed_at && row.supply_status !== 'supplied' && (
                        <Tooltip title="تأكيد توريد المقبوضات للشركة">
                          <IconButton color="success" onClick={() => handleSupplyPayment(row.id)}>
                            <CheckCircleIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}

                      {canReverseSupply && !row.reversed_at && row.supply_status === 'supplied' && (
                        <Tooltip title="إلغاء التوريد المالي">
                          <IconButton color="warning" onClick={() => handleReverseSupply(row.id)}>
                            <UndoIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}

                      {hasPermission('payments.reverse') && !row.reversed_at && (row.supply_status !== 'supplied' || canReverseSupply) && (
                        <Tooltip title="إلغاء / عكس هذه الدفعة">
                          <IconButton color="error" onClick={() => handleOpenReverse(row)}>
                            <UndoIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}

        <Box className="payments-pagination-container">
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="body2" color="textSecondary">عدد السجلات بالصفحة:</Typography>
            <Select
              size="small"
              value={limit}
              onChange={(e) => { setLimit(e.target.value); setOffset(0); }}
              sx={{ minWidth: 70 }}
            >
              <MenuItem value={10}>10</MenuItem>
              <MenuItem value={25}>25</MenuItem>
              <MenuItem value={50}>50</MenuItem>
              <MenuItem value={100}>100</MenuItem>
            </Select>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Button size="small" disabled={offset === 0} onClick={handlePrevPage}>السابق</Button>
            <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
              ({offset + 1} - {offset + payments.length})
            </Typography>
            <Button size="small" disabled={payments.length < limit} onClick={handleNextPage}>التالي</Button>
          </Box>
        </Box>
      </Paper>
    </>
      )}

      {activeTab === 1 && hasPermission('returns.view') && <Returns standalone={false} />}

      {activeTab === 2 && canReviewReceipts && (
        <Paper className="main-table-paper">
          {reviewQueueLoading ? (
            <LoadingState message="جاري تحميل قائمة المراجعة..." />
          ) : reviewQueue.length === 0 ? (
            <EmptyState
              title="لا توجد إيصالات معلقة"
              description="تم اعتماد أو رفض جميع المقبوضات وإيصالات الدفع بنجاح."
            />
          ) : (
            <TableContainer sx={{ maxHeight: 600 }}>
              <Table stickyHeader size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 'bold' }}>#</TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>منفذ البيع</TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>رقم الفاتورة</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 'bold' }}>المبلغ</TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>طريقة الدفع</TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>تاريخ الدفع</TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>بواسطة</TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>ملاحظات</TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>الإيصال</TableCell>
                    <TableCell align="center" sx={{ fontWeight: 'bold', minWidth: 150 }}>خيارات المراجعة</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {reviewQueue.map((row) => (
                    <TableRow key={row.id} hover>
                      <TableCell sx={{ fontFamily: 'monospace' }}>{row.id}</TableCell>
                      <TableCell>{row.outlet_name}</TableCell>
                      <TableCell>
                        <Chip
                          label={row.invoice_number}
                          size="small"
                          color="primary"
                          variant="outlined"
                          sx={{ fontFamily: 'monospace', cursor: 'pointer' }}
                          onClick={() => handleOpenMetrics(row.invoice_id)}
                        />
                      </TableCell>
                      <TableCell align="right" sx={{ fontWeight: 'bold', color: 'success.main' }}>
                        {formatCurrencyEGP(row.amount)}
                      </TableCell>
                      <TableCell>{translateMethod(row.payment_method)}</TableCell>
                      <TableCell>{row.payment_date ? formatEgyptDate(row.payment_date) : '-'}</TableCell>
                      <TableCell>{row.recorder_full_name || 'غير معروف'}</TableCell>
                      <TableCell>{row.notes || '-'}</TableCell>
                      <TableCell>
                        {row.receipt_stored_path ? (
                          <Button 
                            size="small" 
                            variant="outlined" 
                            color="primary"
                            startIcon={<ReceiptIcon sx={{ fontSize: '0.9rem !important' }} />}
                            onClick={() => window.open(`/api/payments/${row.id}/receipt`, '_blank')}
                          >
                            عرض الإيصال
                          </Button>
                        ) : (
                          <Chip label="لا يوجد إيصال" size="small" variant="outlined" sx={{ color: 'text.secondary' }} />
                        )}
                      </TableCell>
                      <TableCell align="center">
                        <Button
                          variant="contained"
                          color="success"
                          size="small"
                          sx={{ mr: 1, ml: 1 }}
                          onClick={() => handleApproveReceipt(row.id)}
                        >
                          اعتماد
                        </Button>
                        <Button
                          variant="contained"
                          color="error"
                          size="small"
                          onClick={() => handleOpenReject(row.id)}
                        >
                          رفض
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Paper>
      )}


      {/* ================ ADD PAYMENT Drawer ================ */}
      <EntityDrawer
        open={openAddPayment}
        onClose={() => !payFormSubmitting && setOpenAddPayment(false)}
        title="تسجيل دفعة جديدة"
        actions={
          <>
            <Button variant="outlined" color="inherit" onClick={() => setOpenAddPayment(false)} disabled={payFormSubmitting}>
              إلغاء
            </Button>
            <Button variant="contained" color="primary" type="submit" form="add-payment-form" disabled={payFormSubmitting}>
              {payFormSubmitting ? 'جاري التسجيل...' : 'تأكيد وتسجيل الدفعة'}
            </Button>
          </>
        }
      >
        <form onSubmit={handleSubmitPayment} id="add-payment-form">
          <FormSection title="تفاصيل الدفعة المالية">
            <Box sx={{ mb: 2 }}>
              <FormControl fullWidth size="small" required>
                <InputLabel id="form-outlet-pay-label">منفذ البيع (العميل)</InputLabel>
                <Select
                  labelId="form-outlet-pay-label"
                  value={payFormOutletId}
                  onChange={(e) => handlePayFormOutletChange(e.target.value)}
                  label="منفذ البيع (العميل)"
                >
                  {outlets.map(o => (
                    <MenuItem key={o.id} value={o.id}>{o.name}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>

            <Box sx={{ mb: 2 }}>
              <FormControl fullWidth size="small" required disabled={!payFormOutletId || loadingInvoices}>
                <InputLabel id="form-target-invoice-label">الفاتورة المستهدفة</InputLabel>
                <Select
                  labelId="form-target-invoice-label"
                  value={payFormInvoiceId}
                  onChange={(e) => {
                    setPayFormInvoiceId(e.target.value);
                    loadPayFormMetrics(e.target.value);
                  }}
                  label="الفاتورة المستهدفة"
                >
                  {loadingInvoices ? (
                    <MenuItem value="" disabled>جاري تحميل الفواتير...</MenuItem>
                  ) : outletInvoices.length === 0 ? (
                    <MenuItem value="" disabled>لا توجد فواتير مستحقة سداد لهذا المنفذ</MenuItem>
                  ) : (
                    outletInvoices.map(inv => (
                      <MenuItem key={inv.id} value={inv.id}>
                        فاتورة #{inv.invoice_number} ({formatCurrencyEGP(inv.remaining_amount)} متبقي)
                      </MenuItem>
                    ))
                  )}
                </Select>
              </FormControl>
            </Box>

            {/* Live invoice metrics preview */}
            {payFormMetricsLoading && <Box sx={{ mb: 2 }}><LinearProgress color="secondary" /></Box>}
            {payFormMetrics && (
              <Box sx={{ mb: 2 }}>
                <Paper variant="outlined" sx={{ p: 2, backgroundColor: '#f8fafc' }}>
                  <Grid container spacing={1}>
                    <Grid item xs={6} sm={3}>
                      <Typography variant="caption" color="textSecondary">رقم الفاتورة</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 'bold', fontFamily: 'monospace' }}>
                        {payFormMetrics.invoiceNumber}
                      </Typography>
                    </Grid>
                    <Grid item xs={6} sm={3}>
                      <Typography variant="caption" color="textSecondary">نوع الدفع</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        {translateMethod(payFormMetrics.paymentType)}
                      </Typography>
                    </Grid>
                    <Grid item xs={6} sm={3}>
                      <Typography variant="caption" color="textSecondary">إجمالي الفاتورة</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                        {formatCurrencyEGP(payFormMetrics.totalPrice)}
                      </Typography>
                    </Grid>
                    <Grid item xs={6} sm={3}>
                      <Typography variant="caption" color="textSecondary">المسدد حتى الآن</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'success.main' }}>
                        {formatCurrencyEGP(payFormMetrics.paidAmount)}
                      </Typography>
                    </Grid>
                    <Grid item xs={12}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                        <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'error.main' }}>
                          المتبقي: {formatCurrencyEGP(payFormMetrics.remainingAmount)}
                        </Typography>
                      </Box>
                      {/* Progress bar */}
                      <LinearProgress
                        variant="determinate"
                        value={payFormMetrics.totalPrice > 0
                          ? Math.min(100, (payFormMetrics.paidAmount / payFormMetrics.totalPrice) * 100)
                          : 0}
                        sx={{ mt: 1, height: 8, borderRadius: 4 }}
                        color={payFormMetrics.remainingAmount <= 0 ? 'success' : 'warning'}
                      />
                    </Grid>
                  </Grid>
                </Paper>
              </Box>
            )}

            <FieldGrid columns={2}>
              {/* Amount */}
              <TextField
                fullWidth
                required
                label="مبلغ الدفعة"
                size="small"
                type="number"
                inputProps={{ step: '0.01', min: '0.01' }}
                value={payFormAmount}
                onChange={(e) => setPayFormAmount(e.target.value)}
                InputProps={{
                  endAdornment: <InputAdornment position="end">ج.م</InputAdornment>
                }}
                helperText={
                  payFormMetrics
                    ? `الحد الأقصى المسموح: ${formatCurrencyEGP(payFormMetrics.remainingAmount)}`
                    : ''
                }
              />

              {/* Payment Method */}
              <FormControl fullWidth size="small" required>
                <InputLabel id="form-payment-method-select-label">طريقة الدفع</InputLabel>
                <Select
                  labelId="form-payment-method-select-label"
                  value={payFormMethod}
                  onChange={(e) => setPayFormMethod(e.target.value)}
                  label="طريقة الدفع"
                >
                  {paymentMethods.map(m => (
                    <MenuItem key={m.key} value={m.key}>{m.label_ar}</MenuItem>
                  ))}
                </Select>
              </FormControl>

              {/* Payment Date */}
              <TextField
                fullWidth
                label="تاريخ الدفع"
                size="small"
                type="date"
                InputLabelProps={{ shrink: true }}
                InputProps={{ notched: true }}
                value={payFormDate}
                onChange={(e) => setPayFormDate(e.target.value)}
              />

              {/* Reference Number */}
              <TextField
                fullWidth
                label="رقم مرجعي / رقم الإيصال"
                size="small"
                value={payFormReference}
                onChange={(e) => setPayFormReference(e.target.value)}
              />

              {/* Supply Status */}
              {canSupplyPayments && <FormControl fullWidth size="small" required>
                <InputLabel id="form-pay-supply-status-label">حالة التوريد للخزينة</InputLabel>
                <Select
                  labelId="form-pay-supply-status-label"
                  value={payFormSupplyStatus}
                  onChange={(e) => setPayFormSupplyStatus(e.target.value)}
                  label="حالة التوريد للخزينة"
                >
                  <MenuItem value="not_supplied">مدفوع فقط (غير مورد بعد)</MenuItem>
                  <MenuItem value="supplied">مدفوع وتم توريده للخزينة</MenuItem>
                </Select>
              </FormControl>}
            </FieldGrid>

            {/* Notes */}
            <Box sx={{ mt: 2 }}>
              <TextField
                fullWidth
                label="ملاحظات"
                size="small"
                multiline
                rows={2}
                value={payFormNotes}
                onChange={(e) => setPayFormNotes(e.target.value)}
              />
            </Box>

            {/* Receipt Upload */}
            <Box sx={{ mt: 2 }}>
              <Typography variant="body2" color="textSecondary" sx={{ mb: 1, fontWeight: 'bold' }}>
                رفع إيصال أو إثبات الدفع (اختياري - سيتم ربطه بالعملية فوراً)
              </Typography>
              <input
                accept="image/*,application/pdf"
                className="hidden-file-input"
                id="receipt-file-upload"
                type="file"
                onChange={async (e) => {
                  const file = e.target.files[0];
                  if (!file) return;
                  try {
                    const result = await compressImageAndConvertToBase64(file);
                    setPayFormReceiptName(result.name);
                    setPayFormReceiptData(result.data);
                  } catch (err) {
                    console.error('Error processing file:', err);
                    showToast('حدث خطأ أثناء معالجة الملف المرفوع.', 'error');
                  }
                }}
              />
              <label htmlFor="receipt-file-upload">
                <Button variant="outlined" component="span" startIcon={<ReceiptIcon />}>
                  {payFormReceiptName ? `تغيير المستند: ${payFormReceiptName}` : 'اختر ملف إيصال الدفع'}
                </Button>
              </label>
              {payFormReceiptName && (
                <Typography variant="caption" display="block" sx={{ mt: 0.5, color: 'textSecondary' }}>
                  الملف المحدد: {payFormReceiptName}
                </Typography>
              )}
            </Box>
          </FormSection>
        </form>
      </EntityDrawer>

      {/* ================ REVERSE PAYMENT DIALOG ================ */}
      <Dialog
        open={openReverseDialog}
        onClose={() => !reverseSubmitting && setOpenReverseDialog(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 'bold', color: 'error.main' }}>
          إلغاء / عكس دفعة
        </DialogTitle>
        <DialogContent dividers>
          {reversePaymentTarget && (
            <Box sx={{ mb: 2 }}>
              <Alert severity="warning" sx={{ mb: 2 }}>
                سيتم عكس الدفعة مع الاحتفاظ بسجلها للتدقيق وإعادة حساب رصيد الفاتورة تلقائياً.
              </Alert>
              <Typography variant="body2" sx={{ mb: 1 }}>
                <strong>رقم الدفعة:</strong> {reversePaymentTarget.id}
              </Typography>
              <Typography variant="body2" sx={{ mb: 1 }}>
                <strong>الفاتورة:</strong> {reversePaymentTarget.invoice_number}
              </Typography>
              <Typography variant="body2" sx={{ mb: 1 }}>
                <strong>المبلغ:</strong>{' '}
                <Box component="span" sx={{ color: 'error.main', fontWeight: 'bold' }}>
                  {formatCurrencyEGP(reversePaymentTarget.amount)}
                </Box>
              </Typography>
            </Box>
          )}
          <TextField
            fullWidth
            label="سبب الإلغاء / ملاحظات"
            size="small"
            multiline
            rows={2}
            value={reverseNotes}
            onChange={(e) => setReverseNotes(e.target.value)}
          />
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button variant="outlined" color="inherit" onClick={() => setOpenReverseDialog(false)} disabled={reverseSubmitting}>
            تراجع
          </Button>
          <Button variant="contained" color="error" onClick={handleSubmitReverse} disabled={reverseSubmitting || !reverseNotes.trim()}>
            {reverseSubmitting ? 'جاري الإلغاء...' : 'تأكيد الإلغاء وعكس الدفعة'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ================ INVOICE METRICS Drawer ================ */}
      <EntityDrawer
        open={openMetrics}
        onClose={() => setOpenMetrics(false)}
        title="تفاصيل تحصيلات الفاتورة"
        loading={metricsLoading}
        actions={
          <>
            <Button onClick={() => setOpenMetrics(false)} variant="outlined">إغلاق</Button>
            {hasPermission('payments.create') && metricsData && metricsData.remainingAmount > 0 && (
              <Button
                variant="contained"
                color="secondary"
                startIcon={<AddIcon />}
                onClick={() => {
                  setOpenMetrics(false);
                  handleOpenAddPayment(metricsData.invoiceId);
                }}
              >
                تسجيل دفعة لهذه الفاتورة
              </Button>
            )}
          </>
        }
      >
        {metricsData ? (
          <Box>
            {/* Metrics Summary */}
            <Grid container spacing={2} sx={{ mb: 3 }}>
              <Grid item xs={6} sm={3}>
                <Typography variant="caption" color="textSecondary">رقم الفاتورة</Typography>
                <Typography variant="body1" sx={{ fontWeight: 'bold', fontFamily: 'monospace' }}>
                  {metricsData.invoiceNumber}
                </Typography>
              </Grid>
              <Grid item xs={6} sm={3}>
                <Typography variant="caption" color="textSecondary">نوع الدفع</Typography>
                <Typography variant="body1" sx={{ fontWeight: 500 }}>
                  {translateMethod(metricsData.paymentType)}
                </Typography>
              </Grid>
              <Grid item xs={6} sm={3}>
                <Typography variant="caption" color="textSecondary">إجمالي الفاتورة</Typography>
                <Typography variant="body1" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
                  {formatCurrencyEGP(metricsData.totalPrice)}
                </Typography>
              </Grid>
              <Grid item xs={6} sm={3}>
                <Typography variant="caption" color="textSecondary">حالة الدفع</Typography>
                <Box sx={{ mt: 0.5 }}>
                  {metricsData.paymentStatus === 'paid' && <Chip label="مدفوع كلياً" color="success" size="small" />}
                  {metricsData.paymentStatus === 'unpaid' && <Chip label="مؤجل كلياً" color="error" size="small" />}
                  {metricsData.paymentStatus === 'partially_paid' && <Chip label="مدفوع جزئياً" color="warning" size="small" />}
                  {metricsData.paymentStatus === 'overdue' && <Chip label="متأخرة" color="error" size="small" />}
                </Box>
              </Grid>
            </Grid>

            {/* Progress bar */}
            <Box sx={{ mb: 3 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                <Typography variant="body2" sx={{ color: 'success.main', fontWeight: 'bold' }}>
                  المدفوع: {formatCurrencyEGP(metricsData.paidAmount)}
                </Typography>
                <Typography variant="body2" sx={{ color: 'error.main', fontWeight: 'bold' }}>
                  المتبقي: {formatCurrencyEGP(metricsData.remainingAmount)}
                </Typography>
              </Box>
              <LinearProgress
                variant="determinate"
                value={metricsData.totalPrice > 0
                  ? Math.min(100, (metricsData.paidAmount / metricsData.totalPrice) * 100)
                  : 0}
                sx={{ height: 10, borderRadius: 5 }}
                color={metricsData.remainingAmount <= 0 ? 'success' : 'warning'}
              />
              <Typography variant="caption" color="textSecondary" sx={{ mt: 0.5, display: 'block', textAlign: 'center' }}>
                {metricsData.totalPrice > 0
                  ? `${((metricsData.paidAmount / metricsData.totalPrice) * 100).toFixed(1)}% مدفوعة`
                  : '0%'}
              </Typography>
            </Box>

            {/* Payment History List */}
            <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1, mt: 2 }}>
              سجل عمليات الدفع والتحصيل لهذه الفاتورة:
            </Typography>
            {metricsPayments.length === 0 ? (
              <Typography variant="body2" color="textSecondary">لا توجد عمليات دفع مسجلة بعد.</Typography>
            ) : (
              <TableContainer className="scrollable-table-container" component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 'bold' }}>#</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>تاريخ الدفع</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>طريقة الدفع</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 'bold' }}>المبلغ</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>المرجع</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>الإيصال</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {metricsPayments.map((p) => (
                      <TableRow key={p.id} hover>
                        <TableCell sx={{ fontFamily: 'monospace' }}>{p.id}</TableCell>
                        <TableCell>{p.payment_date ? formatEgyptDate(p.payment_date) : '-'}</TableCell>
                        <TableCell>{translateMethod(p.payment_method)}</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 'bold', color: 'success.main' }}>
                          {formatCurrencyEGP(p.amount)}
                        </TableCell>
                        <TableCell sx={{ fontFamily: 'monospace' }}>{p.reference_number || '-'}</TableCell>
                        <TableCell>
                          {p.receipt_stored_path ? (
                            <Button 
                              size="small" 
                              variant="outlined"
                              color="primary"
                              startIcon={<ReceiptIcon sx={{ fontSize: '0.9rem !important' }} />}
                              onClick={() => window.open(`/api/payments/${p.id}/receipt`, '_blank')}
                              sx={{ py: 0.5, px: 1.5, fontSize: '0.75rem', borderRadius: '4px' }}
                            >
                              عرض الإيصال
                            </Button>
                          ) : (
                            '-'
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Box>
        ) : (
          !metricsLoading && <EmptyState title="لا يوجد بيانات" description="تعذر تحميل بيانات التحصيلات." />
        )}
      </EntityDrawer>

      {/* Snackbar Toast */}
      <Snackbar
        open={!!toastMsg}
        autoHideDuration={4000}
        onClose={() => setToastMsg('')}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        <Alert onClose={() => setToastMsg('')} severity={toastSeverity} sx={{ width: '100%' }}>
          {toastMsg}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default Payments;
