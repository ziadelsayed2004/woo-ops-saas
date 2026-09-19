import React, { useState, useEffect, useCallback } from 'react';
import { formatCurrencyEGP, formatEgyptDate } from '../utils/formatters';
import { useAuth } from '../app/AuthContext';
import { apiClient } from '../services/apiClient';
import LoadingState from '../components/LoadingState';
import EmptyState from '../components/EmptyState';
import EntityDrawer from '../components/EntityDrawer';
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
  Tabs,
  Tab,
  Tooltip,
  Drawer
} from '@mui/material';
import {
  Add as AddIcon,
  Search as SearchIcon,
  Visibility as VisibilityIcon,
  Clear as ClearIcon,
  Inventory as InventoryIcon,
  Receipt as ReceiptIcon,
  SwapVert as SwapVertIcon,
  TuneOutlined as AdjustIcon,
  Delete as DeleteIcon,
  WarningAmber as WarningIcon,
  Undo as UndoIcon
} from '@mui/icons-material';

import '../styles/Inventory.css';

// ──── Tab Panel ────

function TabPanel({ children, value, index, ...props }) {
  return (
    <Box role="tabpanel" hidden={value !== index} {...props}>
      {value === index && <Box sx={{ pt: 2, pb: 'var(--space-6)' }}>{children}</Box>}
    </Box>
  );
}

// ──── Main Component ────

export const Inventory = () => {
  const { hasPermission } = useAuth();

  const [tab, setTab] = useState(0);
  const [toastMsg, setToastMsg] = useState('');
  const [toastSeverity, setToastSeverity] = useState('success');
  const showToast = (msg, severity = 'success') => { setToastMsg(msg); setToastSeverity(severity); };

  // ─── Stock Summary ───
  const [stockData, setStockData] = useState([]);
  const [stockLoading, setStockLoading] = useState(false);
  const [stockSearch, setStockSearch] = useState('');
  const [stockLimit, setStockLimit] = useState(25);
  const [stockOffset, setStockOffset] = useState(0);

  const fetchStock = useCallback(async () => {
    setStockLoading(true);
    try {
      let q = `/inventory/stock-summary?limit=${stockLimit}&offset=${stockOffset}`;
      if (stockSearch) q += `&search=${encodeURIComponent(stockSearch)}`;
      const data = await apiClient.get(q);
      setStockData(data);
    } catch (err) {
      showToast(err.message || 'فشل تحميل ملخص المخزون.', 'error');
    } finally {
      setStockLoading(false);
    }
  }, [stockLimit, stockOffset, stockSearch]);

  useEffect(() => { if (tab === 0) fetchStock(); }, [tab, fetchStock]);

  // ─── Transactions Ledger ───
  const [txData, setTxData] = useState([]);
  const [txLoading, setTxLoading] = useState(false);
  const [txProductId, setTxProductId] = useState('');
  const [txType, setTxType] = useState('');
  const [txLimit, setTxLimit] = useState(25);
  const [txOffset, setTxOffset] = useState(0);

  const fetchTransactions = useCallback(async () => {
    setTxLoading(true);
    try {
      let q = `/inventory/transactions?limit=${txLimit}&offset=${txOffset}`;
      if (txProductId) q += `&productId=${txProductId}`;
      if (txType) q += `&transactionType=${txType}`;
      const data = await apiClient.get(q);
      setTxData(data);
    } catch (err) {
      showToast(err.message || 'فشل تحميل سجل الحركات.', 'error');
    } finally {
      setTxLoading(false);
    }
  }, [txLimit, txOffset, txProductId, txType]);

  useEffect(() => { if (tab === 1) fetchTransactions(); }, [tab, fetchTransactions]);

  // ─── Receipts ───
  const [receipts, setReceipts] = useState([]);
  const [receiptsLoading, setReceiptsLoading] = useState(false);
  const [receiptsLimit, setReceiptsLimit] = useState(25);
  const [receiptsOffset, setReceiptsOffset] = useState(0);
  const [receiptStatus, setReceiptStatus] = useState('');

  const fetchReceipts = useCallback(async () => {
    setReceiptsLoading(true);
    try {
      let q = `/inventory/receipts?limit=${receiptsLimit}&offset=${receiptsOffset}`;
      if (receiptStatus) q += `&status=${receiptStatus}`;
      const data = await apiClient.get(q);
      setReceipts(data);
    } catch (err) {
      showToast(err.message || 'فشل تحميل سجل الوارد.', 'error');
    } finally {
      setReceiptsLoading(false);
    }
  }, [receiptsLimit, receiptsOffset, receiptStatus]);

  useEffect(() => { if (tab === 2) fetchReceipts(); }, [tab, fetchReceipts]);

  // ─── Receipt Detail Dialog ───
  const [openReceiptDetail, setOpenReceiptDetail] = useState(false);
  const [receiptDetail, setReceiptDetail] = useState(null);
  const [receiptDetailLoading, setReceiptDetailLoading] = useState(false);
  const [openReturnDialog, setOpenReturnDialog] = useState(false);
  const [returnDate, setReturnDate] = useState(new Date().toISOString().split('T')[0]);
  const [returnReason, setReturnReason] = useState('');
  const [returnNotes, setReturnNotes] = useState('');
  const [returnItems, setReturnItems] = useState([]);
  const [returnSubmitting, setReturnSubmitting] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelSubmitting, setCancelSubmitting] = useState(false);

  const handleViewReceipt = async (id) => {
    setReceiptDetailLoading(true);
    setReceiptDetail(null);
    setCancelReason('');
    setOpenReceiptDetail(true);
    try {
      const data = await apiClient.get(`/inventory/receipts/${id}`);
      setReceiptDetail(data);
    } catch (err) {
      showToast(err.message || 'فشل تحميل تفاصيل الوارد.', 'error');
      setOpenReceiptDetail(false);
    } finally {
      setReceiptDetailLoading(false);
    }
  };

  const handleOpenSupplierReturn = () => {
    if (!receiptDetail) return;
    setReturnDate(new Date().toISOString().split('T')[0]);
    setReturnReason('');
    setReturnNotes('');
    setReturnItems((receiptDetail.items || []).map(item => ({
      receiptItemId: item.id,
      productTitle: item.product_title,
      remaining: Math.max(0, Number(item.remaining_quantity || 0)),
      maxReturnable: Math.max(0, Number(item.max_returnable || 0)),
      quantity: ''
    })));
    setOpenReturnDialog(true);
  };

  const handleSubmitSupplierReturn = async (event) => {
    event.preventDefault();
    const selected = returnItems
      .filter(item => Number.parseInt(item.quantity, 10) > 0)
      .map(item => ({ receiptItemId: item.receiptItemId, quantity: Number.parseInt(item.quantity, 10) }));
    if (!returnReason.trim() || selected.length === 0) {
      showToast('سبب المرتجع وكمية صنف واحدة على الأقل مطلوبة.', 'error');
      return;
    }
    setReturnSubmitting(true);
    try {
      const data = await apiClient.post(`/inventory/receipts/${receiptDetail.id}/returns`, {
        returnDate,
        reason: returnReason,
        notes: returnNotes,
        items: selected
      });
      setReceiptDetail(data.receipt);
      setOpenReturnDialog(false);
      fetchReceipts();
      if (tab === 0) fetchStock();
      if (tab === 1) fetchTransactions();
      showToast('تم تسجيل مرتجع المورد وتحديث المخزون.');
    } catch (err) {
      showToast(err.message || 'فشل تسجيل مرتجع المورد.', 'error');
    } finally {
      setReturnSubmitting(false);
    }
  };

  const handleCancelReceipt = async () => {
    if (!receiptDetail || !cancelReason.trim()) {
      showToast('سبب إلغاء التوريد مطلوب.', 'error');
      return;
    }
    setCancelSubmitting(true);
    try {
      const data = await apiClient.post(`/inventory/receipts/${receiptDetail.id}/cancel`, { reason: cancelReason });
      setReceiptDetail(data.receipt);
      setCancelReason('');
      fetchReceipts();
      if (tab === 0) fetchStock();
      if (tab === 1) fetchTransactions();
      showToast('تم إلغاء أمر التوريد وعكس حركات المخزون.');
    } catch (err) {
      showToast(err.message || 'فشل إلغاء أمر التوريد.', 'error');
    } finally {
      setCancelSubmitting(false);
    }
  };

  // ─── Create Receipt Dialog ───
  const [openCreateReceipt, setOpenCreateReceipt] = useState(false);
  const [rcSupplier, setRcSupplier] = useState('');
  const [rcDate, setRcDate] = useState(new Date().toISOString().split('T')[0]);
  const [rcNotes, setRcNotes] = useState('');
  const [rcItems, setRcItems] = useState([{ productId: '', quantity: '', unitCost: 0 }]);
  const [rcSubmitting, setRcSubmitting] = useState(false);

  const [allProducts, setAllProducts] = useState([]);
  const fetchAllProducts = useCallback(async () => {
    try {
      const data = await apiClient.get('/inventory/stock-summary?limit=1000');
      setAllProducts(data || []);
    } catch (err) {
      console.error('Error fetching products for dropdown:', err);
    }
  }, []);

  useEffect(() => {
    fetchAllProducts();
  }, [fetchAllProducts]);

  const handleOpenCreateReceipt = () => {
    setRcSupplier('');
    setRcDate(new Date().toISOString().split('T')[0]);
    setRcNotes('');
    setRcItems([{ productId: '', quantity: '', unitCost: 0 }]);
    setOpenCreateReceipt(true);
    fetchAllProducts();
  };

  const handleRcAddItem = () => {
    setRcItems([...rcItems, { productId: '', quantity: '', unitCost: 0 }]);
  };

  const handleRcRemoveItem = (index) => {
    if (rcItems.length > 1) {
      setRcItems(rcItems.filter((_, i) => i !== index));
    }
  };

  const handleRcItemChange = (index, field, value) => {
    const updated = [...rcItems];
    updated[index][field] = value;
    setRcItems(updated);
  };

  const handleSubmitReceipt = async (e) => {
    e.preventDefault();
    if (!rcDate || rcItems.some(i => !i.productId || !i.quantity)) {
      showToast('تاريخ الاستلام وتفاصيل جميع الأصناف مطلوبة.', 'error');
      return;
    }
    setRcSubmitting(true);
    try {
      await apiClient.post('/inventory/receipts', {
        supplierName: rcSupplier,
        receivedDate: rcDate,
        notes: rcNotes,
        items: rcItems.map(i => ({
          productId: parseInt(i.productId, 10),
          quantity: parseInt(i.quantity, 10),
          unitCost: 0
        }))
      });
      showToast('تم تسجيل إذن الوارد بنجاح وتحديث أرصدة المخزون.');
      setOpenCreateReceipt(false);
      fetchReceipts();
      if (tab === 0) fetchStock();
    } catch (err) {
      showToast(err.message || 'فشل تسجيل إذن الوارد.', 'error');
    } finally {
      setRcSubmitting(false);
    }
  };

  // ─── Create Adjustment Dialog ───
  const [openAdjust, setOpenAdjust] = useState(false);
  const [adjReason, setAdjReason] = useState('');
  const [adjNotes, setAdjNotes] = useState('');
  const [adjItems, setAdjItems] = useState([{ productId: '', quantity: '' }]);
  const [adjSubmitting, setAdjSubmitting] = useState(false);

  const handleOpenAdjust = () => {
    setAdjReason('');
    setAdjNotes('');
    setAdjItems([{ productId: '', quantity: '' }]);
    setOpenAdjust(true);
    fetchAllProducts();
  };

  const handleAdjAddItem = () => {
    setAdjItems([...adjItems, { productId: '', quantity: '' }]);
  };

  const handleAdjRemoveItem = (index) => {
    if (adjItems.length > 1) setAdjItems(adjItems.filter((_, i) => i !== index));
  };

  const handleAdjItemChange = (index, field, value) => {
    const updated = [...adjItems];
    updated[index][field] = value;
    setAdjItems(updated);
  };

  const handleSubmitAdjustment = async (e) => {
    e.preventDefault();
    if (!adjReason || adjItems.some(i => !i.productId || !i.quantity)) {
      showToast('السبب ومعرّف المنتج والكمية مطلوبة لكل صنف.', 'error');
      return;
    }
    setAdjSubmitting(true);
    try {
      await apiClient.post('/inventory/adjustments', {
        reason: adjReason,
        notes: adjNotes,
        items: adjItems.map(i => ({
          productId: parseInt(i.productId, 10),
          quantity: parseInt(i.quantity, 10)
        }))
      });
      showToast('تم تسجيل تسوية المخزون بنجاح.');
      setOpenAdjust(false);
      if (tab === 0) fetchStock();
      if (tab === 1) fetchTransactions();
    } catch (err) {
      showToast(err.message || 'فشل تسجيل تسوية المخزون.', 'error');
    } finally {
      setAdjSubmitting(false);
    }
  };

  // ─── Helpers ───

  const txTypeLabel = (t) => {
    switch (t) {
      case 'receipt': return 'وارد كتب (استلام)';
      case 'sale': return 'مبيعات';
      case 'adjustment': return 'تسوية';
      case 'return': return 'مرتجع عميل / تصحيح فاتورة';
      case 'supplier_return': return 'مرتجع مورد';
      case 'receipt_cancellation': return 'عكس إلغاء توريد';
      default: return t || '—';
    }
  };

  const txTypeColor = (t) => {
    switch (t) {
      case 'receipt': return 'success';
      case 'sale': return 'error';
      case 'adjustment': return 'warning';
      case 'return': return 'info';
      case 'supplier_return': return 'info';
      case 'receipt_cancellation': return 'error';
      default: return 'default';
    }
  };

  const getStockChip = (stock) => {
    if (stock < 0) return <Chip label={`عجز توريد ${Math.abs(stock)}`} color="error" size="small" />;
    if (stock === 0) return <Chip label="نفد" color="error" size="small" />;
    if (stock <= 10) return <Chip label="منخفض" color="warning" size="small" />;
    return <Chip label="متوفر" color="success" size="small" />;
  };

  // ──── Render ────

  return (
    <Box sx={{ p: 1 }}>
      {/* Title */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="h5" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
          إدارة المخزون وواردات الكتب
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          {hasPermission('inventory.receipts.create') && (
            <Button variant="contained" color="primary" startIcon={<AddIcon />} onClick={handleOpenCreateReceipt}>
              إذن استلام مخزون جديد
            </Button>
          )}
          {hasPermission('inventory.adjustments.create') && (
            <Button variant="outlined" color="warning" startIcon={<AdjustIcon />} onClick={handleOpenAdjust}>
              تسوية مخزون
            </Button>
          )}
        </Box>
      </Box>

      {/* Tabs */}
      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        textColor="secondary"
        indicatorColor="secondary"
        variant="scrollable"
        scrollButtons="auto"
        sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab icon={<InventoryIcon />} label="ملخص المخزون" iconPosition="start" sx={{ whiteSpace: 'nowrap' }} />
        <Tab icon={<SwapVertIcon />} label="سجل الحركات" iconPosition="start" sx={{ whiteSpace: 'nowrap' }} />
        <Tab icon={<ReceiptIcon />} label="واردات الكتب (استلام مخزون)" iconPosition="start" sx={{ whiteSpace: 'nowrap' }} />
      </Tabs>

      {/* ── TAB 0: Stock Summary ── */}
      <TabPanel value={tab} index={0}>
        {/* Search bar */}
        <Box sx={{ mb: 2 }}>
          <TextField
            size="small"
            placeholder="بحث بالعنوان أو الكود..."
            value={stockSearch}
            onChange={(e) => { setStockSearch(e.target.value); setStockOffset(0); }}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
            sx={{ minWidth: 300 }}
          />
        </Box>

        {/* Low stock alert */}
        {!stockLoading && stockData.filter(s => s.stockPolicy !== 'ignore' && Number(s.stockBalance ?? s.stock ?? 0) < 0).length > 0 && (
          <Alert severity="error" icon={<WarningIcon />} sx={{ mb: 2 }}>
            يوجد {stockData.filter(s => s.stockPolicy !== 'ignore' && Number(s.stockBalance ?? s.stock ?? 0) < 0).length} منتج/ات تحتاج توريدًا لتغطية صافي المبيعات.
          </Alert>
        )}
        {!stockLoading && stockData.some(s => s.stockPolicy !== 'ignore' && Number(s.shippingSupplyGap || 0) > 0) && (
          <Alert severity="warning" icon={<WarningIcon />} sx={{ mb: 2 }}>
            يوجد عجز شحن سابق قدره{' '}
            {stockData
              .filter(s => s.stockPolicy !== 'ignore')
              .reduce((sum, s) => sum + Number(s.shippingSupplyGap || 0), 0)
              .toLocaleString()}{' '}
            نسخة: هذه كمية شُحنت فعليًا فوق التوريد المسجل، وليست كمية متاحة للشحن.
          </Alert>
        )}

        <Paper className="main-table-paper">
          {stockLoading ? (
            <LoadingState message="جاري تحميل ملخص المخزون..." />
          ) : stockData.length === 0 ? (
            <EmptyState title="لا يوجد بيانات مخزون" description="لم يتم العثور على منتجات نشطة أو لا توجد حركات." />
          ) : (
            <TableContainer className="scrollable-table-container" sx={{ maxHeight: 550 }}>
              <Table stickyHeader size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 'bold' }}>المعرّف</TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>كود المنتج</TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>اسم المنتج</TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>التصنيف</TableCell>
                    <TableCell align="center" sx={{ fontWeight: 'bold' }}>{'صافي الوارد'}</TableCell>
                    <TableCell align="center" sx={{ fontWeight: 'bold' }}>{'صافي المبيعات'}</TableCell>
                    <TableCell align="center" sx={{ fontWeight: 'bold' }}>{'المشحون'}</TableCell>
                    <TableCell align="center" sx={{ fontWeight: 'bold' }}>{'المتبقي من المبيعات'}</TableCell>
                    <TableCell align="center" sx={{ fontWeight: 'bold' }}>رصيد المخزون</TableCell>
                    <TableCell align="center" sx={{ fontWeight: 'bold' }}>
                      <Tooltip title="التوريد والمرتجعات والتسويات ناقص الشحن الفعلي. السالب يعني شحنًا سابقًا بلا غطاء توريد مسجل.">
                        <span>رصيد الشحن المسجل</span>
                      </Tooltip>
                    </TableCell>
                    <TableCell align="center" sx={{ fontWeight: 'bold' }}>{'متاح للشحن'}</TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>الحالة</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {stockData.map((row) => (
                    <TableRow key={row.id} hover sx={{ backgroundColor: Number(row.stockBalance ?? row.stock ?? 0) < 0 ? 'rgba(231,76,60,0.04)' : 'inherit' }}>
                      <TableCell sx={{ fontFamily: 'monospace' }}>{row.id}</TableCell>
                      <TableCell sx={{ fontFamily: 'monospace' }}>{row.code || '—'}</TableCell>
                      <TableCell sx={{ fontWeight: 500 }}>{row.title}</TableCell>
                      <TableCell>{row.category || '—'}</TableCell>
                      <TableCell align="center">{Number(row.netReceived || 0).toLocaleString()}</TableCell>
                      <TableCell align="center">{Number(row.netSales || 0).toLocaleString()}</TableCell>
                      <TableCell align="center">{Number(row.totalShipped || 0).toLocaleString()}</TableCell>
                      <TableCell align="center">{Number(row.remainingToShip ?? row.remainingToFulfill ?? 0).toLocaleString()}</TableCell>
                      <TableCell align="center" sx={{ fontWeight: 'bold', fontSize: '1rem' }}>
                        {Number(row.stockBalance ?? row.stock ?? 0).toLocaleString()}
                      </TableCell>
                      <TableCell align="center" sx={{ fontWeight: 'bold', color: Number(row.shippableStockBalance ?? row.rawAvailableToShip ?? 0) < 0 ? 'error.main' : 'success.main' }}>
                        {Number(row.shippableStockBalance ?? row.rawAvailableToShip ?? 0).toLocaleString()}
                      </TableCell>
                      <TableCell align="center" sx={{ fontWeight: 'bold', color: row.availableToShip > 0 ? 'success.main' : 'warning.main' }}>
                        {Number(row.availableToShip || 0).toLocaleString()}
                      </TableCell>
                      <TableCell>{getStockChip(Number(row.stockBalance ?? row.stock ?? 0))}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}

          {/* Pagination */}
          <Box sx={{
            p: 2,
            display: 'flex',
            flexDirection: { xs: 'column', sm: 'row' },
            gap: { xs: 2, sm: 0 },
            justifyContent: 'space-between',
            alignItems: 'center',
            borderTop: '1px solid rgba(224,224,224,1)'
          }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="body2" color="textSecondary">عدد:</Typography>
              <Select size="small" value={stockLimit} onChange={(e) => { setStockLimit(e.target.value); setStockOffset(0); }} sx={{ minWidth: 60 }}>
                <MenuItem value={10}>10</MenuItem>
                <MenuItem value={25}>25</MenuItem>
                <MenuItem value={50}>50</MenuItem>
              </Select>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Button size="small" disabled={stockOffset === 0} onClick={() => setStockOffset(stockOffset - stockLimit)}>السابق</Button>
              <Typography variant="body2" sx={{ fontWeight: 'bold' }}>({stockOffset + 1} - {stockOffset + stockData.length})</Typography>
              <Button size="small" disabled={stockData.length < stockLimit} onClick={() => setStockOffset(stockOffset + stockLimit)}>التالي</Button>
            </Box>
          </Box>
        </Paper>
      </TabPanel>

      {/* ── TAB 1: Transaction Ledger ── */}
      <TabPanel value={tab} index={1}>
        {/* Filters */}
        <Grid container spacing={2} sx={{ mb: 2 }} alignItems="center" className="filter-grid">
          <Grid item xs={12} sm={4} md={3}>
            <TextField
              fullWidth size="small" label="معرّف المنتج (Product ID)" type="number"
              value={txProductId}
              onChange={(e) => { setTxProductId(e.target.value); setTxOffset(0); }}
            />
          </Grid>
          <Grid item xs={12} sm={4} md={3}>
            <FormControl fullWidth size="small">
              <InputLabel>نوع الحركة</InputLabel>
              <Select value={txType} onChange={(e) => { setTxType(e.target.value); setTxOffset(0); }} label="نوع الحركة">
                <MenuItem value="">الكل</MenuItem>
                <MenuItem value="receipt">وارد كتب (استلام مخزون)</MenuItem>
                <MenuItem value="sale">مبيعات</MenuItem>
                <MenuItem value="adjustment">تسوية</MenuItem>
                <MenuItem value="return">مرتجع عميل / تصحيح فاتورة</MenuItem>
                <MenuItem value="supplier_return">مرتجع مورد</MenuItem>
                <MenuItem value="receipt_cancellation">عكس إلغاء توريد</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid item>
            <Button variant="outlined" color="inherit" startIcon={<ClearIcon />} onClick={() => { setTxProductId(''); setTxType(''); setTxOffset(0); }}>
              إلغاء
            </Button>
          </Grid>
        </Grid>

        <Paper className="main-table-paper">
          {txLoading ? (
            <LoadingState message="جاري تحميل سجل الحركات..." />
          ) : txData.length === 0 ? (
            <EmptyState title="لا يوجد حركات مسجلة" description="لم يتم تسجيل أي حركة مخزنية بعد." />
          ) : (
            <TableContainer className="scrollable-table-container" sx={{ maxHeight: 550 }}>
              <Table stickyHeader size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 'bold' }}>#</TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>المنتج</TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>نوع الحركة</TableCell>
                    <TableCell align="center" sx={{ fontWeight: 'bold' }}>الكمية</TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>المرجع</TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>بواسطة</TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>التاريخ</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {txData.map((row) => (
                    <TableRow key={row.id} hover>
                      <TableCell sx={{ fontFamily: 'monospace' }}>{row.id}</TableCell>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontWeight: 500 }}>{row.product_title}</Typography>
                        <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: 'monospace' }}>{row.product_code}</Typography>
                      </TableCell>
                      <TableCell>
                        <Chip label={txTypeLabel(row.transaction_type)} color={txTypeColor(row.transaction_type)} size="small" />
                      </TableCell>
                      <TableCell align="center" sx={{ fontWeight: 'bold', color: row.quantity >= 0 ? 'success.main' : 'error.main' }}>
                        {row.quantity >= 0 ? `+${row.quantity}` : row.quantity}
                      </TableCell>
                      <TableCell sx={{ fontFamily: 'monospace', color: 'text.secondary' }}>
                        {row.reference_type}#{row.reference_id}
                      </TableCell>
                      <TableCell>{row.user_full_name || '—'}</TableCell>
                      <TableCell>{row.created_at ? formatEgyptDate(row.created_at) : '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}

          {/* Pagination */}
          <Box sx={{
            p: 2,
            display: 'flex',
            flexDirection: { xs: 'column', sm: 'row' },
            gap: { xs: 2, sm: 0 },
            justifyContent: 'space-between',
            alignItems: 'center',
            borderTop: '1px solid rgba(224,224,224,1)'
          }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="body2" color="textSecondary">عدد:</Typography>
              <Select size="small" value={txLimit} onChange={(e) => { setTxLimit(e.target.value); setTxOffset(0); }} sx={{ minWidth: 60 }}>
                <MenuItem value={10}>10</MenuItem>
                <MenuItem value={25}>25</MenuItem>
                <MenuItem value={50}>50</MenuItem>
              </Select>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Button size="small" disabled={txOffset === 0} onClick={() => setTxOffset(txOffset - txLimit)}>السابق</Button>
              <Typography variant="body2" sx={{ fontWeight: 'bold' }}>({txOffset + 1} - {txOffset + txData.length})</Typography>
              <Button size="small" disabled={txData.length < txLimit} onClick={() => setTxOffset(txOffset + txLimit)}>التالي</Button>
            </Box>
          </Box>
        </Paper>
      </TabPanel>

      {/* ── TAB 2: Receipts ── */}
      <TabPanel value={tab} index={2}>
        <Box sx={{ mb: 2, display: 'flex', justifyContent: 'flex-end' }}>
          <FormControl size="small" sx={{ minWidth: 220 }}>
            <InputLabel>حالة التوريد</InputLabel>
            <Select value={receiptStatus} label="حالة التوريد" onChange={(e) => { setReceiptStatus(e.target.value); setReceiptsOffset(0); }}>
              <MenuItem value="">كل الحالات</MenuItem>
              <MenuItem value="active">نشط</MenuItem>
              <MenuItem value="partially_returned">مرتجع جزئي</MenuItem>
              <MenuItem value="returned">مرتجع بالكامل</MenuItem>
              <MenuItem value="cancelled">ملغى</MenuItem>
            </Select>
          </FormControl>
        </Box>
        <Paper className="main-table-paper">
          {receiptsLoading ? (
            <LoadingState message="جاري تحميل أذونات استلام المخزون..." />
          ) : receipts.length === 0 ? (
            <EmptyState
              title="لا توجد أذونات استلام مخزون"
              description="لم يتم تسجيل أذونات استلام مخزون بعد."
              actionLabel={hasPermission('inventory.receipts.create') ? 'إذن استلام مخزون جديد' : undefined}
              onAction={hasPermission('inventory.receipts.create') ? handleOpenCreateReceipt : undefined}
            />
          ) : (
            <TableContainer className="scrollable-table-container" sx={{ maxHeight: 550 }}>
              <Table stickyHeader size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 'bold' }}>رقم الإذن</TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>المورّد</TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>تاريخ الاستلام</TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>الحالة</TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>ملاحظات</TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>بواسطة</TableCell>
                    <TableCell align="center" sx={{ fontWeight: 'bold' }}>خيارات</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {receipts.map((row) => (
                    <TableRow key={row.id} hover>
                      <TableCell sx={{ fontFamily: 'monospace', fontWeight: 500 }}>{row.receipt_number}</TableCell>
                      <TableCell>{row.supplier_name || '—'}</TableCell>
                      <TableCell>{row.received_date ? formatEgyptDate(row.received_date) : '—'}</TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          label={row.status === 'cancelled' ? 'ملغى' : row.status === 'returned' ? 'مرتجع بالكامل' : row.status === 'partially_returned' ? 'مرتجع جزئي' : 'نشط'}
                          color={row.status === 'cancelled' ? 'error' : row.status === 'returned' ? 'default' : row.status === 'partially_returned' ? 'warning' : 'success'}
                          variant="outlined"
                        />
                      </TableCell>
                      <TableCell sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {row.notes || '—'}
                      </TableCell>
                      <TableCell>{row.user_full_name || '—'}</TableCell>
                      <TableCell align="center">
                        <Tooltip title="عرض تفاصيل الإذن">
                          <IconButton color="primary" onClick={() => handleViewReceipt(row.id)}>
                            <VisibilityIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}

          {/* Pagination */}
          <Box sx={{
            p: 2,
            display: 'flex',
            flexDirection: { xs: 'column', sm: 'row' },
            gap: { xs: 2, sm: 0 },
            justifyContent: 'space-between',
            alignItems: 'center',
            borderTop: '1px solid rgba(224,224,224,1)'
          }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="body2" color="textSecondary">عدد:</Typography>
              <Select size="small" value={receiptsLimit} onChange={(e) => { setReceiptsLimit(e.target.value); setReceiptsOffset(0); }} sx={{ minWidth: 60 }}>
                <MenuItem value={10}>10</MenuItem>
                <MenuItem value={25}>25</MenuItem>
                <MenuItem value={50}>50</MenuItem>
              </Select>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Button size="small" disabled={receiptsOffset === 0} onClick={() => setReceiptsOffset(receiptsOffset - receiptsLimit)}>السابق</Button>
              <Typography variant="body2" sx={{ fontWeight: 'bold' }}>({receiptsOffset + 1} - {receiptsOffset + receipts.length})</Typography>
              <Button size="small" disabled={receipts.length < receiptsLimit} onClick={() => setReceiptsOffset(receiptsOffset + receiptsLimit)}>التالي</Button>
            </Box>
          </Box>
        </Paper>
      </TabPanel>

      {/* ══════ CREATE RECEIPT Drawer ══════ */}
      <EntityDrawer
        open={openCreateReceipt}
        onClose={() => !rcSubmitting && setOpenCreateReceipt(false)}
        title="تسجيل إذن استلام مخزون جديد"
        actions={
          <>
            <Button variant="outlined" color="inherit" onClick={() => setOpenCreateReceipt(false)} disabled={rcSubmitting}>إلغاء</Button>
            <Button variant="contained" color="primary" type="submit" form="create-receipt-form" disabled={rcSubmitting}>
              {rcSubmitting ? 'جاري التسجيل...' : 'تأكيد وتسجيل استلام المخزون'}
            </Button>
          </>
        }
      >
        <form onSubmit={handleSubmitReceipt} id="create-receipt-form">
          <FormSection title="البيانات الأساسية لإذن استلام المخزون">
            <FieldGrid columns={2}>
              <TextField fullWidth label="اسم المورّد (اختياري)" size="small" value={rcSupplier} onChange={(e) => setRcSupplier(e.target.value)} />
              <TextField fullWidth required label="تاريخ الاستلام" size="small" type="date" InputLabelProps={{ shrink: true }} InputProps={{ notched: true }} value={rcDate} onChange={(e) => setRcDate(e.target.value)} />
            </FieldGrid>
            <Box sx={{ mt: 2 }}>
              <TextField fullWidth label="ملاحظات" size="small" multiline rows={2} value={rcNotes} onChange={(e) => setRcNotes(e.target.value)} />
            </Box>
          </FormSection>

          <FormSection title="أصناف استلام المخزون">
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
              <Button size="small" startIcon={<AddIcon />} onClick={handleRcAddItem} variant="outlined" color="secondary">إضافة صنف</Button>
            </Box>

            {rcItems.map((item, idx) => (
              <Box key={idx} sx={{ display: 'flex', gap: 2, alignItems: 'center', mb: 2 }}>
                <FormControl fullWidth size="small" required sx={{ flex: 2 }}>
                  <InputLabel>الكتاب</InputLabel>
                  <Select
                    value={item.productId}
                    label="الكتاب"
                    onChange={(e) => handleRcItemChange(idx, 'productId', e.target.value)}
                  >
                    <MenuItem value="" disabled>اختر كتاباً...</MenuItem>
                    {allProducts.map(p => (
                      <MenuItem key={p.id} value={p.id}>
                        {p.title} ({p.code})
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <TextField required label="الكمية" size="small" type="number" inputProps={{ min: 1 }} sx={{ flex: 1.5 }}
                  value={item.quantity} onChange={(e) => handleRcItemChange(idx, 'quantity', e.target.value)} />

                <IconButton color="error" onClick={() => handleRcRemoveItem(idx)} disabled={rcItems.length <= 1} size="small">
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Box>
            ))}
          </FormSection>
        </form>
      </EntityDrawer>

      {/* ══════ RECEIPT DETAIL Drawer ══════ */}
      <EntityDrawer
        open={openReceiptDetail}
        onClose={() => setOpenReceiptDetail(false)}
        title="تفاصيل إذن استلام المخزون"
        loading={receiptDetailLoading}
        actions={receiptDetail && (
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {hasPermission('inventory.receipts.reverse') && ['active', 'partially_returned'].includes(receiptDetail.status) && (
              <Button variant="outlined" color="warning" startIcon={<UndoIcon />} onClick={handleOpenSupplierReturn}>
                مرتجع مورد جزئي / كلي
              </Button>
            )}
            {hasPermission('inventory.receipts.reverse') && receiptDetail.status === 'active' && (
              <Button variant="outlined" color="error" onClick={handleCancelReceipt} disabled={cancelSubmitting || !cancelReason.trim()}>
                {cancelSubmitting ? 'جاري الإلغاء...' : 'إلغاء أمر التوريد'}
              </Button>
            )}
            <Button onClick={() => setOpenReceiptDetail(false)} variant="outlined">إغلاق</Button>
          </Box>
        )}
      >
        {receiptDetail ? (
          <Box>
            <Grid container spacing={2} sx={{ mb: 2 }}>
              <Grid item xs={6} sm={3}>
                <Typography variant="caption" color="textSecondary">رقم الإذن</Typography>
                <Typography variant="body1" sx={{ fontWeight: 'bold', fontFamily: 'monospace' }}>{receiptDetail.receipt_number}</Typography>
              </Grid>
              <Grid item xs={6} sm={3}>
                <Typography variant="caption" color="textSecondary">المورّد</Typography>
                <Typography variant="body1">{receiptDetail.supplier_name || '—'}</Typography>
              </Grid>
              <Grid item xs={6} sm={3}>
                <Typography variant="caption" color="textSecondary">تاريخ الاستلام</Typography>
                <Typography variant="body1">{receiptDetail.received_date ? formatEgyptDate(receiptDetail.received_date) : '—'}</Typography>
              </Grid>
              <Grid item xs={6} sm={3}>
                <Typography variant="caption" color="textSecondary">بواسطة</Typography>
                <Typography variant="body1">{receiptDetail.user_full_name || '—'}</Typography>
              </Grid>
              <Grid item xs={6} sm={3}>
                <Typography variant="caption" color="textSecondary">الحالة</Typography>
                <Typography variant="body1" sx={{ fontWeight: 'bold' }}>
                  {receiptDetail.status === 'cancelled' ? 'ملغى' : receiptDetail.status === 'returned' ? 'مرتجع بالكامل' : receiptDetail.status === 'partially_returned' ? 'مرتجع جزئي' : 'نشط'}
                </Typography>
              </Grid>
            </Grid>
            {hasPermission('inventory.receipts.reverse') && receiptDetail.status === 'active' && (
              <Box sx={{ mb: 2 }}>
                <Alert severity="warning" sx={{ mb: 1 }}>
                  الإلغاء الكامل يعكس كميات التوريد حتى لو أصبح رصيد المخزون سالبًا. لن يُسمح بالشحن حتى يتوفر الرصيد الكافي.
                </Alert>
                <TextField
                  fullWidth size="small" label="سبب إلغاء التوريد (مطلوب قبل الإلغاء)"
                  value={cancelReason} onChange={(e) => setCancelReason(e.target.value)}
                />
              </Box>
            )}
            {receiptDetail.status === 'cancelled' && receiptDetail.cancellation_reason && (
              <Alert severity="error" sx={{ mb: 2 }}>
                سبب الإلغاء: {receiptDetail.cancellation_reason}
              </Alert>
            )}
            {receiptDetail.notes && (
              <Alert severity="info" sx={{ mb: 2 }}>{receiptDetail.notes}</Alert>
            )}
            {receiptDetail.items && receiptDetail.items.length > 0 && (
              <TableContainer className="scrollable-table-container" component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 'bold' }}>المنتج</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>الكود</TableCell>
                      <TableCell align="center" sx={{ fontWeight: 'bold' }}>الكمية</TableCell>
                      <TableCell align="center" sx={{ fontWeight: 'bold' }}>المرتجع</TableCell>
                      <TableCell align="center" sx={{ fontWeight: 'bold' }}>المتبقي</TableCell>
                      <TableCell align="center" sx={{ fontWeight: 'bold' }}>القابل للمرتجع من التوريد</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {receiptDetail.items.map((item, i) => (
                      <TableRow key={i}>
                        <TableCell sx={{ fontWeight: 500 }}>{item.product_title}</TableCell>
                        <TableCell sx={{ fontFamily: 'monospace' }}>{item.product_code || '—'}</TableCell>
                        <TableCell align="center" sx={{ fontWeight: 'bold' }}>{item.quantity}</TableCell>
                        <TableCell align="center">{item.returned_quantity || 0}</TableCell>
                        <TableCell align="center">{item.remaining_quantity || 0}</TableCell>
                        <TableCell align="center">{Math.max(0, item.max_returnable || 0)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
            {receiptDetail.returns?.length > 0 && (
              <Box sx={{ mt: 3 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mb: 1 }}>سجل مرتجعات المورد</Typography>
                {receiptDetail.returns.map((supplierReturn) => (
                  <Alert key={supplierReturn.id} severity="info" sx={{ mb: 1 }}>
                    <strong>{supplierReturn.return_number}</strong> — {formatEgyptDate(supplierReturn.return_date)} — {supplierReturn.reason}
                    <Box sx={{ mt: 0.5 }}>{supplierReturn.items?.map(item => `${item.product_title}: ${item.quantity}`).join('، ')}</Box>
                  </Alert>
                ))}
              </Box>
            )}
          </Box>
        ) : (
          !receiptDetailLoading && <EmptyState title="لا توجد بيانات" />
        )}
      </EntityDrawer>

      <Dialog open={openReturnDialog} onClose={() => !returnSubmitting && setOpenReturnDialog(false)} fullWidth maxWidth="md">
        <DialogTitle>تسجيل مرتجع مورد من أمر التوريد</DialogTitle>
        <form onSubmit={handleSubmitSupplierReturn}>
          <DialogContent dividers>
            <Alert severity="warning" sx={{ mb: 2 }}>
              يمكن تسجيل المرتجع حتى لو أدى ذلك إلى رصيد مخزون سالب. سيظل الشحن متوقفًا حتى يتوفر رصيد فعلي كافٍ.
            </Alert>
            <Grid container spacing={2} sx={{ mb: 2 }}>
              <Grid item xs={12} sm={6}>
                <TextField fullWidth required size="small" type="date" label="تاريخ المرتجع" InputLabelProps={{ shrink: true }} value={returnDate} onChange={(e) => setReturnDate(e.target.value)} />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField fullWidth required size="small" label="سبب المرتجع" value={returnReason} onChange={(e) => setReturnReason(e.target.value)} />
              </Grid>
              <Grid item xs={12}>
                <TextField fullWidth size="small" multiline rows={2} label="ملاحظات" value={returnNotes} onChange={(e) => setReturnNotes(e.target.value)} />
              </Grid>
            </Grid>
            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead><TableRow><TableCell>الكتاب</TableCell><TableCell align="center">المتبقي</TableCell><TableCell align="center">القابل للمرتجع من التوريد</TableCell><TableCell align="center">كمية المرتجع</TableCell></TableRow></TableHead>
                <TableBody>{returnItems.map((item) => (
                  <TableRow key={item.receiptItemId}>
                    <TableCell>{item.productTitle}</TableCell>
                    <TableCell align="center">{item.remaining}</TableCell>
                    <TableCell align="center">{item.maxReturnable}</TableCell>
                    <TableCell align="center"><TextField size="small" type="number" inputProps={{ min: 0, max: item.maxReturnable }} value={item.quantity} onChange={(e) => setReturnItems(prev => prev.map(row => row.receiptItemId === item.receiptItemId ? { ...row, quantity: e.target.value } : row))} sx={{ width: 120 }} /></TableCell>
                  </TableRow>
                ))}</TableBody>
              </Table>
            </TableContainer>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setOpenReturnDialog(false)} disabled={returnSubmitting}>إلغاء</Button>
            <Button type="submit" variant="contained" color="primary" disabled={returnSubmitting}>{returnSubmitting ? 'جاري التسجيل...' : 'تسجيل المرتجع'}</Button>
          </DialogActions>
        </form>
      </Dialog>

      {/* ══════ ADJUSTMENT Drawer ══════ */}
      <EntityDrawer
        open={openAdjust}
        onClose={() => !adjSubmitting && setOpenAdjust(false)}
        title="تسوية مخزون (زيادة / نقص)"
        actions={
          <>
            <Button variant="outlined" color="inherit" onClick={() => setOpenAdjust(false)} disabled={adjSubmitting}>إلغاء</Button>
            <Button variant="contained" color="warning" type="submit" form="adjustment-form" disabled={adjSubmitting}>
              {adjSubmitting ? 'جاري التسجيل...' : 'تأكيد وتسجيل التسوية'}
            </Button>
          </>
        }
      >
        <form onSubmit={handleSubmitAdjustment} id="adjustment-form">
          <FormSection title="البيانات الأساسية للتسوية">
            <Alert severity="info" sx={{ mb: 2 }}>
              استخدم كمية موجبة لزيادة الرصيد وكمية سالبة لخصم الرصيد (مثلاً: تلف، فقدان).
            </Alert>
            <Box sx={{ mb: 2 }}>
              <TextField fullWidth required label="سبب التسوية" size="small" value={adjReason} onChange={(e) => setAdjReason(e.target.value)}
                placeholder="مثل: جرد فعلي، تلف بضاعة، تصحيح أخطاء..." />
            </Box>
            <Box>
              <TextField fullWidth label="ملاحظات" size="small" multiline rows={2} value={adjNotes} onChange={(e) => setAdjNotes(e.target.value)} />
            </Box>
          </FormSection>

          <FormSection title="أصناف التسوية">
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
              <Button size="small" startIcon={<AddIcon />} onClick={handleAdjAddItem} variant="outlined" color="secondary">إضافة صنف</Button>
            </Box>

            {adjItems.map((item, idx) => (
              <Box key={idx} sx={{ display: 'flex', gap: 2, alignItems: 'center', mb: 2 }}>
                <FormControl fullWidth size="small" required sx={{ flex: 2 }}>
                  <InputLabel>الكتاب</InputLabel>
                  <Select
                    value={item.productId}
                    label="الكتاب"
                    onChange={(e) => handleAdjItemChange(idx, 'productId', e.target.value)}
                  >
                    <MenuItem value="" disabled>اختر كتاباً...</MenuItem>
                    {allProducts.map(p => (
                      <MenuItem key={p.id} value={p.id}>
                        {p.title} ({p.code})
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <TextField required label="الكمية (+/-)" size="small" type="number" sx={{ flex: 1 }}
                  value={item.quantity} onChange={(e) => handleAdjItemChange(idx, 'quantity', e.target.value)} />

                <IconButton color="error" onClick={() => handleAdjRemoveItem(idx)} disabled={adjItems.length <= 1} size="small">
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Box>
            ))}
          </FormSection>
        </form>
      </EntityDrawer>

      {/* Snackbar Toast */}
      <Snackbar open={!!toastMsg} autoHideDuration={4000} onClose={() => setToastMsg('')} anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}>
        <Alert onClose={() => setToastMsg('')} severity={toastSeverity} sx={{ width: '100%' }}>{toastMsg}</Alert>
      </Snackbar>
    </Box>
  );
};

export default Inventory;
