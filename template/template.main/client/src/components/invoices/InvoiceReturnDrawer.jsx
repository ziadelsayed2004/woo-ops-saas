import React from 'react';
import EntityDrawer from '../EntityDrawer';
import { FormSection } from '../forms/FormSection';
import {
  Button,
  TextField,
  Alert,
  Box,
  TableContainer,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  Paper
} from '@mui/material';

export default function InvoiceReturnDrawer({
  open,
  onClose,
  returnSubmitting,
  returnInvoice,
  returnQuantities,
  handleReturnQtyChange,
  returnReason,
  setReturnReason,
  setReturnQuantities,
  handleSubmitReturn
}) {
  return (
    <EntityDrawer
      open={open}
      onClose={() => !returnSubmitting && onClose()}
      title="إنشاء مرتجع مبيعات جديد"
      subtitle={returnInvoice ? `للفاتورة رقم: ${returnInvoice.invoice_number}` : ''}
      size="medium"
      loading={returnSubmitting}
      actions={
        <>
          <Button
            variant="outlined"
            color="inherit"
            onClick={onClose}
            disabled={returnSubmitting}
          >
            إلغاء
          </Button>
          <Button
            variant="contained"
            color="secondary"
            type="submit"
            form="create-return-form"
            disabled={returnSubmitting}
          >
            {returnSubmitting ? 'جاري الحفظ...' : 'تأكيد وإرجاع للمخزن'}
          </Button>
        </>
      }
    >
      {returnInvoice && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmitReturn();
          }}
          id="create-return-form"
        >
          <FormSection title="أصناف وكميات الفاتورة القابلة للإرجاع">
            <Alert severity="warning" sx={{ mb: 2, fontWeight: 'bold' }}>
              تنبيه: عند إتمام المرتجع، سيتم إرجاع الكتب إلى المخزن تلقائياً. 
              لا يمكن إعادة شحن هذه الكميات المرتجعة على نفس هذه الفاتورة مرة أخرى. 
              لإعادة شحنها للعميل، يجب إنشاء فاتورة جديدة ومستقلة.
            </Alert>
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1.5 }}>
              <Button
                size="small"
                variant="outlined"
                color="secondary"
                onClick={() => {
                  const allQtys = {};
                  returnInvoice.items?.forEach(item => {
                    allQtys[item.id] = item.remaining_returnable_quantity;
                  });
                  setReturnQuantities(allQtys);
                }}
              >
                إرجاع كافة الكميات المتبقية (مرتجع كامل)
              </Button>
            </Box>
            <TableContainer className="scrollable-table-container" component={Paper} variant="outlined">
              <Table size="small">
                <TableHead sx={{ backgroundColor: '#f8fafc' }}>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 'bold' }}>اسم الكتاب</TableCell>
                    <TableCell align="center" sx={{ fontWeight: 'bold' }}>المباع</TableCell>
                    <TableCell align="center" sx={{ fontWeight: 'bold' }}>المسترجع سابقاً</TableCell>
                    <TableCell align="center" sx={{ fontWeight: 'bold' }}>الكمية المتاحة للاسترجاع</TableCell>
                    <TableCell align="center" sx={{ fontWeight: 'bold', minWidth: 100 }}>كمية المرتجع الحالية</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {returnInvoice.items?.map((item) => {
                    const maxQty = item.remaining_returnable_quantity;
                    const currentVal = returnQuantities[item.id] || 0;
                    return (
                      <TableRow key={item.id}>
                        <TableCell>{item.product_title}</TableCell>
                        <TableCell align="center">{item.quantity}</TableCell>
                        <TableCell align="center">{item.quantity - maxQty}</TableCell>
                        <TableCell align="center" sx={{ fontWeight: 'bold', color: maxQty > 0 ? 'warning.main' : 'success.main' }}>{maxQty}</TableCell>
                        <TableCell align="center">
                          <TextField
                            size="small"
                            type="number"
                            value={currentVal}
                            onChange={(e) => handleReturnQtyChange(item.id, e.target.value)}
                            inputProps={{ min: 0, max: maxQty }}
                            disabled={maxQty <= 0 || returnSubmitting}
                            sx={{ width: 80 }}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>

            <TextField
              fullWidth
              label="سبب المرتجع / ملاحظات"
              value={returnReason}
              onChange={(e) => setReturnReason(e.target.value)}
              placeholder="يرجى كتابة سبب المرتجع هنا..."
              multiline
              rows={3}
              disabled={returnSubmitting}
              sx={{ mt: 2 }}
              InputLabelProps={{ shrink: true }}
            />
          </FormSection>
        </form>
      )}
    </EntityDrawer>
  );
}
