import React, { useState } from 'react';
import EntityDrawer from '../EntityDrawer';
import { formatCurrencyEGP, formatEgyptDate, formatEgyptDateTime } from '../../utils/formatters';
import { t } from '../../locales/t';
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
  Grid,
  Alert,
  Divider,
  Tab,
  Tabs,
  Card,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions
} from '@mui/material';
import {
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
  Payments as PaymentsIcon,
  CheckCircle as CheckCircleIcon,
  LocalShipping as LocalShippingIcon,
  SettingsBackupRestore as SettingsBackupRestoreIcon,
  CloudDownload as DownloadIcon,
  Print as PrintIcon,
  EventNote as EventNoteIcon,
  Receipt as ReceiptIcon
} from '@mui/icons-material';

export default function InvoiceDetailsDrawer({
  open,
  onClose,
  detailsInvoice,
  invoices,
  handleNavigateInvoice,
  hasPermission,
  handlePayHandoff,
  handleMarkPaidHandoff,
  handleShipHandoff,
  handleReturnClick,
  handleSinglePdfExport,
  handleSinglePdfPrint,
  handlePrintInvoice,
  detailsTabValue,
  setDetailsTabValue,
  handleMarkPaymentSupplied
}) {
  const [receiptPreview, setReceiptPreview] = useState(null);
  const hasPricing = detailsInvoice && (
    Object.prototype.hasOwnProperty.call(detailsInvoice, 'total_price') ||
    Object.prototype.hasOwnProperty.call(detailsInvoice, 'author_subtotal')
  );
  const hasPaymentSummary = detailsInvoice && Object.prototype.hasOwnProperty.call(detailsInvoice, 'remaining_amount');
  const kpiCardStyle = {
    p: 2,
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center'
  };

  const getRemainingCardStyle = (remainingAmount) => ({
    p: 2,
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    borderColor: remainingAmount > 0 ? 'warning.light' : 'divider'
  });

  const getPaymentStatusChip = (status) => {
    switch (status) {
      case 'paid':
        return <Chip label="مسددة" color="success" size="small" />;
      case 'unpaid':
        return <Chip label="غير مسددة" color="error" size="small" />;
      case 'partially_paid':
        return <Chip label="مسددة جزئياً" color="warning" size="small" />;
      case 'overdue':
        return <Chip label="متأخرة" color="secondary" size="small" />;
      default:
        return <Chip label={status || 'غير معروف'} size="small" />;
    }
  };

  const getShippingStatusChip = (status) => {
    switch (status) {
      case 'pending':
        return <Chip label="قيد الانتظار" variant="outlined" color="warning" size="small" />;
      case 'shipped':
        return <Chip label="تم الشحن" color="success" size="small" />;
      case 'partially_shipped':
        return <Chip label="شحن جزئي" variant="outlined" color="info" size="small" />;
      default:
        return <Chip label={status || 'غير معروف'} size="small" />;
    }
  };

  const translatePaymentType = (type) => {
    switch (type) {
      case 'cash':
        return 'نقدي';
      case 'deferred':
        return 'آجل';
      case 'installments':
        return 'أقساط';
      case 'mixed':
        return 'مختلط';
      default:
        return type;
    }
  };

  return (
    <EntityDrawer
      open={open}
      onClose={onClose}
      title={
        detailsInvoice ? (() => {
          const currentIndex = invoices.findIndex(inv => inv.id === detailsInvoice.id);
          const hasPrevInvoice = currentIndex > 0;
          const hasNextInvoice = currentIndex !== -1 && currentIndex < invoices.length - 1;
          return (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, width: '100%' }}>
              <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
                عرض تفاصيل الفاتورة: {detailsInvoice.invoice_number}
              </Typography>
              {invoices.length > 1 && currentIndex !== -1 && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mr: 'auto', ml: 2 }}>
                  <IconButton 
                    size="small" 
                    disabled={!hasPrevInvoice} 
                    onClick={() => handleNavigateInvoice('prev')}
                    title="الفاتورة السابقة"
                  >
                    <ChevronRightIcon />
                  </IconButton>
                  <Typography variant="body2" sx={{ minWidth: 50, textAlign: 'center', fontWeight: 'medium', color: 'text.secondary' }}>
                    {currentIndex + 1} / {invoices.length}
                  </Typography>
                  <IconButton 
                    size="small" 
                    disabled={!hasNextInvoice} 
                    onClick={() => handleNavigateInvoice('next')}
                    title="الفاتورة التالية"
                  >
                    <ChevronLeftIcon />
                  </IconButton>
                </Box>
              )}
            </Box>
          );
        })() : ''
      }
      size="full"
      actions={
        detailsInvoice && (
          <>
            {hasPermission('payments.create') && detailsInvoice.payment_status !== 'cancelled' && detailsInvoice.remaining_amount > 0 && (
              <Button
                variant="contained"
                color="success"
                startIcon={<PaymentsIcon />}
                onClick={() => {
                  onClose();
                  handlePayHandoff(detailsInvoice);
                }}
              >
                تسجيل دفع
              </Button>
            )}

            {hasPermission('payments.create') && detailsInvoice.payment_status !== 'cancelled' && detailsInvoice.remaining_amount > 0 && (
              <Button
                variant="contained"
                color="success"
                startIcon={<CheckCircleIcon />}
                onClick={() => {
                  onClose();
                  handleMarkPaidHandoff(detailsInvoice);
                }}
              >
                إغلاق كمدفوع كلياً
              </Button>
            )}

            {hasPermission('shipments.create') && detailsInvoice.payment_status !== 'cancelled' && (
              <Button
                variant="contained"
                color="warning"
                startIcon={<LocalShippingIcon />}
                onClick={() => {
                  onClose();
                  handleShipHandoff(detailsInvoice);
                }}
              >
                إنشاء شحنة
              </Button>
            )}

            {hasPermission('returns.create') && detailsInvoice.payment_status !== 'cancelled' && (
              <Button
                variant="contained"
                color="secondary"
                startIcon={<SettingsBackupRestoreIcon />}
                onClick={() => {
                  onClose();
                  handleReturnClick(detailsInvoice);
                }}
              >
                إنشاء مرتجع (Return)
              </Button>
            )}

            {hasPermission('invoices.export') && (
              <>
                <Button
                  variant="outlined"
                  color="secondary"
                  startIcon={<DownloadIcon />}
                  onClick={() => handleSinglePdfExport(detailsInvoice.id)}
                >
                  تنزيل PDF
                </Button>
                <Button
                  variant="outlined"
                  color="info"
                  startIcon={<PrintIcon />}
                  onClick={() => handleSinglePdfPrint(detailsInvoice.id)}
                >
                  معاينة وطباعة PDF
                </Button>
              </>
            )}

            {hasPermission('invoices.view') && (
              <Button
                variant="outlined"
                color="primary"
                startIcon={<PrintIcon />}
                onClick={() => handlePrintInvoice(detailsInvoice)}
              >
                طباعة الفاتورة
              </Button>
            )}

            <Button onClick={onClose} variant="contained" color="inherit">
              إغلاق
            </Button>
          </>
        )
      }
    >
      {detailsInvoice && (
        <Box sx={{ flexGrow: 1, pr: 1, pl: 1 }}>
          {/* Responsive summary KPI cards */}
          <Grid container spacing={2} sx={{ mb: 3 }}>
            <Grid item xs={12} sm={6} md={2.4}>
              <Card variant="outlined" sx={kpiCardStyle}>
                <Typography variant="caption" color="textSecondary" sx={{ fontWeight: 500 }}>العميل / المنفذ</Typography>
                <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mt: 0.5 }}>{detailsInvoice.outlet_name}</Typography>
                <Typography variant="caption" color="textSecondary" sx={{ mt: 0.5 }}>
                  المحافظة: {detailsInvoice.governorate || '-'}
                </Typography>
              </Card>
            </Grid>
            {hasPaymentSummary && <Grid item xs={12} sm={6} md={2.4}>
              <Card variant="outlined" sx={getRemainingCardStyle(detailsInvoice.remaining_amount)}>
                <Typography variant="caption" color="textSecondary" sx={{ fontWeight: 500 }}>المبلغ المتبقي (ذمة)</Typography>
                <Typography variant="subtitle1" sx={{ fontWeight: 'bold', color: detailsInvoice.remaining_amount > 0 ? 'error.main' : 'success.main', mt: 0.5 }}>
                  {formatCurrencyEGP(detailsInvoice.remaining_amount)}
                </Typography>
                <Typography variant="caption" color="textSecondary" sx={{ mt: 0.5 }}>
                  المدفوع: {formatCurrencyEGP(detailsInvoice.paid_amount)}
                </Typography>
              </Card>
            </Grid>}
            {hasPaymentSummary && <Grid item xs={12} sm={6} md={2.4}>
              <Card variant="outlined" sx={kpiCardStyle}>
                <Typography variant="caption" color="textSecondary" sx={{ fontWeight: 500 }}>حالة السداد</Typography>
                <Box sx={{ mt: 0.5 }}>{getPaymentStatusChip(detailsInvoice.payment_status)}</Box>
                <Typography variant="caption" color="textSecondary" sx={{ mt: 1 }}>
                  دفعات معتمدة: {formatCurrencyEGP(detailsInvoice.approved_paid_amount ?? detailsInvoice.paid_amount)}
                </Typography>
                {(detailsInvoice.pending_receipt_amount > 0 || detailsInvoice.rejected_receipt_amount > 0) && (
                  <Typography variant="caption" color="warning.main" sx={{ mt: 0.5 }}>
                    قيد المراجعة/مرفوض: {formatCurrencyEGP((detailsInvoice.pending_receipt_amount || 0) + (detailsInvoice.rejected_receipt_amount || 0))}
                  </Typography>
                )}
              </Card>
            </Grid>}
            <Grid item xs={12} sm={6} md={2.4}>
              <Card variant="outlined" sx={kpiCardStyle}>
                <Typography variant="caption" color="textSecondary" sx={{ fontWeight: 500 }}>الشحن والتوزيع</Typography>
                <Box sx={{ mt: 0.5 }}>
                  {getShippingStatusChip(detailsInvoice.shipping_status)}
                </Box>
                {hasPermission('payments.view') && <Typography variant="caption" color="textSecondary" sx={{ mt: 1 }}>
                  طريقة الدفع: {
                    detailsInvoice.payment_status === 'paid' ? 'دفع كلي' :
                    detailsInvoice.payment_status === 'partially_paid' ? 'دفع جزئي' :
                    translatePaymentType(detailsInvoice.payment_type)
                  }
                </Typography>}
              </Card>
            </Grid>
            {hasPricing && <Grid item xs={12} sm={6} md={2.4}>
              <Card variant="outlined" sx={kpiCardStyle}>
                <Typography variant="caption" color="textSecondary" sx={{ fontWeight: 500 }}>الإجمالي بعد المرتجعات</Typography>
                <Typography variant="subtitle1" sx={{ fontWeight: 'bold', color: 'primary.main', mt: 0.5 }}>
                  {formatCurrencyEGP(detailsInvoice.author_subtotal ?? detailsInvoice.net_amount ?? detailsInvoice.total_price)}
                </Typography>
                <Typography variant="caption" color="textSecondary" sx={{ mt: 0.5 }}>
                  تاريخ الفاتورة: {formatEgyptDateTime(detailsInvoice.created_at)}
                </Typography>
              </Card>
            </Grid>}
            <Grid item xs={12} sm={6} md={2.4}>
              <Card variant="outlined" sx={{ ...kpiCardStyle, alignItems: 'center', p: 1, height: '100%' }}>
                <Typography variant="caption" color="textSecondary" sx={{ fontWeight: 500, mb: 0.5 }}>{t('system.qrCode')}</Typography>
                <img 
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(window.location.origin + '/invoices?search=' + detailsInvoice.invoice_number)}`} 
                  alt="Invoice QR Code"
                  className="invoice-qr-code"
                />
                <Typography variant="caption" color="textSecondary" sx={{ mt: 0.5, fontSize: '0.65rem' }}>{t('system.scanToViewInvoice')}</Typography>
              </Card>
            </Grid>
          </Grid>

          {/* Additional notes/conditions section */}
          {detailsInvoice.notes && (
            <Alert severity="info" variant="outlined" icon={false} sx={{ mb: 3 }}>
              <Typography variant="caption" color="textSecondary" display="block">ملاحظات وشروط إضافية:</Typography>
              <Typography variant="body2">{detailsInvoice.notes}</Typography>
            </Alert>
          )}

          {/* Items Table */}
          <Box sx={{ mb: 4 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1.5 }}>أصناف ومواد الفاتورة:</Typography>
            <TableContainer className="scrollable-table-container" component={Paper} variant="outlined">
              <Table size="small">
                <TableHead sx={{ backgroundColor: (theme) => theme.palette.mode === 'dark' ? '#2d2f31' : '#f8fafc' }}>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 'bold' }}>اسم الكتاب</TableCell>
                    <TableCell align="center" sx={{ fontWeight: 'bold' }}>الإجمالي المطلوب</TableCell>
                    <TableCell align="center" sx={{ fontWeight: 'bold' }}>المدفوع</TableCell>
                    <TableCell align="center" sx={{ fontWeight: 'bold' }}>المجاني</TableCell>
                    <TableCell align="center" sx={{ fontWeight: 'bold' }}>المشحون</TableCell>
                    <TableCell align="center" sx={{ fontWeight: 'bold' }}>المرتجع</TableCell>
                    {hasPricing && <TableCell align="right" sx={{ fontWeight: 'bold' }}>سعر الوحدة</TableCell>}
                    {hasPricing && <TableCell align="right" sx={{ fontWeight: 'bold' }}>الإجمالي</TableCell>}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {detailsInvoice.items?.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>{item.product_title}</TableCell>
                      <TableCell align="center" sx={{ fontWeight: 'bold' }}>{item.quantity}</TableCell>
                      <TableCell align="center">{item.quantity - (item.free_quantity || 0)}</TableCell>
                      <TableCell align="center" sx={{ color: item.free_quantity > 0 ? 'success.main' : 'text.secondary', fontWeight: item.free_quantity > 0 ? 'bold' : 'normal' }}>
                        {item.free_quantity || 0}
                      </TableCell>
                      <TableCell align="center">
                        <Chip
                          label={item.shipped_quantity || 0}
                          size="small"
                          color={item.shipped_quantity >= item.quantity ? 'success' : item.shipped_quantity > 0 ? 'warning' : 'default'}
                        />
                      </TableCell>
                      <TableCell align="center" sx={{ color: item.returned_quantity > 0 ? 'error.main' : 'text.secondary' }}>
                        {item.returned_quantity || 0}
                      </TableCell>
                      {hasPricing && <TableCell align="right">{formatCurrencyEGP(item.unit_price)}</TableCell>}
                      {hasPricing && <TableCell align="right" sx={{ fontWeight: 'bold' }}>{formatCurrencyEGP(item.total_price)}</TableCell>}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>

          {/* Totals Section */}
          {hasPricing && <Box sx={{ width: '100%', mb: 4, border: '1px solid', borderColor: 'divider', borderRadius: '8px', p: 2.5, backgroundColor: (theme) => theme.palette.mode === 'dark' ? '#1e1e1e' : '#f8fafc' }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="body2" color="text.secondary">المجموع الفرعي:</Typography>
              <Typography variant="body2" sx={{ fontWeight: 'bold' }}>{formatCurrencyEGP(detailsInvoice.subtotal || 0)}</Typography>
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="body2" color="text.secondary">تكلفة الشحن:</Typography>
              <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'primary.main' }}>+{formatCurrencyEGP(detailsInvoice.shipping_cost || 0)}</Typography>
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="body2" color="text.secondary">الخصم الممنوح:</Typography>
              <Typography variant="body2" sx={{ color: 'error.main', fontWeight: 'bold' }}>
                -{formatCurrencyEGP(detailsInvoice.discount || 0)}
              </Typography>
            </Box>
            <Divider sx={{ my: 1.5 }} />
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="body2" sx={{ fontWeight: 'bold' }}>الإجمالي قبل المرتجعات:</Typography>
              <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                {formatCurrencyEGP(detailsInvoice.total_price)}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1, color: 'error.main' }}>
              <Typography variant="body2" sx={{ fontWeight: 'bold' }}>إجمالي المرتجعات:</Typography>
              <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                -{formatCurrencyEGP(detailsInvoice.returned_amount || 0)}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>الإجمالي بعد المرتجعات:</Typography>
              <Typography variant="subtitle1" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
                {formatCurrencyEGP(detailsInvoice.net_amount ?? detailsInvoice.total_price)}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1, color: 'success.main' }}>
              <Typography variant="body2" sx={{ fontWeight: 'bold' }}>المجموع المسدد:</Typography>
              <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                {formatCurrencyEGP(detailsInvoice.paid_amount || 0)}
              </Typography>
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1, color: 'error.main' }}>
              <Typography variant="body2" sx={{ fontWeight: 'bold' }}>المبلغ المتبقي:</Typography>
              <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                {formatCurrencyEGP(detailsInvoice.remaining_amount || 0)}
              </Typography>
            </Box>
          </Box>}

          <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
            <Tabs value={detailsTabValue} onChange={(e, val) => setDetailsTabValue(val)}>
              {hasPermission('payments.view') && (
                <Tab value={0} label="سجل التحصيلات والمدفوعات" icon={<PaymentsIcon />} iconPosition="start" />
              )}
              {hasPermission('shipments.view') && (
                <Tab value={1} label="شحنات التوصيل" icon={<LocalShippingIcon />} iconPosition="start" />
              )}
              {hasPermission('returns.view') && (
                <Tab value={2} label="مرتجع المبيعات" icon={<SettingsBackupRestoreIcon />} iconPosition="start" />
              )}
              <Tab value={3} label="سجل حالات الفاتورة" icon={<EventNoteIcon />} iconPosition="start" />
            </Tabs>
          </Box>

          {/* TAB 0: Payments */}
          {hasPermission('payments.view') && detailsTabValue === 0 && (
            <Box>
              {detailsInvoice.payments && detailsInvoice.payments.length > 0 ? (
                <TableContainer className="scrollable-table-container" component={Paper}>
                  <Table size="small">
                    <TableHead sx={{ backgroundColor: '#f8fafc' }}>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 'bold' }}>رقم العملية</TableCell>
                        <TableCell sx={{ fontWeight: 'bold' }}>تاريخ السداد</TableCell>
                        <TableCell sx={{ fontWeight: 'bold' }}>طريقة السداد</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 'bold' }}>القيمة</TableCell>
                        <TableCell sx={{ fontWeight: 'bold' }}>حالة التوريد</TableCell>
                        <TableCell sx={{ fontWeight: 'bold' }}>حالة الإيصال</TableCell>
                        <TableCell sx={{ fontWeight: 'bold' }}>سجلت بواسطة</TableCell>
                        <TableCell sx={{ fontWeight: 'bold' }}>ملاحظات</TableCell>
                        <TableCell align="center" sx={{ fontWeight: 'bold' }}>إجراءات</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {detailsInvoice.payments.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell sx={{ fontFamily: 'monospace' }}>{p.receipt_number || p.id}</TableCell>
                          <TableCell>{formatEgyptDate(p.payment_date)}</TableCell>
                          <TableCell>{translatePaymentType(p.payment_method || p.payment_type)}</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 'bold', color: 'success.main' }}>
                            {formatCurrencyEGP(p.amount)}
                          </TableCell>
                          <TableCell>
                            {p.supply_status === 'supplied' ? (
                              <Chip label="مورد" color="success" size="small" variant="outlined" />
                            ) : (
                              <Chip label="غير مورد" color="warning" size="small" variant="outlined" />
                            )}
                          </TableCell>
                          <TableCell>
                            {p.receipt_status === 'pending_review' ? <Chip label="قيد المراجعة" color="warning" size="small" variant="outlined" /> :
                              p.receipt_status === 'rejected' ? <Chip label="مرفوض" color="error" size="small" variant="outlined" /> :
                                <Chip label="معتمد" color="success" size="small" variant="outlined" />}
                          </TableCell>
                          <TableCell>{p.user_full_name || 'غير معروف'}</TableCell>
                          <TableCell>{p.notes}</TableCell>
                          <TableCell align="center">
                            <Box sx={{ display: 'flex', justifyContent: 'center', gap: 0.5, flexWrap: 'wrap' }}>
                              {p.receipt_stored_path && hasPermission('payments.receipt.view') && (
                                <Button size="small" variant="outlined" color="primary" startIcon={<ReceiptIcon />} onClick={() => setReceiptPreview(p)}>
                                  عرض الإيصال
                                </Button>
                              )}
                              {p.supply_status === 'not_supplied' && hasPermission('payments.mark_supplied') && (
                                <Button variant="contained" color="success" size="small" onClick={() => handleMarkPaymentSupplied(p.id)}>
                                  تأكيد التوريد
                                </Button>
                              )}
                            </Box>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              ) : (
                <Typography variant="body2" sx={{ color: 'text.secondary', p: 2, textAlign: 'center' }}>
                  لا يوجد دفعات مسددة مسجلة لهذه الفاتورة حتى الآن.
                </Typography>
              )}
            </Box>
          )}

          {/* TAB 1: Shipments */}
          {hasPermission('shipments.view') && detailsTabValue === 1 && (
            <Box>
              {detailsInvoice.shipments && detailsInvoice.shipments.length > 0 ? (
                <TableContainer className="scrollable-table-container" component={Paper}>
                  <Table size="small">
                    <TableHead sx={{ backgroundColor: '#f8fafc' }}>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 'bold' }}>رقم الشحنة</TableCell>
                        <TableCell sx={{ fontWeight: 'bold' }}>تاريخ الشحن</TableCell>
                        <TableCell sx={{ fontWeight: 'bold' }}>شركة الشحن</TableCell>
                        <TableCell sx={{ fontWeight: 'bold' }}>رقم التتبع</TableCell>
                        <TableCell sx={{ fontWeight: 'bold' }}>الحالة</TableCell>
                        <TableCell sx={{ fontWeight: 'bold' }}>بواسطة</TableCell>
                        <TableCell sx={{ fontWeight: 'bold' }}>الأصناف المشحونة</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {detailsInvoice.shipments.map((s) => (
                        <TableRow key={s.id}>
                          <TableCell sx={{ fontFamily: 'monospace' }}>{s.shipment_number}</TableCell>
                          <TableCell>{formatEgyptDateTime(s.created_at)}</TableCell>
                          <TableCell>{s.shipping_carrier || 'غير محدد'}</TableCell>
                          <TableCell sx={{ fontFamily: 'monospace' }}>{s.tracking_number || '-'}</TableCell>
                          <TableCell>
                            {getShippingStatusChip(s.status)}
                          </TableCell>
                          <TableCell>{s.user_full_name || 'غير معروف'}</TableCell>
                          <TableCell>
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                              {s.items?.map((item) => (
                                <Typography key={item.id} variant="caption" display="block">
                                  - {item.product_title}: <strong>{item.quantity}</strong>
                                </Typography>
                              ))}
                            </Box>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              ) : (
                <Typography variant="body2" sx={{ color: 'text.secondary', p: 2, textAlign: 'center' }}>
                  لا يوجد شحنات مسجلة لهذه الفاتورة حتى الآن.
                </Typography>
              )}
            </Box>
          )}

          {/* TAB 2: Returns */}
          {hasPermission('returns.view') && detailsTabValue === 2 && (
            <Box>
              {detailsInvoice.returns && detailsInvoice.returns.length > 0 ? (
                <TableContainer className="scrollable-table-container" component={Paper}>
                  <Table size="small">
                    <TableHead sx={{ backgroundColor: '#f8fafc' }}>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 'bold' }}>رقم المرتجع</TableCell>
                        <TableCell sx={{ fontWeight: 'bold' }}>تاريخ المرتجع</TableCell>
                        <TableCell sx={{ fontWeight: 'bold' }}>قيمة المرتجع</TableCell>
                        <TableCell sx={{ fontWeight: 'bold' }}>السبب / الملاحظة</TableCell>
                        <TableCell sx={{ fontWeight: 'bold' }}>الحالة</TableCell>
                        <TableCell sx={{ fontWeight: 'bold' }}>بواسطة</TableCell>
                        <TableCell sx={{ fontWeight: 'bold' }}>الأصناف المرتجعة</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {detailsInvoice.returns.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell sx={{ fontFamily: 'monospace' }}>{r.return_number}</TableCell>
                          <TableCell>{formatEgyptDateTime(r.created_at)}</TableCell>
                          <TableCell sx={{ fontWeight: 'bold', color: 'error.main' }}>
                            {formatCurrencyEGP(r.return_value || 0)}
                          </TableCell>
                          <TableCell>{r.reason || '-'}</TableCell>
                          <TableCell>
                            <Chip
                              label={r.status === 'completed' ? 'مكتمل' : r.status === 'cancelled' ? 'ملغي' : r.status}
                              color={r.status === 'completed' ? 'success' : r.status === 'cancelled' ? 'error' : 'default'}
                              size="small"
                              variant="outlined"
                            />
                          </TableCell>
                          <TableCell>{r.user_full_name || 'غير معروف'}</TableCell>
                          <TableCell>
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                              {r.items?.map((item) => (
                                <Typography key={item.id} variant="caption" display="block">
                                  - {item.product_title}: <strong>{item.quantity}</strong>
                                </Typography>
                              ))}
                            </Box>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              ) : (
                <Typography variant="body2" sx={{ color: 'text.secondary', p: 2, textAlign: 'center' }}>
                  لا يوجد مرتجعات مسجلة لهذه الفاتورة حتى الآن.
                </Typography>
              )}
            </Box>
          )}

          {/* TAB 3: Status History */}
          {detailsTabValue === 3 && (
            <Box>
              <TableContainer className="scrollable-table-container" component={Paper}>
                <Table size="small">
                  <TableHead sx={{ backgroundColor: '#f8fafc' }}>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 'bold' }}>تاريخ الحركة</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>النوع</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>الحالة السابقة</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>الحالة الجديدة</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>بواسطة</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>السبب / الملاحظة</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(detailsInvoice.history || [])
                      .filter((historyItem) => {
                        if (historyItem.status_type === 'payment') {
                          return hasPermission('payments.view');
                        }
                        return hasPermission('shipments.view');
                      })
                      .map((h) => (
                      <TableRow key={h.id}>
                        <TableCell>{formatEgyptDateTime(h.created_at)}</TableCell>
                        <TableCell>
                          {h.status_type === 'payment' ? 'دفع مالية' : 'توصيل شحن'}
                        </TableCell>
                        <TableCell>{h.status_type === 'payment' ? getPaymentStatusChip(h.old_status) : getShippingStatusChip(h.old_status)}</TableCell>
                        <TableCell>{h.status_type === 'payment' ? getPaymentStatusChip(h.new_status) : getShippingStatusChip(h.new_status)}</TableCell>
                        <TableCell>{h.user_full_name || 'غير معروف'}</TableCell>
                        <TableCell>{h.notes}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Box>
          )}
        </Box>
      )}
      <Dialog open={!!receiptPreview} onClose={() => setReceiptPreview(null)} fullWidth maxWidth="md">
        <DialogTitle>معاينة إيصال الدفعة {receiptPreview?.receipt_original_name || ''}</DialogTitle>
        <DialogContent dividers sx={{ minHeight: 420, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {receiptPreview && (String(receiptPreview.receipt_mime_type || '').startsWith('image/') ? (
            <Box component="img" src={`/api/payments/${receiptPreview.id}/receipt`} alt={receiptPreview.receipt_original_name || 'إيصال الدفع'} sx={{ maxWidth: '100%', maxHeight: 600, objectFit: 'contain' }} />
          ) : (
            <Box component="iframe" title="معاينة إيصال الدفع" src={`/api/payments/${receiptPreview.id}/receipt`} sx={{ width: '100%', height: 600, border: 0 }} />
          ))}
        </DialogContent>
        <DialogActions><Button onClick={() => setReceiptPreview(null)}>إغلاق</Button></DialogActions>
      </Dialog>
  </EntityDrawer>
  );
}
