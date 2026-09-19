import React from 'react';
import EntityDrawer from '../EntityDrawer';
import { FormSection } from '../forms/FormSection';
import { FieldGrid } from '../forms/FieldGrid';
import { formatCurrencyEGP } from '../../utils/formatters';
import { compressImageAndConvertToBase64 } from '../../utils/fileCompressor';
import { t } from '../../locales/t';
import {
  Button,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  InputAdornment,
  Box,
  Paper,
  Grid,
  Typography,
  Alert,
  IconButton,
  Autocomplete,
  Divider
} from '@mui/material';
import {
  Add as AddIcon,
  Receipt as ReceiptIcon,
  Delete as DeleteIcon
} from '@mui/icons-material';

export default function InvoiceWizardDrawer({
  open,
  onClose,
  formSubmitting,
  formMode,
  formInvoiceNumber,
  formOutletId,
  handleFormOutletChange,
  outlets,
  formCollectionType,
  setFormCollectionType,
  formCollectedAmount,
  setFormCollectedAmount,
  formTotals,
  formPaymentType,
  formPaymentMethod,
  setFormPaymentMethod,
  paymentMethods,
  formDiscount,
  setFormDiscount,
  formShippingCost,
  setFormShippingCost,
  formNotes,
  setFormNotes,
  selectedOutlet,
  formOutletTypeLabel,
  selectedOutletBalance,
  formSupplyStatus,
  setFormSupplyStatus,
  formCollectionNotes,
  setFormCollectionNotes,
  formReceiptName,
  setFormReceiptName,
  formReceiptData,
  setFormReceiptData,
  formItems,
  handleAddFormItem,
  productsList,
  handleFormItemProductChange,
  handleFormItemQtyChange,
  handleFormItemFreeQtyChange,
  handleRemoveFormItem,
  handleFormSubmit,
  setToastMsg,
  setToastSeverity,
  canRecordPayments,
  canViewFinance,
  canSupplyPayments
}) {
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
      onClose={() => !formSubmitting && onClose()}
      title={formMode === 'create' ? 'إنشاء فاتورة مبيعات جديدة' : 'تعديل فاتورة مبيعات'}
      size="large"
      loading={formSubmitting}
      actions={
        <>
          <Button onClick={onClose} variant="outlined" color="inherit" disabled={formSubmitting}>
            إلغاء
          </Button>
          <Button
            variant="contained"
            color="primary"
            type="submit"
            form="invoice-editor-form"
            disabled={formSubmitting}
          >
            {formSubmitting ? 'جاري الحفظ والتحقق من الكميات...' : 'حفظ وتأكيد الفاتورة'}
          </Button>
        </>
      }
    >
      <form onSubmit={handleFormSubmit} id="invoice-editor-form">
        <FormSection title="بيانات العميل والفاتورة">
          <FieldGrid columns={2}>
            <TextField
              required
              fullWidth
              size="small"
              label={t('system.invoiceNumber')}
              value={formInvoiceNumber}
              inputProps={{ className: 'ltr-value', readOnly: true }}
              disabled={true}
            />

            {/* Outlet select */}
            <FormControl fullWidth size="small" required>
              <InputLabel id="form-outlet-select-label">المنفذ / العميل</InputLabel>
              <Select
                labelId="form-outlet-select-label"
                value={formOutletId}
                onChange={(e) => handleFormOutletChange(e.target.value)}
                label="المنفذ / العميل"
                disabled={formMode === 'edit'} // Lock outlet on edit
              >
                {outlets.map((o) => (
                  <MenuItem key={o.id} value={o.id}>
                    {o.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {/* Payment Status (Only on creation) */}
            {canRecordPayments && (formMode === 'create' ? (
              <FormControl fullWidth size="small" required>
                <InputLabel id="form-collection-select-label">حالة الدفع عند الإنشاء</InputLabel>
                <Select
                  labelId="form-collection-select-label"
                  value={formCollectionType}
                  onChange={(e) => {
                    const val = e.target.value;
                    setFormCollectionType(val);
                    if (val === 'none') {
                      setFormCollectedAmount(0);
                    } else if (val === 'full') {
                      setFormCollectedAmount(parseFloat(formTotals.total) || 0);
                    }
                  }}
                  label="حالة الدفع عند الإنشاء"
                >
                  <MenuItem value="none">مؤجل كلياً (Fully Deferred)</MenuItem>
                  <MenuItem value="partial">مدفوع جزئياً (Partially Paid)</MenuItem>
                  <MenuItem value="full">مدفوع كلياً (Fully Paid)</MenuItem>
                </Select>
              </FormControl>
            ) : (
              <TextField
                fullWidth
                label="نوع الدفع"
                size="small"
                disabled
                value={translatePaymentType(formPaymentType)}
              />
            ))}

            {/* Discount */}
            <TextField
              fullWidth
              label="الخصم المباشر الممنوح"
              size="small"
              type="number"
              inputProps={{ step: '0.01', min: '0' }}
              value={formDiscount}
              onChange={(e) => setFormDiscount(Math.max(0, parseFloat(e.target.value) || 0))}
              InputProps={{
                endAdornment: <InputAdornment position="end">ج.م</InputAdornment>
              }}
            />

            {/* Shipping Cost */}
            <TextField
              fullWidth
              label="تكلفة وأجور الشحن والتوصيل"
              size="small"
              type="number"
              inputProps={{ step: '0.01', min: '0' }}
              value={formShippingCost}
              onChange={(e) => setFormShippingCost(Math.max(0, parseFloat(e.target.value) || 0))}
              InputProps={{
                endAdornment: <InputAdornment position="end">ج.م</InputAdornment>
              }}
            />
          </FieldGrid>

          {/* Notes */}
          <Box sx={{ mt: 2 }}>
            <TextField
              fullWidth
              label="ملاحظات وتفاصيل الفاتورة"
              size="small"
              multiline
              rows={2}
              value={formNotes}
              onChange={(e) => setFormNotes(e.target.value)}
            />
          </Box>

          {selectedOutlet && (
            <Paper variant="outlined" sx={{ p: 2, mt: 2, backgroundColor: (theme) => theme.palette.mode === 'dark' ? '#1e1e1e' : '#f8fafc', borderColor: (theme) => theme.palette.mode === 'dark' ? 'primary.dark' : 'primary.light' }}>
              <Grid container spacing={2}>
                <Grid item xs={6} sm={3}>
                  <Typography variant="caption" color="textSecondary" display="block">فئة المنفذ</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 'bold' }}>{formOutletTypeLabel || 'غير محددة'}</Typography>
                </Grid>
                <Grid item xs={6} sm={3}>
                  <Typography variant="caption" color="textSecondary" display="block">المحافظة</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 'bold' }}>{selectedOutlet.governorate || '-'}</Typography>
                </Grid>
                <Grid item xs={6} sm={3}>
                  <Typography variant="caption" color="textSecondary" display="block">الهاتف</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 'bold' }}>{selectedOutlet.phone || '-'}</Typography>
                </Grid>
                {canViewFinance && (
                  <Grid item xs={6} sm={3}>
                    <Typography variant="caption" color="textSecondary" display="block">الحد الائتماني</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 'bold' }}>{formatCurrencyEGP(selectedOutlet.credit_limit || 0)}</Typography>
                  </Grid>
                )}
                <Grid item xs={12} sm={6}>
                  <Typography variant="caption" color="textSecondary" display="block">تفاصيل العنوان</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 'bold' }}>{selectedOutlet.address_details || '-'}</Typography>
                </Grid>
                {canViewFinance && (
                  <Grid item xs={12} sm={6}>
                    <Typography variant="caption" color="textSecondary" display="block">المديونية (الرصيد المعلق الحالي)</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 'bold', color: (selectedOutletBalance?.pending_balance || 0) > 0 ? 'warning.main' : 'success.main' }}>
                      {formatCurrencyEGP(selectedOutletBalance?.pending_balance || 0)}
                    </Typography>
                  </Grid>
                )}
                {canViewFinance && selectedOutlet.credit_limit > 0 && (selectedOutletBalance?.pending_balance || 0) > selectedOutlet.credit_limit && (
                  <Grid item xs={12}>
                    <Alert severity="warning" sx={{ mt: 1 }}>
                      تنبيه: مديونية هذا العميل تتجاوز الحد الائتماني المسموح به!
                    </Alert>
                  </Grid>
                )}
              </Grid>
            </Paper>
          )}

          {canRecordPayments && formMode === 'create' && formCollectionType !== 'none' && (
            <Paper variant="outlined" sx={{ p: 2, mt: 2, backgroundColor: (theme) => theme.palette.mode === 'dark' ? '#1e1e1e' : '#f8fafc', borderColor: (theme) => theme.palette.mode === 'dark' ? 'secondary.dark' : 'secondary.light' }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 2, color: (theme) => theme.palette.mode === 'dark' ? 'secondary.light' : 'secondary.dark' }}>
                تفاصيل تحصيل النقدية عند الإنشاء
              </Typography>
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    required
                    label="المبلغ المحصل"
                    size="small"
                    type="number"
                    disabled={formCollectionType === 'full'}
                    inputProps={{ step: '0.01', min: '0.01' }}
                    value={formCollectionType === 'full' ? formTotals.total : formCollectedAmount}
                    onChange={(e) => setFormCollectedAmount(Math.max(0, parseFloat(e.target.value) || 0))}
                    InputProps={{
                      endAdornment: <InputAdornment position="end">ج.م</InputAdornment>
                    }}
                  />
                </Grid>

                <Grid item xs={12} sm={6}>
                  <FormControl fullWidth size="small" required>
                    <InputLabel id="invoice-payment-method-label">طريقة الدفع</InputLabel>
                    <Select
                      labelId="invoice-payment-method-label"
                      value={formPaymentMethod}
                      onChange={(e) => setFormPaymentMethod(e.target.value)}
                      label="طريقة الدفع"
                    >
                      {paymentMethods.map((method) => (
                        <MenuItem key={method.key} value={method.key}>{method.label_ar}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>

                {canSupplyPayments && <Grid item xs={12} sm={6}>
                  <FormControl fullWidth size="small" required>
                    <InputLabel id="form-supply-status-select-label">حالة توريد النقدية</InputLabel>
                    <Select
                      labelId="form-supply-status-select-label"
                      value={formSupplyStatus}
                      onChange={(e) => setFormSupplyStatus(e.target.value)}
                      label="حالة توريد النقدية"
                    >
                      <MenuItem value="not_supplied">مدفوع فقط (في الخزينة الفرعية)</MenuItem>
                      <MenuItem value="supplied">مدفوع وتم توريده (إلى خزينة الشركة)</MenuItem>
                    </Select>
                  </FormControl>
                </Grid>}

                <Grid item xs={12}>
                  <TextField
                    fullWidth
                    label="ملاحظات عملية التحصيل"
                    size="small"
                    value={formCollectionNotes}
                    onChange={(e) => setFormCollectionNotes(e.target.value)}
                  />
                </Grid>

                <Grid item xs={12}>
                  <Box className="receipt-upload-container">
                    <input
                      hidden
                      accept="image/*,application/pdf"
                      id="invoice-payment-receipt-upload"
                      type="file"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          try {
                            const result = await compressImageAndConvertToBase64(file);
                            setFormReceiptName(result.name);
                            setFormReceiptData(result.data);
                          } catch (err) {
                            console.error('Error processing file:', err);
                            setToastMsg('حدث خطأ أثناء معالجة الملف المرفوع.');
                            setToastSeverity('error');
                          }
                        }
                      }}
                    />
                    <label htmlFor="invoice-payment-receipt-upload">
                      <Button
                        variant="outlined"
                        component="span"
                        color="secondary"
                        startIcon={<ReceiptIcon />}
                        sx={{ fontWeight: 'bold' }}
                      >
                        {formReceiptName ? `تغيير مستند الإيصال: ${formReceiptName}` : 'رفع إيصال / مستند الدفع'}
                      </Button>
                    </label>
                    {formReceiptName && (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 'bold' }}>
                          الملف المحدد: {formReceiptName}
                        </Typography>
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => {
                            setFormReceiptName('');
                            setFormReceiptData('');
                          }}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Box>
                    )}
                  </Box>
                </Grid>
              </Grid>
            </Paper>
          )}
        </FormSection>

        <FormSection title="المواد والكتب المباعة">
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
            <Button
              variant="outlined"
              color="secondary"
              size="small"
              startIcon={<AddIcon />}
              onClick={handleAddFormItem}
            >
              إضافة مادة للفاتورة
            </Button>
          </Box>

          {formItems.length === 0 ? (
            <Alert severity="info" sx={{ mb: 2 }}>
              لم يتم إضافة أي كتاب في الفاتورة حتى الآن. انقر على "إضافة مادة للفاتورة" للبدء.
            </Alert>
          ) : (
            formItems.map((item, index) => {
              const prod = productsList.find((p) => p.id === item.productId);
              return (
                <Paper
                  key={index}
                  variant="outlined"
                  className="invoice-item-card"
                >
                  {/* Row 1: Book selection (40%), spacer (5%), & Unit Price (40%) */}
                  <Box className="invoice-item-row">
                    <Box className="invoice-item-field">
                      <Autocomplete
                        options={productsList}
                        getOptionLabel={(option) => `(${option.code}) ${option.title}`}
                        size="small"
                        disabled={!formOutletId}
                        value={prod || null}
                        onChange={(e, val) => handleFormItemProductChange(index, val)}
                        renderInput={(params) => <TextField {...params} required label="الكتاب" />}
                      />
                    </Box>
                    <Box className="invoice-item-spacer" />
                    <Box className="invoice-item-field">
                      <TextField
                        fullWidth
                        label="السعر للوحدة"
                        size="small"
                        disabled
                        value={item.price ? formatCurrencyEGP(item.price) : '0.00 ج.م'}
                      />
                    </Box>
                  </Box>

                  {/* Row 2: Quantity (40%), spacer (5%), & Free Quantity (40%) */}
                  <Box className="invoice-item-row">
                    <Box className="invoice-item-field">
                      <TextField
                        fullWidth
                        label="الكمية الإجمالية"
                        size="small"
                        type="number"
                        required
                        inputProps={{ min: '1' }}
                        value={item.quantity}
                        onChange={(e) => handleFormItemQtyChange(index, e.target.value)}
                      />
                    </Box>
                    <Box className="invoice-item-spacer" />
                    <Box className="invoice-item-field">
                      <TextField
                        fullWidth
                        label="الكمية المجانية"
                        size="small"
                        type="number"
                        inputProps={{ min: '0', max: item.quantity }}
                        value={item.freeQuantity || 0}
                        onChange={(e) => handleFormItemFreeQtyChange(index, e.target.value)}
                      />
                    </Box>
                  </Box>

                  {/* Footer: Line Total and Remove Button */}
                  <Box className="invoice-item-footer">
                    <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'text.secondary' }}>
                      إجمالي السطر: <Typography component="span" sx={{ color: 'text.primary', fontWeight: 'bold' }}>{formatCurrencyEGP((item.quantity - (item.freeQuantity || 0)) * item.price)}</Typography>
                    </Typography>
                    <IconButton color="error" size="small" onClick={() => handleRemoveFormItem(index)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Box>

                  {/* Stock info & Price/Stock Error indicator */}
                  {(item.productId || item.error) && (
                    <Box className="invoice-item-stock-error">
                      {item.productId && (
                        <Typography variant="caption" sx={{ color: item.stockPolicy === 'track' && item.stock <= 0 ? 'error.main' : 'text.secondary', fontWeight: 500 }}>
                          المتوفر في المخزن: {item.stock} {item.stockPolicy === 'ignore' && '(مخزون لا حصر له)'}
                        </Typography>
                      )}
                      {item.error && (
                        <Typography variant="caption" sx={{ color: 'error.main', fontWeight: 'bold' }}>
                          {item.error}
                        </Typography>
                      )}
                    </Box>
                  )}
                </Paper>
              );
            })
          )}

          {/* Subtotal / Final total calculation board */}
          {formItems.length > 0 && (
            <Box sx={{ mt: 3 }}>
              <Paper variant="outlined" className="invoice-summary-card">
                <Box className="invoice-summary-card-content">
                  <Box className="invoice-summary-breakdown">
                    <Box className="invoice-summary-row">
                      <Typography variant="body2" color="textSecondary">
                        المجموع الفرعي (قبل الخصم والشحن):
                      </Typography>
                      <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'text.primary' }}>
                        {formTotals.subtotal} ج.م
                      </Typography>
                    </Box>
                    <Divider sx={{ borderStyle: 'dashed' }} />
                    <Box className="invoice-summary-row">
                      <Typography variant="body2" color="textSecondary">
                        الشحن والتوصيل:
                      </Typography>
                      <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'text.primary' }}>
                        +{formatCurrencyEGP(formShippingCost || 0)}
                      </Typography>
                    </Box>
                    <Divider sx={{ borderStyle: 'dashed' }} />
                    <Box className="invoice-summary-row">
                      <Typography variant="body2" color="textSecondary">
                        الخصم المطبق:
                      </Typography>
                      <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'text.primary' }}>
                        -{formatCurrencyEGP(formDiscount || 0)}
                      </Typography>
                    </Box>
                  </Box>

                  <Box className="invoice-summary-callout">
                    <Typography variant="caption" className="invoice-summary-callout-label">
                      المجموع الإجمالي النهائي
                    </Typography>
                    <Typography variant="h5" className="invoice-summary-callout-value">
                      {formTotals.total} ج.م
                    </Typography>
                  </Box>
                </Box>
              </Paper>
            </Box>
          )}
        </FormSection>
      </form>
    </EntityDrawer>
  );
}
