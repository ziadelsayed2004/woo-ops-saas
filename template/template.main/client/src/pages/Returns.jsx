import React, { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { apiClient } from '../services/apiClient';
import { useAuth } from '../app/AuthContext';
import { formatCurrencyEGP, formatEgyptDateTime, formatEgyptDate } from '../utils/formatters';
import LoadingState from '../components/LoadingState';
import EmptyState from '../components/EmptyState';
import EntityDrawer from '../components/EntityDrawer';
import { FormSection } from '../components/forms/FormSection';
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
  Tooltip
} from '@mui/material';
import {
  Search as SearchIcon,
  Visibility as VisibilityIcon,
  FilterList as FilterIcon,
  Clear as ClearIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  History as HistoryIcon,
  Print as PrintIcon,
  Receipt as ReceiptIcon
} from '@mui/icons-material';

export const Returns = ({ standalone = true }) => {
  const { hasPermission } = useAuth();
  const location = useLocation();

  // Core Data States
  const [returnsList, setReturnsList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [outlets, setOutlets] = useState([]);

  // Pagination
  const [limit, setLimit] = useState(25);
  const [offset, setOffset] = useState(0);

  // Filters State
  const [showFilters, setShowFilters] = useState(false);
  const [filterOutletId, setFilterOutletId] = useState('');
  const [filterInvoiceId, setFilterInvoiceId] = useState('');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');

  // Details Drawer State
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsReturn, setDetailsReturn] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);

  // Toast notifications
  const [toastMsg, setToastMsg] = useState('');
  const [toastSeverity, setToastSeverity] = useState('success');

  const showToast = (msg, severity = 'success') => {
    setToastMsg(msg);
    setToastSeverity(severity);
  };

  // ---- Fetch Data Functions ----

  const fetchReturns = useCallback(async () => {
    setLoading(true);
    try {
      let query = `/returns?limit=${limit}&offset=${offset}`;
      if (filterOutletId) query += `&outletId=${filterOutletId}`;
      if (filterInvoiceId) query += `&invoiceId=${filterInvoiceId}`;

      const data = await apiClient.get(query);
      
      // Filter by Date Range on Client Side since returns routes does not support date filtering natively
      let filtered = data || [];
      if (filterStartDate) {
        filtered = filtered.filter(r => r.created_at >= filterStartDate);
      }
      if (filterEndDate) {
        filtered = filtered.filter(r => r.created_at <= `${filterEndDate}T23:59:59`);
      }

      setReturnsList(filtered);
    } catch (err) {
      console.error('Failed to fetch returns:', err);
      showToast(err.message || 'فشل تحميل قائمة المرتجعات.', 'error');
    } finally {
      setLoading(false);
    }
  }, [limit, offset, filterOutletId, filterInvoiceId, filterStartDate, filterEndDate]);

  useEffect(() => {
    fetchReturns();
  }, [fetchReturns]);

  useEffect(() => {
    const fetchOutlets = async () => {
      try {
        const data = await apiClient.get('/outlets');
        setOutlets(data || []);
      } catch (err) {
        console.error('Failed to load outlets metadata:', err);
      }
    };
    fetchOutlets();
  }, []);

  // Deep linking check
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const searchNum = params.get('search') || params.get('returnNumber');
    if (searchNum && returnsList.length > 0) {
      const match = returnsList.find(r => r.return_number === searchNum.trim());
      if (match) {
        handleOpenDetails(match.id);
      }
    }
  }, [location.search, returnsList]);

  // ---- Handlers ----

  const handlePrevPage = () => {
    if (offset >= limit) setOffset(offset - limit);
  };

  const handleNextPage = () => {
    setOffset(offset + limit);
  };

  const handleApplyFilters = () => {
    setOffset(0);
    fetchReturns();
  };

  const handleResetFilters = () => {
    setFilterOutletId('');
    setFilterInvoiceId('');
    setFilterStartDate('');
    setFilterEndDate('');
    setOffset(0);
    showToast('تمت إعادة تعيين خيارات البحث.');
  };

  const handleOpenDetails = async (id) => {
    setDetailsReturn(null);
    setDetailsLoading(true);
    setDetailsOpen(true);
    try {
      const data = await apiClient.get(`/returns/${id}`);
      setDetailsReturn(data);
    } catch (err) {
      console.error(err);
      showToast(err.message || 'فشل تحميل تفاصيل المرتجع.', 'error');
      setDetailsOpen(false);
    } finally {
      setDetailsLoading(false);
    }
  };

  const handlePrintReturn = (ret) => {
    if (!ret) return;
    const printWindow = window.open('', '_blank');
    const itemsHtml = ret.items.map((item, idx) => `
      <tr>
        <td style="border: 1px solid #ccc; padding: 8px; text-align: center;">${idx + 1}</td>
        <td style="border: 1px solid #ccc; padding: 8px;">${item.product_title}</td>
        <td style="border: 1px solid #ccc; padding: 8px; text-align: center;">${item.product_code || '-'}</td>
        <td style="border: 1px solid #ccc; padding: 8px; text-align: center;">${item.quantity}</td>
        <td style="border: 1px solid #ccc; padding: 8px; text-align: left;">${formatCurrencyEGP(item.unit_price)}</td>
        <td style="border: 1px solid #ccc; padding: 8px; text-align: left; font-weight: bold;">${formatCurrencyEGP(item.total_price)}</td>
      </tr>
    `).join('');

    printWindow.document.write(`
      <html dir="rtl" lang="ar">
      <head>
        <title>إيصال مرتجع مبيعات - ${ret.return_number}</title>
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 20px; color: #333; }
          .header { text-align: center; margin-bottom: 30px; border-bottom: 2px double #333; padding-bottom: 10px; }
          .meta-info { width: 100%; margin-bottom: 20px; border-collapse: collapse; }
          .meta-info td { padding: 6px; }
          .items-table { width: 100%; border-collapse: collapse; margin-top: 20px; }
          .items-table th { background-color: #f5f5f5; border: 1px solid #ccc; padding: 8px; font-weight: bold; }
          .footer { margin-top: 50px; text-align: center; font-size: 0.85em; border-top: 1px solid #ccc; padding-top: 10px; }
          .signature-box { display: flex; justify-content: space-between; margin-top: 40px; padding: 0 30px; }
        </style>
      </head>
      <body>
        <div class="header">
          <h2>إدارة دار الكتب</h2>
          <h3>إيصال مرتجع مبيعات</h3>
        </div>
        <table class="meta-info">
          <tr>
            <td><strong>رقم المرتجع:</strong> ${ret.return_number}</td>
            <td><strong>تاريخ الحركة:</strong> ${formatEgyptDateTime(ret.created_at)}</td>
          </tr>
          <tr>
            <td><strong>منفذ البيع / العميل:</strong> ${ret.outlet_name}</td>
            <td><strong>الفاتورة الأصلية:</strong> ${ret.invoice_number}</td>
          </tr>
          <tr>
            <td><strong>سجّلت بواسطة:</strong> ${ret.user_full_name || 'غير معروف'}</td>
            <td><strong>إجمالي قيمة المرتجع:</strong> <span style="font-weight: bold; color: red;">${formatCurrencyEGP(ret.return_value)}</span></td>
          </tr>
          <tr>
            <td colspan="2"><strong>سبب الإرجاع:</strong> ${ret.reason || 'غير محدد'}</td>
          </tr>
        </table>

        <h4>الأصناف المرتجعة:</h4>
        <table class="items-table">
          <thead>
            <tr>
              <th>#</th>
              <th>الكتاب / الصنف</th>
              <th>الرمز SKU</th>
              <th>الكمية المرتجعة</th>
              <th>سعر الوحدة</th>
              <th>الإجمالي</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHtml}
          </tbody>
        </table>

        <div class="signature-box">
          <div>توقيع المندوب / المستلم: ............................</div>
          <div>اعتماد الإدارة المالية: ............................</div>
        </div>

        <div class="footer">
          نظام إدارة دار الكتب - تم الطباعة في ${new Date().toLocaleString('ar-EG')}
        </div>
        <script>
          window.onload = function() { window.print(); window.close(); }
        </script>
      </body>
      </html>
    `);
    printWindow.document.close();
  };

  const handleFetchAndPrintReturn = async (id) => {
    try {
      showToast('جاري تحميل تفاصيل المرتجع للطباعة...', 'info');
      const data = await apiClient.get(`/returns/${id}`);
      handlePrintReturn(data);
    } catch (err) {
      console.error(err);
      showToast(err.message || 'فشل تحميل بيانات المرتجع للطباعة.', 'error');
    }
  };

  return (
    <Box sx={{ p: standalone ? 1 : 0 }}>
      {/* Title & Header Card (Visible in standalone mode only) */}
      {standalone && (
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
          <Typography variant="h5" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
            سجل مرتجعات المبيعات
          </Typography>
        </Box>
      )}

      {/* Expandable Search Filters */}
      <Card sx={{ mb: 3 }}>
        <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
          <Box
            sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
            onClick={() => setShowFilters(!showFilters)}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <FilterIcon color="action" />
              <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
                خيارات البحث وتصفية المرتجعات
              </Typography>
            </Box>
            <IconButton size="small">
              {showFilters ? <ExpandLessIcon /> : <ExpandMoreIcon />}
            </IconButton>
          </Box>

          <Collapse in={showFilters} sx={{ mt: 2 }}>
            <Divider sx={{ my: 1.5 }} />
            <Grid container spacing={2} alignItems="center">
              <Grid item xs={12} sm={4} md={3}>
                <FormControl fullWidth size="small">
                  <InputLabel>منفذ التوزيع</InputLabel>
                  <Select
                    value={filterOutletId}
                    onChange={(e) => setFilterOutletId(e.target.value)}
                    label="منفذ التوزيع"
                  >
                    <MenuItem value="">الكل (All Outlets)</MenuItem>
                    {outlets.map(o => (
                      <MenuItem key={o.id} value={o.id}>{o.name}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={4} md={3}>
                <TextField
                  fullWidth
                  label="رقم الفاتورة الأصلية (ID)"
                  size="small"
                  type="number"
                  value={filterInvoiceId}
                  onChange={(e) => setFilterInvoiceId(e.target.value)}
                />
              </Grid>
              <Grid item xs={6} sm={2} md={3}>
                <TextField
                  fullWidth
                  label="من تاريخ الحركة"
                  size="small"
                  type="date"
                  InputLabelProps={{ shrink: true }}
                  value={filterStartDate}
                  onChange={(e) => setFilterStartDate(e.target.value)}
                />
              </Grid>
              <Grid item xs={6} sm={2} md={3}>
                <TextField
                  fullWidth
                  label="إلى تاريخ الحركة"
                  size="small"
                  type="date"
                  InputLabelProps={{ shrink: true }}
                  value={filterEndDate}
                  onChange={(e) => setFilterEndDate(e.target.value)}
                />
              </Grid>
              <Grid item xs={12} sx={{ display: 'flex', gap: 1, mt: 1 }}>
                <Button variant="contained" color="secondary" startIcon={<FilterIcon />} onClick={handleApplyFilters}>
                  تطبيق البحث
                </Button>
                <Button variant="outlined" color="inherit" startIcon={<ClearIcon />} onClick={handleResetFilters}>
                  إعادة تعيين
                </Button>
              </Grid>
            </Grid>
          </Collapse>
        </CardContent>
      </Card>

      {/* Main Returns Table */}
      <Paper className="main-table-paper">
        {loading ? (
          <LoadingState message="جاري تحميل سجل المرتجعات..." />
        ) : returnsList.length === 0 ? (
          <EmptyState
            title="لا توجد مرتجعات مسجلة"
            description="لم يتم تسجيل أي مرتجعات مبيعات بعد، أو لا توجد نتائج مطابقة لبحثك."
          />
        ) : (
          <TableContainer sx={{ maxHeight: 600 }}>
            <Table stickyHeader size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 'bold' }}># ID</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>رقم المرتجع</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>منفذ البيع / العميل</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>الفاتورة الأصلية</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 'bold' }}>قيمة المرتجع</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>تاريخ الحركة</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>سجّلت بواسطة</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>السبب / البيان</TableCell>
                  <TableCell align="center" sx={{ fontWeight: 'bold', minWidth: 100 }}>خيارات</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {returnsList.map((row) => (
                  <TableRow key={row.id} hover>
                    <TableCell sx={{ fontFamily: 'monospace' }}>{row.id}</TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>{row.return_number}</TableCell>
                    <TableCell>{row.outlet_name}</TableCell>
                    <TableCell>
                      <Chip label={`فاتورة #${row.invoice_number}`} size="small" variant="outlined" />
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 'bold', color: 'error.main' }}>
                      {formatCurrencyEGP(row.return_value)}
                    </TableCell>
                    <TableCell>{formatEgyptDateTime(row.created_at)}</TableCell>
                    <TableCell>{row.user_full_name || 'غير معروف'}</TableCell>
                    <TableCell sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {row.reason || '-'}
                    </TableCell>
                    <TableCell align="center">
                      <Tooltip title="معاينة تفاصيل المرتجع">
                        <IconButton color="primary" onClick={() => handleOpenDetails(row.id)}>
                          <VisibilityIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="طباعة إيصال المرتجع">
                        <IconButton color="secondary" onClick={() => handleFetchAndPrintReturn(row.id)}>
                          <PrintIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}

        {/* Pagination bar */}
        <Box sx={{ p: 2, display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: { xs: 2, sm: 0 }, justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #e0e0e0' }}>
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
            </Select>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Button size="small" disabled={offset === 0} onClick={handlePrevPage}>السابق</Button>
            <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
              ({offset + 1} - {offset + returnsList.length})
            </Typography>
            <Button size="small" disabled={returnsList.length < limit} onClick={handleNextPage}>التالي</Button>
          </Box>
        </Box>
      </Paper>

      {/* ================ DETAILS DRAWER ================ */}
      <EntityDrawer
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        title="تفاصيل إرجاع مبيعات"
        loading={detailsLoading}
        actions={
          <>
            <Button onClick={() => setDetailsOpen(false)} variant="outlined">إغلاق</Button>
            {detailsReturn && (
              <Button
                variant="contained"
                color="secondary"
                startIcon={<PrintIcon />}
                onClick={() => handlePrintReturn(detailsReturn)}
              >
                طباعة الإيصال
              </Button>
            )}
          </>
        }
      >
        {detailsReturn ? (
          <Box>
            <FormSection title="البيانات الأساسية للمرتجع">
              <Grid container spacing={2} sx={{ mb: 2 }}>
                <Grid item xs={12} sm={6}>
                  <Typography variant="caption" color="textSecondary">رقم المرتجع</Typography>
                  <Typography variant="body1" sx={{ fontWeight: 'bold' }}>
                    {detailsReturn.return_number}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography variant="caption" color="textSecondary">تاريخ الحركة</Typography>
                  <Typography variant="body1">
                    {formatEgyptDateTime(detailsReturn.created_at)}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography variant="caption" color="textSecondary">منفذ البيع / الفرع</Typography>
                  <Typography variant="body1" sx={{ fontWeight: 'bold' }}>
                    {detailsReturn.outlet_name}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography variant="caption" color="textSecondary">الفاتورة المرتبطة</Typography>
                  <Typography variant="body1">
                    فاتورة رقم {detailsReturn.invoice_number}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography variant="caption" color="textSecondary">سجّل بواسطة</Typography>
                  <Typography variant="body1">
                    {detailsReturn.user_full_name || 'غير معروف'}
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Typography variant="caption" color="textSecondary">قيمة المرتجع المالية</Typography>
                  <Typography variant="body1" sx={{ fontWeight: 'bold', color: 'error.main' }}>
                    {formatCurrencyEGP(detailsReturn.return_value)}
                  </Typography>
                </Grid>
                {/* Reason field moved to bottom of drawer */}
              </Grid>
            </FormSection>

            <FormSection title="الأصناف المرتجعة ومستويات الكمية">
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead sx={{ backgroundColor: '#f8fafc' }}>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 'bold' }}>الكتاب / المنتج</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>الرمز SKU</TableCell>
                      <TableCell align="center" sx={{ fontWeight: 'bold' }}>الكمية المرتجعة</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 'bold' }}>سعر الوحدة</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 'bold' }}>الإجمالي المسترد</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {detailsReturn.items?.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>{item.product_title}</TableCell>
                        <TableCell className="font-monospace">{item.product_code || '-'}</TableCell>
                        <TableCell align="center" className="font-bold">{item.quantity}</TableCell>
                        <TableCell align="right">{formatCurrencyEGP(item.unit_price)}</TableCell>
                        <TableCell align="right" className="font-bold text-error">
                          {formatCurrencyEGP(item.total_price)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </FormSection>

            <Box sx={{ mt: 3, px: 2 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 0.5, color: 'text.secondary' }}>
                سبب الإرجاع والبيان:
              </Typography>
              <Typography variant="body1" color="text.primary">
                {detailsReturn.reason || 'لا توجد ملاحظات تفصيلية مسجلة.'}
              </Typography>
            </Box>
          </Box>
        ) : (
          !detailsLoading && <EmptyState title="تعذر التحميل" description="لم نتمكن من عرض تفاصيل المرتجع." />
        )}
      </EntityDrawer>

      {/* Snackbar notification */}
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

export default Returns;
