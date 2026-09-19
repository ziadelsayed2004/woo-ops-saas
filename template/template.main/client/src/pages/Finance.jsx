import React, { useState, useEffect, useCallback } from 'react';
import { formatCurrencyEGP, formatEgyptDate, formatEgyptDateTime } from '../utils/formatters';
import { useAuth } from '../app/AuthContext';
import { apiClient } from '../services/apiClient';
import LoadingState from '../components/LoadingState';
import EmptyState from '../components/EmptyState';
import EntityDrawer from '../components/EntityDrawer';
import PaymentMethodsManager from '../components/finance/PaymentMethodsManager';
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
  TableFooter,
  Button,
  Grid,
  Card,
  CardContent,
  Tabs,
  Tab,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Snackbar,
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Stack,
  TablePagination,
  Divider,
  InputAdornment,
  Checkbox,
  Chip
} from '@mui/material';
import {
  Add as AddIcon,
  FilterList as FilterIcon,
  History as HistoryIcon,
  Payment as PaymentIcon,
  Store as StoreIcon,
  Map as MapIcon,
  Category as CategoryIcon,
  TrendingUp as TrendingUpIcon,
  Warning as WarningIcon,
  AccountBalanceWallet as WalletIcon,
  Settings as SettingsIcon,
  Clear as ClearIcon,
  Download as DownloadIcon,
} from '@mui/icons-material';

import '../styles/Finance.css';

function TabPanel({ children, value, index, ...props }) {
  return (
    <Box role="tabpanel" hidden={value !== index} {...props}>
      {value === index && <Box sx={{ pt: 3, pb: 'var(--space-6)' }}>{children}</Box>}
    </Box>
  );
}

function buildLedgerFilterParams({ outletId, entryType, entryGroup, supplyStatus, startDate, endDate }) {
  const params = new URLSearchParams();
  const filters = { outletId, entryType, entryGroup, supplyStatus, startDate, endDate };

  Object.entries(filters).forEach(([key, value]) => {
    if (value !== '' && value !== null && value !== undefined) {
      params.set(key, String(value));
    }
  });

  return params;
}

const adjustmentTypeTranslations = {
  'deposit': 'إيداع نقدي الخزينة',
  'withdrawal': 'سحب نقدي من الخزينة',
  'expense': 'مصاريف تشغيلية',
  'salary': 'رواتب وأجور الموظفين (المطبعة عامة)',
  'credit_adjustment': 'تسوية خصم ذمم (إبراء)',
  'debit_adjustment': 'تسوية إضافة ذمم (قيد مالي)'
};

const entryTypeTranslations = {
  'invoice_created': 'إنشاء فاتورة مبيعات',
  'invoice_cancelled': 'إلغاء فاتورة مبيعات',
  'invoice_updated': 'تعديل فاتورة مبيعات',
  'payment_recorded': 'تحصيل نقدي (سداد فاتورة)',
  'payment_reversed': 'إلغاء تحصيل نقدي (عكس سداد)',
  'manual_adjustment': 'تسوية يدوية بالخزينة',
  'payment_supplied': 'توريد نقدية تحصيل لمقر الشركة',
  'supply_reversed': 'إلغاء توريد نقدية تحصيل',
  'return_created': 'مرتجع مبيعات'
};

export const Finance = () => {
  const { user, hasPermission } = useAuth();
  const roleNames = Array.isArray(user?.roles) ? user.roles : [];
  const hasGlobalFinanceScope = roleNames.some((role) =>
    ['super_admin', 'assistant', 'readonly_viewer', 'inventory_manager', 'shipping_user'].includes(role)
  );
  const isScopedAuthor = roleNames.includes('author') && !hasGlobalFinanceScope;
  const isScopedOutlet = roleNames.includes('outlet') && !hasGlobalFinanceScope;
  
  // Page UI State
  const [tab, setTab] = useState(0);
  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [toastMsg, setToastMsg] = useState('');
  const [toastSeverity, setToastSeverity] = useState('success');

  const showToast = (msg, severity = 'success') => {
    setToastMsg(msg);
    setToastSeverity(severity);
  };

  // Dropdowns Lists for filter/form
  const [outlets, setOutlets] = useState([]);

  // Ledger History list state
  const [ledger, setLedger] = useState([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);

  // Ledger Filters
  const [filterOutlet, setFilterOutlet] = useState('');
  const [filterEntryType, setFilterEntryType] = useState('');
  const [filterSupplyStatus, setFilterSupplyStatus] = useState('');
  const [filterEntryGroup, setFilterEntryGroup] = useState('');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');

  // Grouped Breakdowns state
  const [outletBalances, setOutletBalances] = useState([]);
  const [outletLoading, setOutletLoading] = useState(false);

  const [governorateBalances, setGovernorateBalances] = useState([]);
  const [govLoading, setGovLoading] = useState(false);

  const [outletTypeBalances, setOutletTypeBalances] = useState([]);
  const [typeLoading, setTypeLoading] = useState(false);

  // Manual Adjustment Form state
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjOutletId, setAdjOutletId] = useState('');
  const [adjAmount, setAdjAmount] = useState('');
  const [adjType, setAdjType] = useState('deposit');
  const [adjTitle, setAdjTitle] = useState('');
  const [adjNotes, setAdjNotes] = useState('');
  const [submittingAdj, setSubmittingAdj] = useState(false);

  const [paymentMethodsDrawerOpen, setPaymentMethodsDrawerOpen] = useState(false);

  // Payments & Supply Ledger state
  const [paymentsList, setPaymentsList] = useState([]);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [paymentsPage, setPaymentsPage] = useState(0);
  const [paymentsRowsPerPage, setPaymentsRowsPerPage] = useState(25);
  const [paymentsTotalCount, setPaymentsTotalCount] = useState(0);
  const [supplyBatches, setSupplyBatches] = useState([]);
  const [paymentsFilterOutlet, setPaymentsFilterOutlet] = useState('');
  const [paymentsFilterSupplyStatus, setPaymentsFilterSupplyStatus] = useState('');
  const [selectedPaymentIds, setSelectedPaymentIds] = useState([]);
  const [supplySubmitting, setSupplySubmitting] = useState(false);
  const [amountSupplyOpen, setAmountSupplyOpen] = useState(false);
  const [amountSupply, setAmountSupply] = useState('');
  const [amountSupplyOutlet, setAmountSupplyOutlet] = useState('');
  const [amountSupplyPreview, setAmountSupplyPreview] = useState(null);
  const [amountSupplyChoice, setAmountSupplyChoice] = useState('lower');
  const [amountSupplyOutletsLoading, setAmountSupplyOutletsLoading] = useState(false);

  // Client Statement state
  const [statementOutletId, setStatementOutletId] = useState('');
  const [statementData, setStatementData] = useState(null);
  const [statementLoading, setStatementLoading] = useState(false);

  // Fetch Dropdown data
  useEffect(() => {
    if (!hasPermission('finance.view')) return;
    const endpoint = hasPermission('outlets.view') ? '/outlets' : '/finance/outlets';
    apiClient.get(endpoint)
      .then(data => {
        const availableOutlets = data || [];
        setOutlets(availableOutlets);
        if (isScopedOutlet && hasPermission('finance.statement.view') && availableOutlets.length === 1) {
          setStatementOutletId(String(availableOutlets[0].id));
        }
      })
      .catch(err => console.error('Failed to load outlets for dropdowns', err));
  }, []);

  // Fetch Treasury Summary
  const fetchSummary = useCallback(async () => {
    setSummaryLoading(true);
    try {
      const data = await apiClient.get('/finance/summary');
      setSummary(data);
    } catch (err) {
      showToast(err.message || 'خطأ في تحميل ملخص البيانات المالية والخزينة', 'error');
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  // Fetch Ledger History
  const fetchLedger = useCallback(async () => {
    setLedgerLoading(true);
    try {
      const offset = page * rowsPerPage;
      const params = buildLedgerFilterParams({
        outletId: filterOutlet,
        entryType: filterEntryType,
        entryGroup: filterEntryGroup,
        supplyStatus: filterSupplyStatus,
        startDate: filterStartDate,
        endDate: filterEndDate
      });
      params.set('limit', String(rowsPerPage));
      params.set('offset', String(offset));

      const data = await apiClient.get(`/finance/balances/history?${params.toString()}`);
      setLedger(data);
      setTotalCount(data.length >= rowsPerPage ? offset + rowsPerPage + 1 : offset + data.length);
    } catch (err) {
      showToast(err.message || 'خطأ في تحميل سجل حركات الخزينة والحسابات', 'error');
    } finally {
      setLedgerLoading(false);
    }
  }, [page, rowsPerPage, filterOutlet, filterEntryType, filterStartDate, filterEndDate, filterSupplyStatus, filterEntryGroup]);

  // Fetch Outlet Balances
  const fetchOutletBalances = useCallback(async () => {
    setOutletLoading(true);
    try {
      const data = await apiClient.get('/finance/outlets');
      setOutletBalances(data);
    } catch (err) {
      showToast(err.message || 'خطأ في تحميل أرصدة منافذ البيع', 'error');
    } finally {
      setOutletLoading(false);
    }
  }, []);

  // Fetch Governorate Balances
  const fetchGovernorateBalances = useCallback(async () => {
    setGovLoading(true);
    try {
      const data = await apiClient.get('/finance/governorates');
      setGovernorateBalances(data);
    } catch (err) {
      showToast(err.message || 'خطأ في تحميل أرصدة المحافظات', 'error');
    } finally {
      setGovLoading(false);
    }
  }, []);

  // Fetch Outlet Type Balances
  const fetchOutletTypeBalances = useCallback(async () => {
    setTypeLoading(true);
    try {
      const data = await apiClient.get('/finance/outlet-types');
      setOutletTypeBalances(data);
    } catch (err) {
      showToast(err.message || 'خطأ في تحميل أرصدة فئات منافذ التوزيع', 'error');
    } finally {
      setTypeLoading(false);
    }
  }, []);

  // Fetch Payments list (for Tab 4)
  const fetchPaymentsList = useCallback(async () => {
    setPaymentsLoading(true);
    try {
      const offset = paymentsPage * paymentsRowsPerPage;
      let q = `/payments?limit=${paymentsRowsPerPage}&offset=${offset}`;
      if (paymentsFilterOutlet) q += `&outletId=${paymentsFilterOutlet}`;
      if (paymentsFilterSupplyStatus) q += `&supplyStatus=${paymentsFilterSupplyStatus}`;
      const data = await apiClient.get(q);
      setPaymentsList(data);
      setPaymentsTotalCount(data.length >= paymentsRowsPerPage ? offset + paymentsRowsPerPage + 1 : offset + data.length);
      const batches = await apiClient.get(`/payments/supply-batches?limit=25${paymentsFilterOutlet ? `&outletId=${paymentsFilterOutlet}` : ''}`);
      setSupplyBatches(batches || []);
    } catch (err) {
      showToast(err.message || 'خطأ في تحميل سجل المدفوعات والتوريد', 'error');
    } finally {
      setPaymentsLoading(false);
    }
  }, [paymentsPage, paymentsRowsPerPage, paymentsFilterOutlet, paymentsFilterSupplyStatus]);

  // Fetch Client Statement (for Tab 5)
  const fetchStatementData = useCallback(async () => {
    if (!statementOutletId) {
      setStatementData(null);
      return;
    }
    setStatementLoading(true);
    try {
      const data = await apiClient.get(`/finance/outlets/${statementOutletId}/statement`);
      setStatementData(data);
    } catch (err) {
      showToast(err.message || 'خطأ في تحميل كشف حساب العميل', 'error');
      setStatementData(null);
    } finally {
      setStatementLoading(false);
    }
  }, [statementOutletId]);

  // Trigger loading based on Active Tab
  useEffect(() => {
    fetchSummary();
    if (isScopedAuthor) {
      return;
    }
    if (tab === 0) {
      fetchLedger();
    } else if (tab === 1) {
      fetchOutletBalances();
    } else if (tab === 2 && hasGlobalFinanceScope) {
      fetchGovernorateBalances();
    } else if (tab === 3 && hasGlobalFinanceScope) {
      fetchOutletTypeBalances();
    } else if (tab === 4 && hasPermission('payments.view')) {
      fetchPaymentsList();
    } else if (tab === 5 && hasPermission('finance.statement.view')) {
      fetchStatementData();
    }
  }, [tab, fetchSummary, fetchLedger, fetchOutletBalances, fetchGovernorateBalances, fetchOutletTypeBalances, fetchPaymentsList, fetchStatementData]);

  // Reset page on filter changes
  useEffect(() => {
    setPage(0);
  }, [filterOutlet, filterEntryType, filterEntryGroup, filterSupplyStatus, filterStartDate, filterEndDate]);

  // Supply status is meaningful only for invoice payment events. Clear it
  // when the ledger is switched to expenses/settlements so the filters never
  // mix unrelated event types.
  useEffect(() => {
    if (filterEntryGroup === 'settlements' && filterSupplyStatus) {
      setFilterSupplyStatus('');
    }
  }, [filterEntryGroup, filterSupplyStatus]);

  // Reset payments page on filter changes
  useEffect(() => {
    setPaymentsPage(0);
    setSelectedPaymentIds([]);
  }, [paymentsFilterOutlet, paymentsFilterSupplyStatus]);

  // Reset Filters
  const handleClearFilters = () => {
    setFilterOutlet('');
    setFilterEntryType('');
    setFilterSupplyStatus('');
    setFilterEntryGroup('');
    setFilterStartDate('');
    setFilterEndDate('');
  };

  const handleLedgerExport = () => {
    const params = buildLedgerFilterParams({
      outletId: filterOutlet,
      entryType: filterEntryType,
      entryGroup: filterEntryGroup,
      supplyStatus: filterSupplyStatus,
      startDate: filterStartDate,
      endDate: filterEndDate
    });
    params.set('type', 'finance-ledger');
    window.open(`/api/exports/reports?${params.toString()}`, '_blank', 'noopener,noreferrer');
  };

  // Submit Manual Adjustment
  const handleAdjSubmit = async (e) => {
    e.preventDefault();
    const isOutletRequired = !['salary', 'expense'].includes(adjType);
    if ((isOutletRequired && !adjOutletId) || !adjAmount || !adjTitle.trim() || !adjNotes.trim()) {
      showToast('يرجى ملء جميع الحقول المطلوبة للتسوية بما في ذلك العنوان', 'error');
      return;
    }
    const amtNum = parseFloat(adjAmount);
    if (isNaN(amtNum) || amtNum <= 0) {
      showToast('يرجى إدخال مبلغ صحيح أكبر من الصفر', 'error');
      return;
    }

    setSubmittingAdj(true);
    try {
      await apiClient.post('/finance/manual-adjustments', {
        outletId: adjOutletId,
        amount: amtNum,
        adjustmentType: adjType,
        title: adjTitle.trim(),
        notes: adjNotes.trim()
      });
      showToast('تم تسجيل حركة التسوية اليدوية بالخزينة والحسابات بنجاح.', 'success');
      setAdjustOpen(false);
      // Reset form
      setAdjOutletId('');
      setAdjAmount('');
      setAdjType('deposit');
      setAdjTitle('');
      setAdjNotes('');
      // Refresh active lists
      fetchSummary();
      if (tab === 0) fetchLedger();
      else if (tab === 1) fetchOutletBalances();
      else if (tab === 2) fetchGovernorateBalances();
      else if (tab === 3) fetchOutletTypeBalances();
    } catch (err) {
      showToast(err.message || 'خطأ أثناء تسجيل التسوية اليدوية بالخزينة', 'error');
    } finally {
      setSubmittingAdj(false);
    }
  };

  // Confirm single payment supply
  const handleConfirmSupply = async (paymentId) => {
    setSupplySubmitting(true);
    try {
      await apiClient.post(`/payments/${paymentId}/supply`);
      showToast('تم تأكيد توريد الدفعة بنجاح وتحديث أرصدة الخزينة.', 'success');
      fetchSummary();
      fetchPaymentsList();
      setSelectedPaymentIds(prev => prev.filter(id => id !== paymentId));
    } catch (err) {
      showToast(err.message || 'خطأ أثناء تسجيل توريد الدفعة', 'error');
    } finally {
      setSupplySubmitting(false);
    }
  };

  // Confirm batch payments supply
  const handleBatchConfirmSupply = async () => {
    if (selectedPaymentIds.length === 0) return;
    setSupplySubmitting(true);
    try {
      await apiClient.post('/payments/supply-batch', { paymentIds: selectedPaymentIds });
      showToast(`تم تأكيد توريد عدد (${selectedPaymentIds.length}) دفعة بنجاح وتحديث أرصدة الخزينة.`, 'success');
      fetchSummary();
      fetchPaymentsList();
      setSelectedPaymentIds([]);
    } catch (err) {
      showToast(err.message || 'خطأ أثناء تسجيل توريد الدفعات دفعةً واحدة', 'error');
    } finally {
      setSupplySubmitting(false);
    }
  };

  const previewAmountSupply = async () => {
    try {
      const q = new URLSearchParams({ amount: amountSupply });
      if (amountSupplyOutlet) q.set('outletId', amountSupplyOutlet);
      const data = await apiClient.get(`/payments/supply-amount/preview?${q.toString()}`);
      setAmountSupplyPreview(data); setAmountSupplyChoice('lower');
    } catch (err) { showToast(err.message || 'تعذر معاينة التوريد', 'error'); }
  };

  const openAmountSupplyDialog = async () => {
    setAmountSupplyOpen(true);
    if (outlets.length > 0) return;
    setAmountSupplyOutletsLoading(true);
    try {
      const data = await apiClient.get('/finance/outlets');
      setOutlets(Array.isArray(data) ? data : []);
    } catch (err) {
      showToast(err.message || 'تعذر تحميل قائمة المنافذ', 'error');
    } finally {
      setAmountSupplyOutletsLoading(false);
    }
  };

  const confirmAmountSupply = async () => {
    if (!amountSupplyPreview) return;
    const ids = amountSupplyChoice === 'upper' ? amountSupplyPreview.upperSelectedPaymentIds : amountSupplyPreview.selectedPaymentIds;
    try {
      setSupplySubmitting(true);
      await apiClient.post('/payments/supply-amount', { amount: amountSupply, outletId: amountSupplyOutlet || null, selectedPaymentIds: ids, expectedVersion: amountSupplyPreview.version });
      showToast('تم توريد المبلغ وتحديث الخزينة بنجاح.', 'success');
      setAmountSupplyOpen(false); setAmountSupplyPreview(null); setAmountSupply(''); fetchSummary(); fetchPaymentsList();
    } catch (err) { showToast(err.message || 'تعذر تنفيذ التوريد', 'error'); }
    finally { setSupplySubmitting(false); }
  };

  if (summaryLoading && !summary) {
    return <LoadingState message="جاري تحميل البيانات المالية وإحصائيات الخزينة..." />;
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, justifyContent: 'space-between', alignItems: { xs: 'stretch', md: 'center' }, gap: 2, mb: 3 }}>
        <Typography variant="h5" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
          إدارة الخزينة والحسابات المالية
        </Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ flexShrink: 0 }}>
          {hasPermission('payments.supply.amount') && (
            <Button variant="contained" color="success" startIcon={<PaymentIcon />} onClick={openAmountSupplyDialog} sx={{ fontWeight: 'bold', borderRadius: 2, whiteSpace: 'nowrap' }}>
              توريد مبلغ
            </Button>
          )}
          {hasPermission('finance.adjust') && (
            <Button variant="contained" color="secondary" startIcon={<AddIcon />} onClick={() => setAdjustOpen(true)} sx={{ fontWeight: 'bold', borderRadius: 2, whiteSpace: 'nowrap' }}>
              إجراء تسوية يدوية بالخزينة
            </Button>
          )}
          {roleNames.includes('super_admin') && (
            <Button variant="contained" color="info" startIcon={<SettingsIcon />} onClick={() => setPaymentMethodsDrawerOpen(true)} sx={{ fontWeight: 'bold', borderRadius: 2, whiteSpace: 'nowrap' }}>
              إعدادات طرق الدفع
            </Button>
          )}
        </Stack>
      </Box>

      <Dialog open={amountSupplyOpen} onClose={() => !supplySubmitting && setAmountSupplyOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>توريد مبلغ حسب أقدم الدفعات</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="المبلغ المطلوب" type="number" value={amountSupply} onChange={e => { setAmountSupply(e.target.value); setAmountSupplyPreview(null); }} fullWidth />
            <FormControl fullWidth disabled={amountSupplyOutletsLoading}>
              <InputLabel id="amount-supply-scope-label" shrink>النطاق</InputLabel>
              <Select
                labelId="amount-supply-scope-label"
                value={amountSupplyOutlet}
                label="النطاق"
                displayEmpty
                renderValue={(selected) => {
                  if (!selected) return amountSupplyOutletsLoading ? 'جاري تحميل المنافذ...' : 'كل المنافذ';
                  return outlets.find(outlet => String(outlet.id) === String(selected))?.name || 'كل المنافذ';
                }}
                onChange={e => { setAmountSupplyOutlet(e.target.value); setAmountSupplyPreview(null); }}
              >
                <MenuItem value="">كل المنافذ</MenuItem>
                {outlets.map(outlet => <MenuItem key={outlet.id} value={String(outlet.id)}>{outlet.name}</MenuItem>)}
              </Select>
            </FormControl>
            <Button variant="outlined" onClick={previewAmountSupply} disabled={!amountSupply || supplySubmitting}>معاينة التخصيص</Button>
            {amountSupplyPreview && <>
              <Alert severity={amountSupplyPreview.exact ? 'success' : 'warning'}>المطلوب: {formatCurrencyEGP(amountSupplyPreview.requestedAmount)} — الأقل: {formatCurrencyEGP(amountSupplyPreview.lowerAmount)} — الأكبر: {formatCurrencyEGP(amountSupplyPreview.upperAmount)}</Alert>
              {!amountSupplyPreview.exact && <FormControl><InputLabel>اختيار التوريد</InputLabel><Select value={amountSupplyChoice} label="اختيار التوريد" onChange={e => setAmountSupplyChoice(e.target.value)}><MenuItem value="lower">توريد الأقل ({formatCurrencyEGP(amountSupplyPreview.lowerAmount)})</MenuItem><MenuItem value="upper">توريد الأكبر ({formatCurrencyEGP(amountSupplyPreview.upperAmount)})</MenuItem></Select></FormControl>}
              <Typography variant="body2">عدد الدفعات: {amountSupplyChoice === 'upper' ? amountSupplyPreview.upperSelectedPaymentIds.length : amountSupplyPreview.selectedPaymentIds.length} — عدد الفواتير: {amountSupplyPreview.invoiceCount}</Typography>
            </>}
          </Stack>
        </DialogContent>
        <DialogActions><Button onClick={() => setAmountSupplyOpen(false)}>إلغاء</Button><Button variant="contained" onClick={confirmAmountSupply} disabled={!amountSupplyPreview || supplySubmitting}>تأكيد التوريد</Button></DialogActions>
      </Dialog>

      {/* Summary Stat Cards */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid item xs={12} sm={6} md={2}>
          <Card sx={{ borderLeft: '5px solid', borderColor: 'primary.main', height: '100%' }}>
            <CardContent sx={{ display: 'flex', alignItems: 'center', py: 2 }}>
              <Box sx={{ p: 1.5, mr: 2, bg: 'primary.light', color: 'primary.main', borderRadius: 2, display: 'flex' }}>
                <TrendingUpIcon sx={{ fontSize: 28 }} />
              </Box>
              <Box>
                <Typography variant="subtitle2" color="text.secondary">
                  إجمالي الفواتير (المبيعات)
                </Typography>
                <Typography variant="h6" sx={{ fontWeight: 'bold', mt: 0.5 }}>
                  {formatCurrencyEGP(summary?.totalInvoices || 0)}
                </Typography>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={2}>
          <Card sx={{ borderLeft: '5px solid', borderColor: 'warning.main', height: '100%' }}>
            <CardContent sx={{ display: 'flex', alignItems: 'center', py: 2 }}>
              <Box sx={{ p: 1.5, mr: 2, bg: 'warning.light', color: 'warning.main', borderRadius: 2, display: 'flex' }}>
                <WalletIcon sx={{ fontSize: 28 }} />
              </Box>
              <Box>
                <Typography variant="subtitle2" color="text.secondary">
                  الرصيد المعلق (الذمم المدينة)
                </Typography>
                <Typography variant="h6" sx={{ fontWeight: 'bold', mt: 0.5, color: 'warning.main' }}>
                  {formatCurrencyEGP(summary?.pendingBalance || 0)}
                </Typography>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={2}>
          <Card sx={{ borderLeft: '5px solid', borderColor: 'success.main', height: '100%' }}>
            <CardContent sx={{ display: 'flex', alignItems: 'center', py: 2 }}>
              <Box sx={{ p: 1.5, mr: 2, bg: 'success.light', color: 'success.main', borderRadius: 2, display: 'flex' }}>
                <PaymentIcon sx={{ fontSize: 28 }} />
              </Box>
              <Box>
                <Typography variant="subtitle2" color="text.secondary">
                  إجمالي الدفعات المحصلة
                </Typography>
                <Typography variant="h6" sx={{ fontWeight: 'bold', mt: 0.5, color: 'success.main' }}>
                  {formatCurrencyEGP(summary?.totalCollected || 0)}
                </Typography>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={2}>
          <Card sx={{ borderLeft: '5px solid', borderColor: 'info.main', height: '100%' }}>
            <CardContent sx={{ display: 'flex', alignItems: 'center', py: 2 }}>
              <Box sx={{ p: 1.5, mr: 2, bg: 'info.light', color: 'info.main', borderRadius: 2, display: 'flex' }}>
                <PaymentIcon sx={{ fontSize: 28 }} />
              </Box>
              <Box>
                <Typography variant="subtitle2" color="text.secondary">
                  نقدية موردة للشركة (مستلمة)
                </Typography>
                <Typography variant="h6" sx={{ fontWeight: 'bold', mt: 0.5, color: 'info.main' }}>
                  {formatCurrencyEGP(summary?.suppliedBalance || 0)}
                </Typography>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} sm={6} md={2}>
          <Card sx={{ borderLeft: '5px solid', borderColor: 'error.main', height: '100%' }}>
            <CardContent sx={{ display: 'flex', alignItems: 'center', py: 2 }}>
              <Box sx={{ p: 1.5, mr: 2, bg: 'error.light', color: 'error.main', borderRadius: 2, display: 'flex' }}>
                <WarningIcon sx={{ fontSize: 28 }} />
              </Box>
              <Box>
                <Typography variant="subtitle2" color="text.secondary">
                  نقدية معلقة (غير موردة)
                </Typography>
                <Typography variant="h6" sx={{ fontWeight: 'bold', mt: 0.5, color: 'error.main' }}>
                  {formatCurrencyEGP(summary?.unsuppliedBalance || 0)}
                </Typography>
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={6} md={2}>
          <Card sx={{ borderLeft: '5px solid', borderColor: 'success.main', height: '100%' }}>
            <CardContent sx={{ display: 'flex', alignItems: 'center', py: 2 }}>
              <Box sx={{ p: 0.5, mr: 2, bgcolor: 'transparent', backgroundColor: 'transparent', color: 'success.main', borderRadius: 0, display: 'flex' }}>
                <WalletIcon sx={{ fontSize: 28 }} />
              </Box>
              <Box>
                <Typography variant="subtitle2" color="text.secondary">رصيد خزينة الشركة</Typography>
                <Typography variant="h6" sx={{ fontWeight: 'bold', mt: 0.5, color: 'success.main' }}>
                  {formatCurrencyEGP(summary?.treasuryBalance || 0)}
                </Typography>
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Main Tabs */}
      {!isScopedAuthor && <Paper sx={{ width: '100%', borderRadius: 3, mb: 4 }}>
        <Tabs
          value={tab}
          onChange={(e, newTab) => setTab(newTab)}
          indicatorColor="secondary"
          textColor="secondary"
          variant="scrollable"
          scrollButtons="auto"
          sx={{ borderBottom: 1, borderColor: 'divider' }}
        >
          <Tab value={0} label="سجل حركات الخزينة والحسابات" icon={<HistoryIcon />} iconPosition="start" sx={{ fontWeight: 'bold', whiteSpace: 'nowrap' }} />
          <Tab value={1} label="أرصدة منافذ التوزيع" icon={<StoreIcon />} iconPosition="start" sx={{ fontWeight: 'bold', whiteSpace: 'nowrap' }} />
          {hasGlobalFinanceScope && (
            <Tab value={2} label="المبيعات والأرصدة بالمحافظات" icon={<MapIcon />} iconPosition="start" sx={{ fontWeight: 'bold', whiteSpace: 'nowrap' }} />
          )}
          {hasGlobalFinanceScope && (
            <Tab value={3} label="أرصدة فئات منافذ البيع" icon={<CategoryIcon />} iconPosition="start" sx={{ fontWeight: 'bold', whiteSpace: 'nowrap' }} />
          )}
          {hasPermission('payments.view') && (
            <Tab value={4} label="سجل المدفوعات والتوريد" icon={<PaymentIcon />} iconPosition="start" sx={{ fontWeight: 'bold', whiteSpace: 'nowrap' }} />
          )}
          {hasPermission('finance.statement.view') && (
            <Tab value={5} label="كشف حساب عميل" icon={<StoreIcon />} iconPosition="start" sx={{ fontWeight: 'bold', whiteSpace: 'nowrap' }} />
          )}
        </Tabs>

        {/* TAB 0: LEDGER HISTORY */}
        <TabPanel value={tab} index={0}>
          <Box sx={{ mb: 2, display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 1, justifyContent: 'space-between', alignItems: { xs: 'stretch', sm: 'center' } }}>
            <Typography variant="h6" sx={{ fontWeight: 'bold' }}>سجل حركات الخزينة والحسابات</Typography>
            {hasPermission('reports.export') && (
              <Button
                variant="contained"
                color="secondary"
                size="small"
                startIcon={<DownloadIcon />}
                onClick={handleLedgerExport}
                sx={{ ml: { xs: 0, sm: 2 }, alignSelf: { xs: 'flex-start', sm: 'center' } }}
              >
                تصدير Excel
              </Button>
            )}
          </Box>
          {/* Filters Panel */}
          <Box sx={{ p: 2, mb: 2, bg: 'action.hover', borderRadius: 2 }}>
            <Grid container spacing={2} alignItems="center" className="filter-grid">
              <Grid item xs={12} sm={2}>
                <FormControl fullWidth size="small">
                  <InputLabel>تصفية حسب المنفذ</InputLabel>
                  <Select
                    value={filterOutlet}
                    onChange={(e) => setFilterOutlet(e.target.value)}
                    label="تصفية حسب المنفذ"
                  >
                    <MenuItem value="">الكل</MenuItem>
                    {outlets.map(o => (
                      <MenuItem key={o.id} value={o.id}>{o.name}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>

              <Grid item xs={12} sm={2}>
                <FormControl fullWidth size="small">
                  <InputLabel>تصنيف العملية</InputLabel>
                  <Select
                    value={filterEntryGroup}
                    onChange={(e) => setFilterEntryGroup(e.target.value)}
                    label="تصنيف العملية"
                  >
                    <MenuItem value="">الكل</MenuItem>
                    <MenuItem value="payments">دفعات فواتير وتوريدات</MenuItem>
                    <MenuItem value="settlements">تسويات ومصروفات يدوية</MenuItem>
                  </Select>
                </FormControl>
              </Grid>

              {filterEntryGroup !== 'settlements' && <Grid item xs={12} sm={2}>
                <FormControl fullWidth size="small">
                  <InputLabel>حالة التوريد</InputLabel>
                  <Select
                    value={filterSupplyStatus}
                    onChange={(e) => setFilterSupplyStatus(e.target.value)}
                    label="حالة التوريد"
                  >
                    <MenuItem value="">الكل</MenuItem>
                    <MenuItem value="supplied">مورد / نهائي</MenuItem>
                    <MenuItem value="not_supplied">غير مورد</MenuItem>
                  </Select>
                </FormControl>
              </Grid>}

              <Grid item xs={12} sm={2}>
                <TextField
                  fullWidth
                  size="small"
                  label="من تاريخ"
                  type="date"
                  InputLabelProps={{ shrink: true }}
                  InputProps={{ notched: true }}
                  value={filterStartDate}
                  onChange={(e) => setFilterStartDate(e.target.value)}
                />
              </Grid>

              <Grid item xs={12} sm={2}>
                <TextField
                  fullWidth
                  size="small"
                  label="إلى تاريخ"
                  type="date"
                  InputLabelProps={{ shrink: true }}
                  InputProps={{ notched: true }}
                  value={filterEndDate}
                  onChange={(e) => setFilterEndDate(e.target.value)}
                />
              </Grid>

              <Grid item xs={12} sm={2} sx={{ display: 'flex', gap: 1 }}>
                <Button
                  fullWidth
                  variant="outlined"
                  onClick={handleClearFilters}
                  startIcon={<ClearIcon />}
                  size="small"
                >
                  إعادة تعيين
                </Button>
              </Grid>
            </Grid>
          </Box>

          {ledgerLoading ? (
            <LoadingState message="جاري تحميل حركات الدفتر المالي..." />
          ) : ledger.length > 0 ? (
            <Box>
              <TableContainer className="scrollable-table-container" component={Paper} sx={{ boxShadow: 0, overflowX: 'auto', width: '100%' }}>
                <Table sx={{ minWidth: 650 }}>
                  <TableHead>
                    <TableRow>
                      <TableCell align="center" sx={{ fontWeight: 'bold' }}>التاريخ والوقت</TableCell>
                      <TableCell align="center" sx={{ fontWeight: 'bold' }}>منفذ البيع</TableCell>
                      <TableCell align="center" sx={{ fontWeight: 'bold' }}>نوع الحركة</TableCell>
                      <TableCell align="center" sx={{ fontWeight: 'bold' }}>المبلغ الأساسي (قيمة العملية)</TableCell>
                      <TableCell align="center" sx={{ fontWeight: 'bold' }}>تأثير خزينة الشركة / عهدة التحصيل</TableCell>
                      <TableCell align="center" sx={{ fontWeight: 'bold' }}>تأثير المديونيات</TableCell>
                      <TableCell align="center" sx={{ fontWeight: 'bold' }}>بواسطة</TableCell>
                      <TableCell align="center" sx={{ fontWeight: 'bold' }}>الملاحظات والبيان</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {ledger.map((entry) => (
                      <TableRow key={entry.id} hover>
                        <TableCell align="center">{formatEgyptDateTime(entry.created_at)}</TableCell>
                        <TableCell align="center">{entry.outlet_name || 'عام'}</TableCell>
                        <TableCell align="center">
                          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, alignItems: 'center' }}>
                            <Chip
                              label={entryTypeTranslations[entry.entry_type] || entry.entry_type}
                              size="small"
                              color={
                                entry.entry_type === 'invoice_cancelled' || entry.entry_type === 'payment_reversed'
                                  ? 'error'
                                  : entry.entry_type === 'payment_recorded'
                                  ? 'success'
                                  : 'default'
                              }
                              variant="outlined"
                            />
                            {entry.payment_supply_status && (
                              <Chip
                                label={entry.payment_supply_status === 'supplied' ? 'مورد' : 'غير مورد'}
                                size="small"
                                color={entry.payment_supply_status === 'supplied' ? 'success' : 'warning'}
                              />
                            )}
                          </Box>
                        </TableCell>
                        <TableCell align="center" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
                          {formatCurrencyEGP(entry.payment_amount ?? entry.manual_amount ?? Math.abs(entry.cash_amount || entry.receivable_amount || entry.custody_amount || 0))}
                        </TableCell>
                        <TableCell align="center">
                          <Typography
                            variant="body2"
                            sx={{
                              fontWeight: entry.cash_amount !== 0 ? 'bold' : 'normal',
                              color: entry.cash_amount > 0 ? 'success.main' : entry.cash_amount < 0 ? 'error.main' : 'text.primary'
                            }}
                          >
                            {entry.cash_amount > 0 ? '+' : ''}{formatCurrencyEGP(entry.cash_amount)}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" display="block">
                            عهدة: {entry.custody_amount > 0 ? '+' : ''}{formatCurrencyEGP(entry.custody_amount || 0)}
                          </Typography>
                        </TableCell>
                        <TableCell align="center">
                          <Typography
                            variant="body2"
                            sx={{
                              fontWeight: entry.receivable_amount !== 0 ? 'bold' : 'normal',
                              color: entry.receivable_amount > 0 ? 'warning.main' : entry.receivable_amount < 0 ? 'success.main' : 'text.primary'
                            }}
                          >
                            {entry.receivable_amount > 0 ? '+' : ''}{formatCurrencyEGP(entry.receivable_amount)}
                          </Typography>
                        </TableCell>
                        <TableCell align="center">{entry.user_full_name || 'غير معروف'}</TableCell>
                        <TableCell align="center">
                          {entry.title ? (
                            <Box>
                              <Typography variant="body2" sx={{ fontWeight: 'bold' }}>{entry.title}</Typography>
                              <Typography variant="caption" color="text.secondary">{entry.notes}</Typography>
                            </Box>
                          ) : (
                            entry.notes || '-'
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    {ledger.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={8} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                          لا توجد حركات مالية مسجلة لهذه الفلاتر.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                  <TableFooter>
                    <TableRow sx={{ bgcolor: '#f1f5f9' }}>
                      <TableCell colSpan={3} align="right" sx={{ fontWeight: 'bold' }}>إجمالي الصفحة الحالية:</TableCell>
                      <TableCell align="center" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
                        {formatCurrencyEGP(ledger.reduce((s, r) => s + (r.payment_amount ?? r.manual_amount ?? Math.abs(r.cash_amount || r.receivable_amount || r.custody_amount || 0)), 0))}
                      </TableCell>
                      <TableCell align="center" sx={{ fontWeight: 'bold' }}>
                        <Typography color={ledger.reduce((s, r) => s + (r.cash_amount || 0), 0) > 0 ? 'success.main' : ledger.reduce((s, r) => s + (r.cash_amount || 0), 0) < 0 ? 'error.main' : 'inherit'}>
                          {formatCurrencyEGP(ledger.reduce((s, r) => s + (r.cash_amount || 0), 0))}
                          <Box component="span" sx={{ display: 'block', fontSize: '0.75rem', color: 'text.secondary' }}>
                            عهدة: {formatCurrencyEGP(ledger.reduce((s, r) => s + (r.custody_amount || 0), 0))}
                          </Box>
                        </Typography>
                      </TableCell>
                      <TableCell align="center" sx={{ fontWeight: 'bold' }}>
                        <Typography color={ledger.reduce((s, r) => s + (r.receivable_amount || 0), 0) > 0 ? 'error.main' : ledger.reduce((s, r) => s + (r.receivable_amount || 0), 0) < 0 ? 'success.main' : 'inherit'}>
                          {formatCurrencyEGP(ledger.reduce((s, r) => s + (r.receivable_amount || 0), 0))}
                        </Typography>
                      </TableCell>
                      <TableCell colSpan={2} />
                    </TableRow>
                  </TableFooter>
                </Table>
              </TableContainer>
              {/* Custom Table Pagination */}
              <Box
                sx={{
                  p: 2,
                  display: 'flex',
                  flexDirection: { xs: 'column', sm: 'row' },
                  gap: { xs: 2, sm: 0 },
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  borderTop: '1px solid rgba(224, 224, 224, 1)',
                  backgroundColor: '#ffffff',
                  width: '100%'
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="body2" color="textSecondary">
                    عدد الأسطر لكل صفحة:
                  </Typography>
                  <Select
                    size="small"
                    value={rowsPerPage}
                    onChange={(e) => {
                      setRowsPerPage(parseInt(e.target.value, 10));
                      setPage(0);
                    }}
                    sx={{ minWidth: 70 }}
                  >
                    <MenuItem value={10}>10</MenuItem>
                    <MenuItem value={25}>25</MenuItem>
                    <MenuItem value={50}>50</MenuItem>
                    <MenuItem value={100}>100</MenuItem>
                  </Select>
                </Box>

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Button size="small" disabled={page === 0} onClick={() => setPage(prev => Math.max(0, prev - 1))}>
                    السابق
                  </Button>
                  <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                    السجلات ({page * rowsPerPage + 1} - {page * rowsPerPage + ledger.length})
                  </Typography>
                  <Button size="small" disabled={ledger.length < rowsPerPage} onClick={() => setPage(prev => prev + 1)}>
                    التالي
                  </Button>
                </Box>
              </Box>
            </Box>
          ) : (
            <EmptyState message="لم يتم العثور على أي حركات مالية مسجلة بالخزينة تطابق البحث." />
          )}
        </TabPanel>

        {/* TAB 1: GROUPED BY OUTLETS */}
        <TabPanel value={tab} index={1}>
          {outletLoading ? (
            <LoadingState message="جاري تحميل أرصدة الفروع والمنافذ..." />
          ) : outletBalances.length > 0 ? (
             <TableContainer className="scrollable-table-container" component={Paper} sx={{ boxShadow: 0, overflowX: 'auto', width: '100%' }}>
              <Table sx={{ minWidth: 650 }}>
                <TableHead>
                  <TableRow>
                    <TableCell align="center" sx={{ fontWeight: 'bold' }}>اسم المنفذ</TableCell>
                    <TableCell align="center" sx={{ fontWeight: 'bold' }}>فئة المنفذ</TableCell>
                    <TableCell align="center" sx={{ fontWeight: 'bold' }}>المحافظة</TableCell>
                    <TableCell align="center" sx={{ fontWeight: 'bold' }}>الحد الائتماني</TableCell>
                    <TableCell align="center" sx={{ fontWeight: 'bold' }}>المرتجع (قيمة -)</TableCell>
                    <TableCell align="center" sx={{ fontWeight: 'bold' }}>المحصل (نقداً)</TableCell>
                    <TableCell align="center" sx={{ fontWeight: 'bold' }}>الرصيد المتبقي (المديونية)</TableCell>
                    <TableCell align="center" sx={{ fontWeight: 'bold' }}>الحالة</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {outletBalances.map((bal) => {
                    const limitExceeded = bal.receivable_balance > bal.credit_limit && bal.credit_limit > 0;
                    return (
                      <TableRow key={bal.id} hover>
                        <TableCell align="center" sx={{ fontWeight: 'bold' }}>{bal.name}</TableCell>
                        <TableCell align="center">{bal.outlet_type_name}</TableCell>
                        <TableCell align="center">{bal.governorate}</TableCell>
                        <TableCell align="center">{formatCurrencyEGP(bal.credit_limit)}</TableCell>
                        <TableCell align="center" sx={{ color: 'error.main', fontWeight: 'bold' }}>
                          {formatCurrencyEGP(bal.return_balance || 0)}
                        </TableCell>
                        <TableCell align="center" sx={{ color: 'success.main', fontWeight: 'bold' }}>
                          {formatCurrencyEGP(bal.collected_balance)}
                        </TableCell>
                        <TableCell align="center" sx={{ color: limitExceeded ? 'error.main' : 'warning.main', fontWeight: 'bold' }}>
                          {formatCurrencyEGP(bal.receivable_balance)}
                        </TableCell>
                        <TableCell align="center">
                          <Chip
                            label={limitExceeded ? 'تجاوز الحد الائتماني' : 'سليم ائتمانياً'}
                            color={limitExceeded ? 'error' : 'success'}
                            size="small"
                            variant="outlined"
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          ) : (
            <EmptyState message="لا يوجد منافذ بيع مسجلة حالياً." />
          )}
        </TabPanel>

        {/* TAB 2: GROUPED BY GOVERNORATE */}
        <TabPanel value={tab} index={2}>
          {govLoading ? (
            <LoadingState message="جاري تحميل أرصدة المحافظات..." />
          ) : governorateBalances.length > 0 ? (
            <TableContainer className="scrollable-table-container" component={Paper} sx={{ boxShadow: 0, overflowX: 'auto', width: '100%' }}>
              <Table sx={{ minWidth: 650 }}>
                <TableHead>
                  <TableRow>
                    <TableCell align="center" sx={{ fontWeight: 'bold' }}>المحافظة</TableCell>
                    <TableCell align="center" sx={{ fontWeight: 'bold' }}>المحصل (نقداً)</TableCell>
                    <TableCell align="center" sx={{ fontWeight: 'bold' }}>الرصيد المتبقي (المديونية)</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {governorateBalances.map((bal) => (
                    <TableRow key={bal.governorate} hover>
                      <TableCell align="center" sx={{ fontWeight: 'bold' }}>{bal.governorate}</TableCell>
                      <TableCell align="center" sx={{ color: 'success.main', fontWeight: 'bold' }}>
                        {formatCurrencyEGP(bal.collected_balance)}
                      </TableCell>
                      <TableCell align="center" sx={{ color: 'warning.main', fontWeight: 'bold' }}>
                        {formatCurrencyEGP(bal.receivable_balance)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          ) : (
            <EmptyState message="لا توجد بيانات لأي محافظات." />
          )}
        </TabPanel>

        {/* TAB 3: GROUPED BY OUTLET TYPE */}
        <TabPanel value={tab} index={3}>
          {typeLoading ? (
            <LoadingState message="جاري تحميل أرصدة الفئات..." />
          ) : outletTypeBalances.length > 0 ? (
            <TableContainer className="scrollable-table-container" component={Paper} sx={{ boxShadow: 0, overflowX: 'auto', width: '100%' }}>
              <Table sx={{ minWidth: 650 }}>
                <TableHead>
                  <TableRow>
                    <TableCell align="center" sx={{ fontWeight: 'bold' }}>فئة منفذ التوزيع</TableCell>
                    <TableCell align="center" sx={{ fontWeight: 'bold' }}>المحصل (نقداً)</TableCell>
                    <TableCell align="center" sx={{ fontWeight: 'bold' }}>الرصيد المتبقي (المديونية)</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {outletTypeBalances.map((bal) => (
                    <TableRow key={bal.id} hover>
                      <TableCell align="center" sx={{ fontWeight: 'bold' }}>{bal.outlet_type_name}</TableCell>
                      <TableCell align="center" sx={{ color: 'success.main', fontWeight: 'bold' }}>
                        {formatCurrencyEGP(bal.collected_balance)}
                      </TableCell>
                      <TableCell align="center" sx={{ color: 'warning.main', fontWeight: 'bold' }}>
                        {formatCurrencyEGP(bal.receivable_balance)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          ) : (
            <EmptyState message="لا توجد فئات منافذ مسجلة." />
          )}
        </TabPanel>

        {/* TAB 4: PAYMENTS & SUPPLY LEDGER */}
        <TabPanel value={tab} index={4}>
          {/* Filters */}
          <Box sx={{ p: 2, mb: 2, bg: 'action.hover', borderRadius: 2 }}>
            <Grid container spacing={2} alignItems="center" className="filter-grid">
              {/* Outlet Filter */}
              <Grid item xs={12} sm={4}>
                <FormControl fullWidth size="small">
                  <InputLabel>تصفية حسب المنفذ</InputLabel>
                  <Select
                    value={paymentsFilterOutlet}
                    onChange={(e) => setPaymentsFilterOutlet(e.target.value)}
                    label="تصفية حسب المنفذ"
                  >
                    <MenuItem value="">الكل</MenuItem>
                    {outlets.map(o => (
                      <MenuItem key={o.id} value={o.id}>{o.name}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>

              {/* Supply Status Filter */}
              <Grid item xs={12} sm={4}>
                <FormControl fullWidth size="small">
                  <InputLabel>حالة التوريد</InputLabel>
                  <Select
                    value={paymentsFilterSupplyStatus}
                    onChange={(e) => setPaymentsFilterSupplyStatus(e.target.value)}
                    label="حالة التوريد"
                  >
                    <MenuItem value="">الكل</MenuItem>
                    <MenuItem value="supplied">تم التوريد لمقر الشركة</MenuItem>
                    <MenuItem value="not_supplied">لم يتم التوريد (بالخزينة الفرعية)</MenuItem>
                  </Select>
                </FormControl>
              </Grid>

              {/* Reset Filters */}
              <Grid item xs={12} sm={4}>
                <Button
                  variant="outlined"
                  onClick={() => {
                    setPaymentsFilterOutlet('');
                    setPaymentsFilterSupplyStatus('');
                  }}
                  startIcon={<ClearIcon />}
                  size="small"
                  fullWidth
                >
                  إعادة تعيين الفلاتر
                </Button>
              </Grid>
            </Grid>
          </Box>

          {/* Batch action bar */}
          {selectedPaymentIds.length > 0 && hasPermission('payments.supply_batch') && (
            <Alert
              severity="info"
              sx={{ mb: 2, display: 'flex', alignItems: 'center' }}
              action={
                <Button
                  color="primary"
                  variant="contained"
                  size="small"
                  onClick={handleBatchConfirmSupply}
                  disabled={supplySubmitting}
                >
                  {supplySubmitting ? 'جاري تأكيد التوريد...' : `تأكيد توريد ${selectedPaymentIds.length} دفعة`}
                </Button>
              }
            >
              تم تحديد {selectedPaymentIds.length} دفعة مالية غير موردة.
            </Alert>
          )}

          {paymentsLoading ? (
            <LoadingState message="جاري تحميل سجل المدفوعات والتوريد..." />
          ) : paymentsList.length > 0 ? (
            <Box>
              <TableContainer className="scrollable-table-container" component={Paper} sx={{ boxShadow: 0 }}>
                <Table sx={{ minWidth: 650 }} size="small">
                  <TableHead>
                    <TableRow>
                      {/* Checkbox Header */}
                      {hasPermission('payments.supply_batch') && (
                        <TableCell align="center" sx={{ fontWeight: 'bold', width: 50 }}>
                          <Checkbox
                            size="small"
                            checked={
                              paymentsList.length > 0 &&
                              paymentsList.filter(p => p.supply_status === 'not_supplied').every(p => selectedPaymentIds.includes(p.id))
                            }
                            onChange={(e) => {
                              const notSupplied = paymentsList.filter(p => p.supply_status === 'not_supplied');
                              if (e.target.checked) {
                                const newIds = [...new Set([...selectedPaymentIds, ...notSupplied.map(p => p.id)])];
                                setSelectedPaymentIds(newIds);
                              } else {
                                const notSuppliedIds = notSupplied.map(p => p.id);
                                setSelectedPaymentIds(prev => prev.filter(id => !notSuppliedIds.includes(id)));
                              }
                            }}
                          />
                        </TableCell>
                      )}
                      <TableCell align="right" sx={{ fontWeight: 'bold' }}>التاريخ</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 'bold' }}>رقم الفاتورة</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 'bold' }}>طريقة الدفع</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 'bold' }}>المبلغ المحصل</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 'bold' }}>حالة التوريد</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 'bold' }}>بواسطة</TableCell>
                      <TableCell align="center" sx={{ fontWeight: 'bold' }}>الإجراءات</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {paymentsList.map((pay) => {
                      const isChecked = selectedPaymentIds.includes(pay.id);
                      return (
                        <TableRow key={pay.id} hover>
                          {/* Checkbox Row */}
                          {hasPermission('payments.supply_batch') && (
                            <TableCell align="center">
                              {pay.supply_status === 'not_supplied' ? (
                                <Checkbox
                                  size="small"
                                  checked={isChecked}
                                  onChange={() => {
                                    if (isChecked) {
                                      setSelectedPaymentIds(prev => prev.filter(id => id !== pay.id));
                                    } else {
                                      setSelectedPaymentIds(prev => [...prev, pay.id]);
                                    }
                                  }}
                                />
                              ) : null}
                            </TableCell>
                          )}
                          <TableCell align="right">{pay.payment_date ? formatEgyptDate(pay.payment_date) : '—'}</TableCell>
                          <TableCell align="right" sx={{ fontFamily: 'monospace' }}>{pay.invoice_number}</TableCell>
                          <TableCell align="right">
                            <Chip
                              label={pay.payment_method === 'cash' ? 'نقدي (Cash)' : 'تحويل/شيك (Bank)'}
                              size="small"
                              variant="outlined"
                            />
                          </TableCell>
                          <TableCell align="right" sx={{ color: 'success.main', fontWeight: 'bold' }}>
                            {formatCurrencyEGP(pay.amount)}
                          </TableCell>
                          <TableCell align="right">
                            <Chip
                              label={pay.supply_status === 'supplied' ? 'تم التوريد للشركة' : 'معلق في الخزينة الفرعية'}
                              color={pay.supply_status === 'supplied' ? 'success' : 'warning'}
                              size="small"
                            />
                          </TableCell>
                          <TableCell align="right">{pay.user_full_name || '—'}</TableCell>
                          <TableCell align="center">
                            {pay.supply_status === 'not_supplied' && hasPermission('payments.mark_supplied') ? (
                              <Button
                                size="small"
                                variant="contained"
                                color="success"
                                onClick={() => handleConfirmSupply(pay.id)}
                                disabled={supplySubmitting}
                                sx={{ py: 0.2, px: 1, fontSize: '0.75rem' }}
                              >
                                تأكيد التوريد
                              </Button>
                            ) : pay.supply_status === 'supplied' ? (
                              <Chip label="مورّد ومغلق" size="small" variant="outlined" sx={{ color: 'text.secondary' }} />
                            ) : (
                              '—'
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>

              {/* Pagination */}
              <Box sx={{ p: 2, display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid rgba(224,224,224,1)' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Button size="small" disabled={paymentsPage === 0} onClick={() => setPaymentsPage(prev => prev - 1)}>السابق</Button>
                  <Typography variant="body2" sx={{ fontWeight: 'bold' }}>الصفحة {paymentsPage + 1}</Typography>
                  <Button size="small" disabled={paymentsList.length < paymentsRowsPerPage} onClick={() => setPaymentsPage(prev => prev + 1)}>التالي</Button>
                </Box>
              </Box>
            </Box>
          ) : (
            <EmptyState message="لا يوجد حركات تحصيل مدفوعات مطابقة للمواصفات حالياً." />
          )}
        </TabPanel>

          {supplyBatches.length > 0 && (
            <Box sx={{ mt: 3 }}>
              <Typography variant="h6" sx={{ mb: 1, fontWeight: 'bold' }}>سجل عمليات التوريد</Typography>
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead><TableRow>
                    <TableCell>العملية</TableCell><TableCell>التاريخ</TableCell><TableCell>المطلوب</TableCell><TableCell>الفعلي</TableCell><TableCell>الدفعات</TableCell><TableCell>الحالة</TableCell><TableCell>بواسطة</TableCell>
                  </TableRow></TableHead>
                  <TableBody>{supplyBatches.map(batch => (
                    <TableRow key={batch.id} hover>
                      <TableCell sx={{ fontFamily: 'monospace' }}>SUP-{String(batch.id).padStart(6, '0')}</TableCell>
                      <TableCell>{formatEgyptDateTime(batch.created_at)}</TableCell>
                      <TableCell>{formatCurrencyEGP(batch.requested_amount)}</TableCell>
                      <TableCell sx={{ fontWeight: 'bold', color: 'success.main' }}>{formatCurrencyEGP(batch.supplied_amount)}</TableCell>
                      <TableCell>{batch.item_count || 0}</TableCell>
                      <TableCell><Chip size="small" label={batch.status === 'reversed' ? 'معكوسة' : batch.status === 'partially_reversed' ? 'معكوسة جزئيًا' : 'نشطة'} color={batch.status === 'active' ? 'success' : 'warning'} /></TableCell>
                      <TableCell>{batch.created_by_name || '—'}</TableCell>
                    </TableRow>
                  ))}</TableBody>
                </Table>
              </TableContainer>
            </Box>
          )}

        {/* TAB 5: CLIENT STATEMENT OF ACCOUNT */}
        <TabPanel value={tab} index={5}>
          {/* Outlet Selection Dropdown */}
          <Box sx={{ p: 2, mb: 2, bg: 'action.hover', borderRadius: 2 }}>
            <Grid container spacing={2} alignItems="center" className="filter-grid">
              <Grid item xs={12} sm={4}>
                <FormControl fullWidth size="small">
                  <InputLabel>اختر منفذ البيع لعرض كشف الحساب</InputLabel>
                  <Select
                    value={statementOutletId}
                    onChange={(e) => setStatementOutletId(e.target.value)}
                    label="اختر منفذ البيع لعرض كشف الحساب"
                  >
                    <MenuItem value="">-- اختر المنفذ --</MenuItem>
                    {outlets.map(o => (
                      <MenuItem key={o.id} value={o.id}>{o.name}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
            </Grid>
          </Box>

          {statementLoading ? (
            <LoadingState message="جاري جلب وتجميع حركات كشف الحساب..." />
          ) : statementData ? (
            <Box>
              {/* Statement Summary Card */}
              <Card variant="outlined" sx={{ mb: 3, backgroundColor: '#fafafa', borderRadius: 3 }}>
                <CardContent>
                  <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mb: 2, color: 'primary.dark' }}>
                    ملخص كشف حساب المنفذ: {statementData.outlet.name} ({statementData.outlet.governorate})
                  </Typography>
                  <Grid container spacing={2}>
                    <Grid item xs={12} sm={6} md={3}>
                      <Paper variant="outlined" sx={{ p: 2, textAlign: 'center', borderColor: 'primary.light' }}>
                        <Typography variant="caption" color="text.secondary">إجمالي الفواتير الصادرة</Typography>
                        <Typography variant="h6" sx={{ color: 'primary.main', fontWeight: 'bold', mt: 0.5 }}>
                          {formatCurrencyEGP(statementData.summary?.invoice_total || 0)}
                        </Typography>
                      </Paper>
                    </Grid>
                    <Grid item xs={12} sm={6} md={3}>
                      <Paper variant="outlined" sx={{ p: 2, textAlign: 'center', borderColor: 'error.light' }}>
                        <Typography variant="caption" color="text.secondary">إجمالي المرتجعات (-)</Typography>
                        <Typography variant="h6" sx={{ color: 'error.main', fontWeight: 'bold', mt: 0.5 }}>
                          {formatCurrencyEGP(statementData.summary?.return_balance || 0)}
                        </Typography>
                      </Paper>
                    </Grid>
                    <Grid item xs={12} sm={6} md={3}>
                      <Paper variant="outlined" sx={{ p: 2, textAlign: 'center', borderColor: 'success.light' }}>
                        <Typography variant="caption" color="text.secondary">إجمالي المقبوضات (المحصلة)</Typography>
                        <Typography variant="h6" sx={{ color: 'success.main', fontWeight: 'bold', mt: 0.5 }}>
                          {formatCurrencyEGP(statementData.summary?.collected_total || 0)}
                        </Typography>
                      </Paper>
                    </Grid>
                    <Grid item xs={12} sm={6} md={3}>
                      <Paper variant="outlined" sx={{ p: 2, textAlign: 'center', borderColor: 'info.light' }}>
                        <Typography variant="caption" color="text.secondary">نقدية موردة للشركة</Typography>
                        <Typography variant="h6" sx={{ color: 'info.main', fontWeight: 'bold', mt: 0.5 }}>
                          {formatCurrencyEGP(statementData.summary?.supplied_balance || 0)}
                        </Typography>
                      </Paper>
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <Paper variant="outlined" sx={{ p: 2, textAlign: 'center', borderColor: 'warning.light' }}>
                        <Typography variant="caption" color="text.secondary">نقدية معلقة بالفروع (غير موردة)</Typography>
                        <Typography variant="h6" sx={{ color: 'warning.main', fontWeight: 'bold', mt: 0.5 }}>
                          {formatCurrencyEGP(statementData.summary?.unsupplied_balance || 0)}
                        </Typography>
                      </Paper>
                    </Grid>
                    <Grid item xs={12} sm={6} md={4}>
                      <Paper variant="outlined" sx={{ p: 2, textAlign: 'center', borderColor: 'secondary.light', backgroundColor: '#fffbe6' }}>
                        <Typography variant="caption" color="text.secondary">الرصيد المعلق (الذمم المستحقة)</Typography>
                        <Typography variant="h6" sx={{ color: 'secondary.main', fontWeight: 'bold', mt: 0.5 }}>
                          {formatCurrencyEGP(statementData.summary?.pending_balance || 0)}
                        </Typography>
                      </Paper>
                    </Grid>
                    <Grid item xs={12} sm={12} md={4}>
                      <Paper variant="outlined" sx={{ p: 2, textAlign: 'center', borderColor: 'error.main', backgroundColor: '#fdf2f2' }}>
                        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 'bold' }}>صافي التعرض للمخاطر (Net Exposure)</Typography>
                        <Typography variant="h6" sx={{ color: 'error.main', fontWeight: 'bold', mt: 0.5 }}>
                          {formatCurrencyEGP(statementData.summary?.net_exposure || 0)}
                        </Typography>
                      </Paper>
                    </Grid>
                  </Grid>
                </CardContent>
              </Card>

              {/* Statement General Ledger Table */}
              <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1, color: 'text.secondary' }}>
                الحركات التفصيلية مرتبة زمنياً
              </Typography>
              <TableContainer className="scrollable-table-container" component={Paper}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell align="right" sx={{ fontWeight: 'bold' }}>التاريخ</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 'bold' }}>المستند</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 'bold' }}>نوع المعاملة</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 'bold' }}>المدين (مبيعات/مديونية +)</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 'bold' }}>الدائن (دفعة مسددة -)</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 'bold' }}>الرصيد المستحق الجاري</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 'bold' }}>البيان والتفاصيل</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {statementData.statement.map((item, idx) => {
                      const debitVal = item.receivable_amount > 0 ? item.receivable_amount : 0;
                      const creditVal = item.receivable_amount < 0 ? Math.abs(item.receivable_amount) : 0;
                      return (
                        <TableRow key={idx} hover>
                          <TableCell align="right">{item.created_at ? formatEgyptDate(item.created_at) : '—'}</TableCell>
                          <TableCell align="right" sx={{ fontFamily: 'monospace' }}>
                            {item.reference_type === 'invoice' ? `فاتورة #${item.reference_id}` : `سند #${item.reference_id}`}
                          </TableCell>
                          <TableCell align="right">
                            <Chip
                              label={entryTypeTranslations[item.entry_type] || item.entry_type}
                              size="small"
                              variant="outlined"
                              color={debitVal > 0 ? 'primary' : 'success'}
                            />
                          </TableCell>
                          <TableCell align="right" sx={{ color: debitVal > 0 ? 'warning.main' : 'inherit', fontWeight: debitVal > 0 ? 'bold' : 'normal' }}>
                            {debitVal > 0 ? formatCurrencyEGP(debitVal) : '—'}
                          </TableCell>
                          <TableCell align="right" sx={{ color: creditVal > 0 ? 'success.main' : 'inherit', fontWeight: creditVal > 0 ? 'bold' : 'normal' }}>
                            {creditVal > 0 ? formatCurrencyEGP(creditVal) : '—'}
                          </TableCell>
                          <TableCell align="right" sx={{ fontWeight: 'bold', color: item.running_receivable > 0 ? 'error.main' : 'success.main' }}>
                            {formatCurrencyEGP(item.running_receivable)}
                          </TableCell>
                          <TableCell align="right">
                            {item.title ? (
                              <Box>
                                <Typography variant="body2" sx={{ fontWeight: 'bold' }}>{item.title}</Typography>
                                <Typography variant="caption" color="text.secondary">{item.notes}</Typography>
                              </Box>
                            ) : (
                              item.notes || '—'
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            </Box>
          ) : (
            <Alert severity="info">يرجى اختيار منفذ بيع من القائمة المنسدلة أعلاه لعرض كشف حساب تفصيلي.</Alert>
          )}
        </TabPanel>
      </Paper>}

      <EntityDrawer
        open={paymentMethodsDrawerOpen}
        onClose={() => setPaymentMethodsDrawerOpen(false)}
        title="إعدادات وطرق الدفع"
        size="large"
      >
        <PaymentMethodsManager showToast={showToast} />
      </EntityDrawer>

      {/* MANUAL ADJUSTMENT DRAWER */}
      <EntityDrawer
        open={adjustOpen}
        onClose={() => !submittingAdj && setAdjustOpen(false)}
        title="تسجيل حركة تسوية يدوية (الخزينة والحسابات)"
        size="medium"
        actions={
          <Box sx={{ display: 'flex', gap: 1.5, justifyContent: 'flex-end', width: '100%' }}>
            <Button onClick={() => setAdjustOpen(false)} disabled={submittingAdj} variant="outlined" color="inherit">إلغاء</Button>
            <Button type="submit" form="manual-adjustment-form" variant="contained" color="secondary" disabled={submittingAdj}>
              {submittingAdj ? 'جاري الحفظ والتسجيل...' : 'تسجيل التسوية المالي'}
            </Button>
          </Box>
        }
      >
        <form id="manual-adjustment-form" onSubmit={handleAdjSubmit}>
          <Stack spacing={3}>
            <FormControl fullWidth required={!['salary', 'expense'].includes(adjType)} size="small" disabled={submittingAdj || ['salary', 'expense'].includes(adjType)}>
              <InputLabel>
                {['salary', 'expense'].includes(adjType) ? 'مصروفات عامة للمطبعة (بدون منفذ مخصص)' : 'اختر منفذ التوزيع / الفرع'}
              </InputLabel>
              <Select
                value={['salary', 'expense'].includes(adjType) ? '' : adjOutletId}
                onChange={(e) => setAdjOutletId(e.target.value)}
                label={['salary', 'expense'].includes(adjType) ? 'مصروفات عامة للمطبعة (بدون منفذ مخصص)' : 'اختر منفذ التوزيع / الفرع'}
              >
                <MenuItem value="">عام (المطبعة ككل)</MenuItem>
                {outlets.map(o => (
                  <MenuItem key={o.id} value={o.id}>{o.name} ({o.governorate})</MenuItem>
                ))}
              </Select>
            </FormControl>

            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <FormControl fullWidth required size="small">
                  <InputLabel>طبيعة التسوية</InputLabel>
                  <Select
                    value={adjType}
                    onChange={(e) => {
                      const val = e.target.value;
                      setAdjType(val);
                      if (['salary', 'expense'].includes(val)) {
                        setAdjOutletId('');
                      }
                    }}
                    label="طبيعة التسوية"
                    disabled={submittingAdj}
                  >
                    {Object.entries(adjustmentTypeTranslations).map(([k, v]) => (
                      <MenuItem key={k} value={k}>{v}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>

              <Grid item xs={12} sm={6}>
                <TextField
                  fullWidth
                  required
                  size="small"
                  label="المبلغ المالي"
                  type="number"
                  inputProps={{ step: '0.01', min: '0.01' }}
                  value={adjAmount}
                  onChange={(e) => setAdjAmount(e.target.value)}
                  disabled={submittingAdj}
                  InputProps={{
                    startAdornment: <InputAdornment position="start">ج.م</InputAdornment>,
                  }}
                />
              </Grid>
            </Grid>

            <TextField
              fullWidth
              required
              size="small"
              label="عنوان أو بند التسوية (مثال: فاتورة كهرباء، رواتب المندوبين)"
              value={adjTitle}
              onChange={(e) => setAdjTitle(e.target.value)}
              disabled={submittingAdj}
            />

            <TextField
              fullWidth
              required
              multiline
              rows={3}
              size="small"
              label="البيان وسبب التسوية (إلزامي)"
              value={adjNotes}
              onChange={(e) => setAdjNotes(e.target.value)}
              disabled={submittingAdj}
              placeholder="يرجى كتابة شرح كامل لسبب التعديل المالي..."
            />
          </Stack>
        </form>
      </EntityDrawer>

      {/* Alert toast message */}
      <Snackbar
        open={Boolean(toastMsg)}
        autoHideDuration={6000}
        onClose={() => setToastMsg('')}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={() => setToastMsg('')} severity={toastSeverity} sx={{ width: '100%' }}>
          {toastMsg}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default Finance;
