import React, { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { formatCurrencyEGP, formatEgyptDate, formatEgyptDateTime } from '../utils/formatters';
import { useAuth } from '../app/AuthContext';
import { apiClient } from '../services/apiClient';
import LoadingState from '../components/LoadingState';
import EmptyState from '../components/EmptyState';
import EntityDrawer from '../components/EntityDrawer';
import {
  Box,
  Autocomplete,
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
  Tooltip,
  Stepper,
  Step,
  StepLabel,
  Drawer
} from '@mui/material';
import {
  Add as AddIcon,
  Search as SearchIcon,
  Visibility as VisibilityIcon,
  FilterList as FilterIcon,
  Clear as ClearIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  LocalShipping as ShipIcon,
  Edit as EditIcon,
  Delete as DeleteIcon
} from '@mui/icons-material';

import '../styles/Shipments.css';

export const Shipments = () => {
  const { hasPermission } = useAuth();
  const location = useLocation();

  const [shipments, setShipments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [limit, setLimit] = useState(25);
  const [offset, setOffset] = useState(0);

  // Filters
  const [showFilters, setShowFilters] = useState(false);
  const [filterInvoiceId, setFilterInvoiceId] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  // Toast
  const [toastMsg, setToastMsg] = useState('');
  const [toastSeverity, setToastSeverity] = useState('success');
  const showToast = (msg, severity = 'success') => { setToastMsg(msg); setToastSeverity(severity); };

  // Detail dialog
  const [openDetail, setOpenDetail] = useState(false);
  const [detailData, setDetailData] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Create Shipment dialog
  const [openCreate, setOpenCreate] = useState(false);
  const [csInvoiceId, setCsInvoiceId] = useState('');
  const [csCarrier, setCsCarrier] = useState('');
  const [csTracking, setCsTracking] = useState('');
  const [csItems, setCsItems] = useState([{ invoiceItemId: '', quantity: '' }]);
  const [csSubmitting, setCsSubmitting] = useState(false);
  const [loadedInvoice, setLoadedInvoice] = useState(null);
  const [loadingInvoice, setLoadingInvoice] = useState(false);
  const [invoicesList, setInvoicesList] = useState([]);

  // Update Status dialog
  const [openStatusDlg, setOpenStatusDlg] = useState(false);
  const [statusShipmentId, setStatusShipmentId] = useState(null);
  const [statusCurrentStatus, setStatusCurrentStatus] = useState('');
  const [statusNewStatus, setStatusNewStatus] = useState('');
  const [statusNotes, setStatusNotes] = useState('');
  const [statusSubmitting, setStatusSubmitting] = useState(false);

  // ── Data fetching ──

  const fetchShipments = useCallback(async () => {
    setLoading(true);
    try {
      let q = `/shipments?limit=${limit}&offset=${offset}`;
      if (filterInvoiceId) q += `&invoiceId=${filterInvoiceId}`;
      if (filterStatus) q += `&status=${filterStatus}`;
      const data = await apiClient.get(q);
      setShipments(data);
    } catch (err) {
      showToast(err.message || 'فشل تحميل سجل الشحنات.', 'error');
    } finally {
      setLoading(false);
    }
  }, [limit, offset, filterInvoiceId, filterStatus]);

  useEffect(() => { fetchShipments(); }, [fetchShipments]);

  useEffect(() => {
    if (!csInvoiceId) {
      setLoadedInvoice(null);
      return;
    }
    const timer = setTimeout(async () => {
      setLoadingInvoice(true);
      try {
        const inv = await apiClient.get(`/invoices/${csInvoiceId}`);
        const remainingItems = await apiClient.get(`/shipments/invoice/${csInvoiceId}/remaining`);

        // Merge the actual remaining quantities into the invoice items
        const updatedItems = inv.items.map(item => {
          const remItem = remainingItems.find(r => r.invoice_item_id === item.id);
          return {
            ...item,
            shipped_quantity: remItem ? remItem.shipped_quantity : item.shipped_quantity,
            returned_quantity: remItem ? remItem.returned_quantity : 0,
            remaining_quantity: remItem ? remItem.remaining_quantity : item.remaining_quantity,
            product_available_to_ship: remItem ? remItem.product_available_to_ship : null,
            product_shippable_stock_balance: remItem ? remItem.product_shippable_stock_balance : null,
            shipping_supply_gap: remItem ? remItem.shipping_supply_gap : 0,
            product_supply_required_to_fulfill: remItem ? remItem.product_supply_required_to_fulfill : 0,
            max_shippable_quantity: remItem ? remItem.max_shippable_quantity : item.remaining_quantity
          };
        });

        setLoadedInvoice({ ...inv, items: updatedItems });
      } catch (err) {
        setLoadedInvoice(null);
      } finally {
        setLoadingInvoice(false);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [csInvoiceId]);

  // Automatically pre-populate csItems with all shippable items when loadedInvoice is loaded
  useEffect(() => {
    if (loadedInvoice) {
      const initialItems = loadedInvoice.items
        .filter(it => it.max_shippable_quantity > 0)
        .map(it => ({
          invoiceItemId: String(it.id),
          quantity: String(it.max_shippable_quantity)
        }));
      setCsItems(initialItems.length > 0 ? initialItems : [{ invoiceItemId: '', quantity: '' }]);
    } else {
      setCsItems([{ invoiceItemId: '', quantity: '' }]);
    }
  }, [loadedInvoice]);


  // Deep linking from Invoices
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const invId = params.get('invoiceId');
    const act = params.get('action');
    if (invId && act === 'create' && hasPermission('shipments.create')) {
      const prepareDrawer = async () => {
        try {
          const list = await apiClient.get('/invoices?limit=500');
          const filtered = list.filter(inv => inv.shipping_status === 'pending' || inv.shipping_status === 'partially_shipped');
          setInvoicesList(filtered);
        } catch (err) {
          console.error(err);
        }
        setCsInvoiceId(invId);
        setCsCarrier('');
        setCsTracking('');
        setCsItems([{ invoiceItemId: '', quantity: '' }]);
        setOpenCreate(true);
      };
      prepareDrawer();
    }
  }, [location.search]);

  // ── Detail ──

  const handleViewDetail = async (id) => {
    setDetailData(null);
    setDetailLoading(true);
    setOpenDetail(true);
    try {
      const data = await apiClient.get(`/shipments/${id}`);
      setDetailData(data);
    } catch (err) {
      showToast(err.message || 'فشل تحميل تفاصيل الشحنة.', 'error');
      setOpenDetail(false);
    } finally {
      setDetailLoading(false);
    }
  };

  // ── Create Shipment ──

  const handleOpenCreate = async () => {
    if (!hasPermission('shipments.create')) {
      showToast('ليس لديك صلاحية لإنشاء الشحنات.', 'error');
      return;
    }
    setCsInvoiceId('');
    setCsCarrier('');
    setCsTracking('');
    setCsItems([{ invoiceItemId: '', quantity: '' }]);
    setLoadedInvoice(null);
    setLoadingInvoice(false);
    setOpenCreate(true);
    try {
      const list = await apiClient.get('/invoices?limit=500');
      const filtered = list.filter(inv => inv.shipping_status === 'pending' || inv.shipping_status === 'partially_shipped');
      setInvoicesList(filtered);
    } catch (err) {
      console.error('Error fetching active invoices:', err);
    }
  };

  const handleCsAddItem = () => {
    setCsItems([...csItems, { invoiceItemId: '', quantity: '' }]);
  };

  const handleCsRemoveItem = (index) => {
    if (csItems.length > 1) setCsItems(csItems.filter((_, i) => i !== index));
  };

  const handleCsItemChange = (index, field, value) => {
    const updated = [...csItems];
    updated[index][field] = value;
    setCsItems(updated);
  };

  const handleSubmitCreate = async (e) => {
    e.preventDefault();
    if (!hasPermission('shipments.create')) {
      showToast('ليس لديك صلاحية لإنشاء الشحنات.', 'error');
      return;
    }
    if (!csInvoiceId) {
      showToast('رقم الفاتورة مطلوب.', 'error');
      return;
    }

    if (!loadedInvoice) {
      showToast('يرجى إدخال رقم فاتورة صحيح وتحميل تفاصيلها أولاً.', 'error');
      return;
    }

    // Filter items with quantity > 0
    const itemsToSubmit = csItems
      .map(i => ({
        invoiceItemId: parseInt(i.invoiceItemId, 10),
        quantity: parseInt(i.quantity, 10) || 0
      }))
      .filter(i => i.quantity > 0);

    if (itemsToSubmit.length === 0) {
      showToast('يرجى تحديد كمية أكبر من الصفر لصنف واحد على الأقل للشحن.', 'error');
      return;
    }

    // Client-side quantity validation
    for (const item of itemsToSubmit) {
      const invItem = loadedInvoice.items.find(i => i.id === item.invoiceItemId);
      if (!invItem) {
        showToast('صنف الفاتورة المحدد غير صالح.', 'error');
        return;
      }
      if (item.quantity > invItem.remaining_quantity) {
        showToast(`الكمية المطلوبة للكتاب "${invItem.product_title}" (${item.quantity}) تتجاوز الكمية المتبقية غير المشحونة وهي ${invItem.remaining_quantity}.`, 'error');
        return;
      }
      const maxShippable = invItem.max_shippable_quantity ?? invItem.remaining_quantity;
      if (item.quantity > maxShippable) {
        showToast(`الكمية المطلوبة للكتاب "${invItem.product_title}" (${item.quantity}) تتجاوز المتاح الفعلي للشحن وهو ${maxShippable}.`, 'error');
        return;
      }
    }

    setCsSubmitting(true);
    try {
      await apiClient.post('/shipments', {
        invoiceId: parseInt(csInvoiceId, 10),
        shippingCarrier: csCarrier,
        trackingNumber: csTracking,
        items: itemsToSubmit
      });
      const shipsAllRemaining = loadedInvoice.items.every(invoiceItem => {
        if (invoiceItem.remaining_quantity <= 0) return true;
        const submittedItem = itemsToSubmit.find(item => item.invoiceItemId === invoiceItem.id);
        return submittedItem && submittedItem.quantity === invoiceItem.remaining_quantity;
      });
      showToast(shipsAllRemaining
        ? 'تم شحن كل الكميات وتحديث حالة الفاتورة إلى تم الشحن.'
        : 'تم تسجيل الشحن الجزئي وتحديث حالة الفاتورة إلى مشحون جزئيًا.');
      setOpenCreate(false);
      fetchShipments();
    } catch (err) {
      showToast(err.message || 'فشل إنشاء الشحنة.', 'error');
    } finally {
      setCsSubmitting(false);
    }
  };

  // ── Update Status ──

  const handleOpenStatus = (shipment) => {
    const canUpdate = hasPermission('shipments.update');
    if (!canUpdate) {
      showToast('ليس لديك صلاحية لتحديث حالة الشحنة.', 'error');
      return;
    }
    setStatusShipmentId(shipment.id);
    setStatusCurrentStatus(shipment.status);
    setStatusNewStatus('');
    setStatusNotes('');
    setOpenStatusDlg(true);
  };

  const handleSubmitStatus = async () => {
    if (!statusNewStatus) {
      showToast('يجب اختيار الحالة الجديدة.', 'error');
      return;
    }
    if (!hasPermission('shipments.update')) {
      showToast('ليس لديك صلاحية لتنفيذ انتقال الحالة المحدد.', 'error');
      return;
    }
    setStatusSubmitting(true);
    try {
      await apiClient.post(`/shipments/${statusShipmentId}/status`, {
        status: statusNewStatus,
        notes: statusNotes
      });
      showToast('تم تحديث حالة الشحنة بنجاح.');
      setOpenStatusDlg(false);
      fetchShipments();
    } catch (err) {
      showToast(err.message || 'فشل تحديث حالة الشحنة.', 'error');
    } finally {
      setStatusSubmitting(false);
    }
  };

  // ── Helpers ──

  const statusLabel = (s) => {
    switch (s) {
      case 'pending': return 'قيد الانتظار';
      case 'shipped': return 'تم الشحن';
      case 'cancelled': return 'ملغاة';
      default: return s || '—';
    }
  };

  const statusColor = (s) => {
    switch (s) {
      case 'pending': return 'warning';
      case 'shipped': return 'success';
      case 'cancelled': return 'error';
      default: return 'default';
    }
  };

  const statusSteps = ['pending', 'shipped'];
  const getActiveStep = (s) => {
    if (s === 'cancelled') return -1;
    if (s === 'shipped') return 1;
    return 0;
  };

  // ──── Render ────

  return (
    <Box sx={{ p: 1 }}>
      {/* Title */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="h5" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
          تتبع وإصدار الشحنات
        </Typography>
        {hasPermission('shipments.create') && (
          <Button variant="contained" color="primary" startIcon={<AddIcon />} onClick={handleOpenCreate}>
            إنشاء شحنة جديدة
          </Button>
        )}
      </Box>

      {/* Expandable Filters */}
      <Card sx={{ mb: 3 }}>
        <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
          <Box
            sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
            onClick={() => setShowFilters(!showFilters)}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <FilterIcon color="action" />
              <Typography variant="subtitle1" className="filter-panel-title" sx={{ fontWeight: 'bold' }}>خيارات البحث والتصفية</Typography>
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
                  fullWidth label="معرّف الفاتورة (Invoice ID)" size="small" type="number"
                  value={filterInvoiceId}
                  onChange={(e) => setFilterInvoiceId(e.target.value)}
                  InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
                />
              </Grid>
              <Grid item xs={12} sm={4} md={3}>
                <FormControl fullWidth size="small">
                  <InputLabel id="filter-ship-status-select-label">حالة الشحنة</InputLabel>
                  <Select
                    labelId="filter-ship-status-select-label"
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value)}
                    label="حالة الشحنة"
                  >
                    <MenuItem value="">الكل</MenuItem>
                    <MenuItem value="pending">قيد الانتظار</MenuItem>
                    <MenuItem value="shipped">تم الشحن</MenuItem>
                    <MenuItem value="cancelled">ملغاة</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid item>
                <Button variant="contained" color="secondary" startIcon={<FilterIcon />} onClick={() => { setOffset(0); fetchShipments(); }}>
                  تطبيق
                </Button>
              </Grid>
              <Grid item>
                <Button variant="outlined" color="inherit" startIcon={<ClearIcon />} onClick={() => { setFilterInvoiceId(''); setFilterStatus(''); setOffset(0); }}>
                  إلغاء
                </Button>
              </Grid>
            </Grid>
          </Collapse>
        </CardContent>
      </Card>

      {/* Summary stats */}
      {!loading && shipments.length > 0 && (
        <Grid container spacing={2} sx={{ mb: 3 }}>
          {['pending', 'shipped', 'cancelled'].map(st => {
            const count = shipments.filter(s => s.status === st).length;
            const colors = {
              pending: { bg: 'warning.light', fg: 'warning.contrastText' },
              shipped: { bg: 'info.light', fg: 'info.contrastText' },
              cancelled: { bg: 'error.light', fg: 'error.contrastText' }
            };
            return (
              <Grid item xs={12} sm={4} key={st}>
                <Card sx={{ backgroundColor: colors[st].bg, color: colors[st].fg }}>
                  <CardContent sx={{ py: 1.5, textAlign: 'center' }}>
                    <Typography variant="body2">{statusLabel(st)}</Typography>
                    <Typography variant="h5" sx={{ fontWeight: 'bold' }}>{count}</Typography>
                  </CardContent>
                </Card>
              </Grid>
            );
          })}
        </Grid>
      )}

      {/* Shipments Table */}
      <Paper className="main-table-paper">
        {loading ? (
          <LoadingState message="جاري تحميل سجل الشحنات..." />
        ) : shipments.length === 0 ? (
          <EmptyState
            title="لا يوجد شحنات"
            description="لم يتم إنشاء أي شحنات بعد. يمكن إنشاء شحنة جديدة مرتبطة بفاتورة."
            actionLabel={hasPermission('shipments.create') ? 'إنشاء شحنة جديدة' : undefined}
            onAction={hasPermission('shipments.create') ? handleOpenCreate : undefined}
          />
        ) : (
          <TableContainer className="scrollable-table-container" sx={{ maxHeight: 550 }}>
            <Table stickyHeader size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 'bold' }}>رقم الشحنة</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>رقم الفاتورة</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>شركة الشحن</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>رقم التتبع</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>الحالة</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>تاريخ الشحن</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>بواسطة</TableCell>
                  <TableCell align="center" sx={{ fontWeight: 'bold', minWidth: 120 }}>خيارات</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {shipments.map((row) => (
                  <TableRow key={row.id} hover>
                    <TableCell sx={{ fontFamily: 'monospace', fontWeight: 500 }}>{row.shipment_number}</TableCell>
                    <TableCell>
                      <Chip label={row.invoice_number} size="small" color="primary" variant="outlined" sx={{ fontFamily: 'monospace' }} />
                    </TableCell>
                    <TableCell>{row.shipping_carrier || '—'}</TableCell>
                    <TableCell sx={{ fontFamily: 'monospace' }}>{row.tracking_number || '—'}</TableCell>
                    <TableCell>
                      <Chip label={statusLabel(row.status)} color={statusColor(row.status)} size="small" />
                    </TableCell>
                    <TableCell>{row.shipped_at ? formatEgyptDate(row.shipped_at) : '—'}</TableCell>
                    <TableCell>{row.user_full_name || '—'}</TableCell>
                    <TableCell align="center">
                      <Tooltip title="عرض التفاصيل">
                        <IconButton color="primary" onClick={() => handleViewDetail(row.id)}>
                          <VisibilityIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      {hasPermission('shipments.update') && row.status !== 'cancelled' && (
                        <Tooltip title="تحديث الحالة">
                          <IconButton color="secondary" onClick={() => handleOpenStatus(row)}>
                            <EditIcon fontSize="small" />
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

        {/* Pagination */}
        <Box sx={{ p: 2, display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: { xs: 2, sm: 0 }, justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid rgba(224,224,224,1)' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="body2" color="textSecondary">عدد:</Typography>
            <Select size="small" value={limit} onChange={(e) => { setLimit(e.target.value); setOffset(0); }} sx={{ minWidth: 60 }}>
              <MenuItem value={10}>10</MenuItem>
              <MenuItem value={25}>25</MenuItem>
              <MenuItem value={50}>50</MenuItem>
            </Select>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Button size="small" disabled={offset === 0} onClick={() => setOffset(offset - limit)}>السابق</Button>
            <Typography variant="body2" sx={{ fontWeight: 'bold' }}>({offset + 1} - {offset + shipments.length})</Typography>
            <Button size="small" disabled={shipments.length < limit} onClick={() => setOffset(offset + limit)}>التالي</Button>
          </Box>
        </Box>
      </Paper>

      {/* ══════ CREATE SHIPMENT Drawer ══════ */}
      <EntityDrawer
        open={openCreate}
        onClose={() => !csSubmitting && setOpenCreate(false)}
        title="إنشاء شحنة جديدة"
        actions={
          <>
            <Button variant="outlined" color="inherit" onClick={() => setOpenCreate(false)} disabled={csSubmitting}>إلغاء</Button>
            <Button variant="contained" color="primary" type="submit" form="create-shipment-form" disabled={csSubmitting}>
              {csSubmitting ? 'جاري الشحن...' : 'تأكيد شحن الكميات المحددة'}
            </Button>
          </>
        }
      >
        <form onSubmit={handleSubmitCreate} id="create-shipment-form">
          <Alert severity="info" sx={{ mb: 2 }}>
            حدد الكميات المراد شحنها. إذا كانت أقل من المتبقي ستصبح حالة الفاتورة «مشحون جزئيًا»، وإذا شملت كل المتبقي ستصبح «تم الشحن».
          </Alert>
          <Grid container spacing={2} className="shipment-form-grid">
            <Grid item xs={12}>
              <Autocomplete
                options={invoicesList}
                getOptionLabel={(option) => `${option.invoice_number} - ${option.outlet_name}`}
                size="small"
                value={invoicesList.find(inv => inv.id === parseInt(csInvoiceId, 10)) || null}
                onChange={(e, val) => {
                  setCsInvoiceId(val ? val.id.toString() : '');
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    required
                    label="اختر الفاتورة"
                    InputProps={{
                      ...(params.InputProps || {}),
                      endAdornment: (
                        <>
                          {loadingInvoice ? <span className="autocomplete-loader-text">جاري التحميل...</span> : null}
                          {params.InputProps?.endAdornment}
                        </>
                      )
                    }}
                  />
                )}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField fullWidth label="شركة الشحن" size="small"
                value={csCarrier} onChange={(e) => setCsCarrier(e.target.value)} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField fullWidth label="رقم التتبع" size="small"
                value={csTracking} onChange={(e) => setCsTracking(e.target.value)}
                inputProps={{ className: 'ltr-value' }} />
            </Grid>

            {/* Display loaded invoice summary and items list to ship */}
            {loadedInvoice ? (
              <Grid item xs={12}>
                <Box sx={{ mt: 1, mb: 1, p: 1.5, bgcolor: 'action.hover', borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1 }}>بيانات العميل والفاتورة: {loadedInvoice.invoice_number}</Typography>
                  
                  <Grid container spacing={1} sx={{ mb: 2 }}>
                    <Grid item xs={12} sm={6}>
                      <Typography variant="caption" color="textSecondary" display="block">منفذ البيع / العميل</Typography>
                      <Typography variant="body2" sx={{ fontWeight: 'bold' }}>{loadedInvoice.outlet_name}</Typography>
                    </Grid>
                    <Grid item xs={12} sm={6}>
                      <Typography variant="caption" color="textSecondary" display="block">المحافظة والعنوان</Typography>
                      <Typography variant="body2">
                        {loadedInvoice.governorate || '—'} 
                        {loadedInvoice.address_details ? `، ${loadedInvoice.address_details}` : ''}
                      </Typography>
                    </Grid>
                    {loadedInvoice.phone && (
                      <Grid item xs={12}>
                        <Typography variant="caption" color="textSecondary" display="block">رقم الهاتف</Typography>
                        <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{loadedInvoice.phone}</Typography>
                      </Grid>
                    )}
                  </Grid>

                  <Divider sx={{ my: 1.5 }} />
                  <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1 }}>أصناف الفاتورة والكميات المراد شحنها:</Typography>
                  <TableContainer className="scrollable-table-container" component={Paper} variant="outlined">
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ fontWeight: 'bold' }}>اسم الكتاب</TableCell>
                          <TableCell align="center" sx={{ fontWeight: 'bold' }}>المطلب</TableCell>
                          <TableCell align="center" sx={{ fontWeight: 'bold' }}>المشحون</TableCell>
                          <TableCell align="center" sx={{ fontWeight: 'bold' }}>المرتجع</TableCell>
                          <TableCell align="center" sx={{ fontWeight: 'bold' }}>المتبقي للفاتورة</TableCell>
                          <TableCell align="center" sx={{ fontWeight: 'bold' }}>حد الشحن الحالي</TableCell>
                          <TableCell align="center" sx={{ fontWeight: 'bold', width: 120 }}>الكمية للشحن</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {loadedInvoice.items.map((it) => {
                          const itemState = csItems.find(c => c.invoiceItemId === String(it.id));
                          const currentVal = itemState ? itemState.quantity : '0';
                          return (
                            <TableRow key={it.id}>
                              <TableCell>{it.product_title}</TableCell>
                              <TableCell align="center">{it.quantity}</TableCell>
                              <TableCell align="center">{it.shipped_quantity || 0}</TableCell>
                              <TableCell align="center" sx={{ color: 'error.main' }}>{it.returned_quantity || 0}</TableCell>
                              <TableCell align="center" sx={{ fontWeight: 'bold', color: it.remaining_quantity > 0 ? 'warning.main' : 'success.main' }}>
                                {it.remaining_quantity}
                              </TableCell>
                              <TableCell align="center" sx={{ fontWeight: 'bold', color: it.max_shippable_quantity > 0 ? 'success.main' : 'warning.main' }}>
                                <Tooltip title={it.shipping_supply_gap > 0
                                  ? `رصيد الشحن المسجل ${it.product_shippable_stock_balance}. يوجد عجز سابق ${it.shipping_supply_gap} نسخة شُحنت فوق التوريد المسجل، وليست رصيدًا متاحًا.`
                                  : `رصيد المنتج المتاح للشحن: ${it.product_available_to_ship ?? 'غير متتبع'}`}>
                                  <span>{it.max_shippable_quantity ?? it.remaining_quantity}</span>
                                </Tooltip>
                              </TableCell>
                              <TableCell align="center">
                                <TextField
                                  type="number"
                                  size="small"
                                  inputProps={{ min: 0, max: it.max_shippable_quantity ?? it.remaining_quantity }}
                                  disabled={(it.max_shippable_quantity ?? it.remaining_quantity) <= 0}
                                  value={currentVal}
                                  onChange={(e) => {
                                    const updated = [...csItems];
                                    const existingIdx = updated.findIndex(c => c.invoiceItemId === String(it.id));
                                    if (existingIdx >= 0) {
                                      updated[existingIdx].quantity = e.target.value;
                                    } else {
                                      updated.push({ invoiceItemId: String(it.id), quantity: e.target.value });
                                    }
                                    setCsItems(updated);
                                  }}
                                  sx={{ width: 90 }}
                                />
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Box>
              </Grid>
            ) : (
              <Grid item xs={12}>
                <Alert severity="warning">يرجى اختيار الفاتورة لتحميل بيانات الشحن.</Alert>
              </Grid>
            )}
          </Grid>
        </form>
      </EntityDrawer>

      {/* ══════ SHIPMENT DETAIL Drawer ══════ */}
      <EntityDrawer
        open={openDetail}
        onClose={() => setOpenDetail(false)}
        title="تفاصيل الشحنة"
        loading={detailLoading}
        actions={
          <>
            <Button onClick={() => setOpenDetail(false)} variant="outlined">إغلاق</Button>
            {detailData &&
              hasPermission('shipments.update') && detailData.status !== 'cancelled' && (
              <Button
                variant="contained"
                color="secondary"
                startIcon={<ShipIcon />}
                onClick={() => {
                  setOpenDetail(false);
                  handleOpenStatus(detailData);
                }}
              >
                تحديث حالة الشحنة
              </Button>
            )}
          </>
        }
      >
        {detailData ? (
          <Box>
            {/* Shipment Info */}
            <Paper variant="outlined" sx={{ mb: 3, p: { xs: 1.5, sm: 2 }, bgcolor: 'action.hover', borderRadius: 2 }}>
              <Grid container spacing={{ xs: 1.5, sm: 2 }}>
                {[
                  { label: 'رقم الشحنة', value: detailData.shipment_number, mono: true, strong: true },
                  { label: 'رقم الفاتورة', value: detailData.invoice_number, mono: true, chip: true },
                  { label: 'شركة الشحن', value: detailData.shipping_carrier || '—' },
                  { label: 'رقم التتبع', value: detailData.tracking_number || '—', mono: true }
                ].map((field) => (
                  <Grid item xs={12} sm={6} lg={3} key={field.label}>
                    <Box sx={{ height: '100%', minHeight: 86, p: 1.5, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1.5, display: 'flex', flexDirection: 'column', alignItems: 'stretch', justifyContent: 'flex-start' }}>
                      <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1, width: '100%', lineHeight: 1.4 }}>
                        {field.label}
                      </Typography>
                      {field.chip ? (
                        <Chip label={field.value} size="small" color="primary" variant="outlined" sx={{ fontFamily: 'monospace', maxWidth: '100%', alignSelf: 'flex-start', '& .MuiChip-label': { px: 1.5 } }} />
                      ) : (
                        <Typography variant="body1" component="div" sx={{ fontFamily: field.mono ? 'monospace' : 'inherit', fontWeight: field.strong ? 700 : 500, overflowWrap: 'anywhere', width: '100%' }}>
                          {field.value}
                        </Typography>
                      )}
                    </Box>
                  </Grid>
                ))}
              </Grid>
            </Paper>

            {/* Status Stepper */}
            {detailData.status !== 'cancelled' ? (
              <Paper variant="outlined" sx={{ mb: 3, px: { xs: 1, sm: 2 }, py: 2, borderRadius: 2 }}>
                <Stepper activeStep={getActiveStep(detailData.status)} alternativeLabel>
                  {statusSteps.map((step) => (
                    <Step key={step}>
                      <StepLabel>{statusLabel(step)}</StepLabel>
                    </Step>
                  ))}
                </Stepper>
              </Paper>
            ) : (
              <Alert severity="error" sx={{ mb: 3 }}>هذه الشحنة ملغاة.</Alert>
            )}

            {/* Items */}
            {detailData.items && detailData.items.length > 0 && (
              <Box sx={{ mb: 3 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mb: 1 }}>
                  أصناف الشحنة ({detailData.items.length})
                </Typography>
                <TableContainer className="scrollable-table-container" component={Paper}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 'bold' }}>المنتج</TableCell>
                        <TableCell sx={{ fontWeight: 'bold' }}>الكود</TableCell>
                        <TableCell align="center" sx={{ fontWeight: 'bold' }}>الكمية المشحونة</TableCell>
                        {detailData.items.some(item => Object.prototype.hasOwnProperty.call(item, 'unit_price')) && (
                          <TableCell align="right" sx={{ fontWeight: 'bold' }}>سعر الوحدة</TableCell>
                        )}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {detailData.items.map((item, i) => (
                        <TableRow key={i}>
                          <TableCell sx={{ fontWeight: 500 }}>{item.product_title}</TableCell>
                          <TableCell sx={{ fontFamily: 'monospace' }}>{item.product_code || '—'}</TableCell>
                          <TableCell align="center" sx={{ fontWeight: 'bold' }}>{item.quantity}</TableCell>
                          {Object.prototype.hasOwnProperty.call(item, 'unit_price') && (
                            <TableCell align="right">{formatCurrencyEGP(item.unit_price)}</TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Box>
            )}

            {/* Status History */}
            {detailData.history && detailData.history.length > 0 && (
              <Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mb: 1 }}>
                  سجل تغييرات الحالة
                </Typography>
                <TableContainer className="scrollable-table-container" component={Paper}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 'bold' }}>من</TableCell>
                        <TableCell sx={{ fontWeight: 'bold' }}>إلى</TableCell>
                        <TableCell sx={{ fontWeight: 'bold' }}>بواسطة</TableCell>
                        <TableCell sx={{ fontWeight: 'bold' }}>ملاحظات</TableCell>
                        <TableCell sx={{ fontWeight: 'bold' }}>التاريخ</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {detailData.history.map((h, i) => (
                        <TableRow key={i}>
                          <TableCell><Chip label={statusLabel(h.old_status)} size="small" variant="outlined" /></TableCell>
                          <TableCell><Chip label={statusLabel(h.new_status)} color={statusColor(h.new_status)} size="small" /></TableCell>
                          <TableCell>{h.user_full_name || '—'}</TableCell>
                          <TableCell>{h.notes || '—'}</TableCell>
                          <TableCell>{h.created_at ? formatEgyptDateTime(h.created_at) : '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Box>
            )}
          </Box>
        ) : (
          !detailLoading && <EmptyState title="لا توجد بيانات" />
        )}
      </EntityDrawer>

      {/* ══════ UPDATE STATUS DIALOG ══════ */}
      <Dialog open={openStatusDlg} onClose={() => !statusSubmitting && setOpenStatusDlg(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 'bold' }}>تحديث حالة الشحنة</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" sx={{ mb: 2 }}>
            الحالة الحالية: <Chip label={statusLabel(statusCurrentStatus)} color={statusColor(statusCurrentStatus)} size="small" />
          </Typography>
          <FormControl fullWidth size="small" required sx={{ mb: 2 }}>
            <InputLabel id="update-ship-status-select-label">الحالة الجديدة</InputLabel>
            <Select
              labelId="update-ship-status-select-label"
              value={statusNewStatus}
              onChange={(e) => setStatusNewStatus(e.target.value)}
              label="الحالة الجديدة"
            >
              {statusCurrentStatus === 'pending' && hasPermission('shipments.update') && (
                <MenuItem value="shipped">تم الشحن (Shipped)</MenuItem>
              )}
              {statusCurrentStatus === 'pending' && hasPermission('shipments.update') && (
                <MenuItem value="cancelled">ملغاة (Cancelled)</MenuItem>
              )}
              {statusCurrentStatus === 'shipped' && hasPermission('shipments.update') && (
                <MenuItem value="cancelled">ملغاة (Cancelled)</MenuItem>
              )}
            </Select>
          </FormControl>
          <TextField fullWidth label="ملاحظات" size="small" multiline rows={2} value={statusNotes} onChange={(e) => setStatusNotes(e.target.value)} />
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button variant="outlined" color="inherit" onClick={() => setOpenStatusDlg(false)} disabled={statusSubmitting}>إلغاء</Button>
          <Button variant="contained" color="primary" onClick={handleSubmitStatus} disabled={statusSubmitting || !statusNewStatus}>
            {statusSubmitting ? 'جاري التحديث...' : 'تأكيد تحديث الحالة'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Snackbar Toast */}
      <Snackbar open={!!toastMsg} autoHideDuration={4000} onClose={() => setToastMsg('')} anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}>
        <Alert onClose={() => setToastMsg('')} severity={toastSeverity} sx={{ width: '100%' }}>{toastMsg}</Alert>
      </Snackbar>
    </Box>
  );
};

export default Shipments;
