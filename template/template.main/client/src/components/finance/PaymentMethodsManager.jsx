import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Switch,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Alert
} from '@mui/material';
import { Add as AddIcon, Edit as EditIcon, Delete as DeleteIcon } from '@mui/icons-material';
import { apiClient } from '../../services/apiClient';

export default function PaymentMethodsManager({ showToast }) {
  const [methods, setMethods] = useState([]);
  const [loading, setLoading] = useState(false);
  const [openDialog, setOpenDialog] = useState(false);
  const [editingMethod, setEditingMethod] = useState(null);
  
  // Form State
  const [formKey, setFormKey] = useState('');
  const [formLabelAr, setFormLabelAr] = useState('');
  const [formLabelEn, setFormLabelEn] = useState('');
  const [formSortOrder, setFormSortOrder] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const fetchMethods = async () => {
    setLoading(true);
    try {
      const data = await apiClient.get('/payments/methods/all');
      setMethods(data);
    } catch (err) {
      showToast(err.message || 'خطأ في تحميل طرق الدفع', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMethods();
  }, []);

  const handleOpenDialog = (method = null) => {
    if (method) {
      setEditingMethod(method);
      setFormKey(method.key);
      setFormLabelAr(method.label_ar);
      setFormLabelEn(method.label_en || '');
      setFormSortOrder(method.sort_order);
    } else {
      setEditingMethod(null);
      setFormKey('');
      setFormLabelAr('');
      setFormLabelEn('');
      setFormSortOrder(0);
    }
    setOpenDialog(true);
  };

  const handleCloseDialog = () => {
    if (submitting) return;
    setOpenDialog(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (editingMethod) {
        await apiClient.put(`/payments/methods/${editingMethod.id}`, {
          labelAr: formLabelAr,
          labelEn: formLabelEn,
          sortOrder: formSortOrder
        });
        showToast('تم تحديث طريقة الدفع بنجاح', 'success');
      } else {
        await apiClient.post('/payments/methods', {
          key: formKey,
          labelAr: formLabelAr,
          labelEn: formLabelEn,
          sortOrder: formSortOrder
        });
        showToast('تم إضافة طريقة الدفع بنجاح', 'success');
      }
      setOpenDialog(false);
      fetchMethods();
    } catch (err) {
      showToast(err.message || 'حدث خطأ', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggle = async (id, currentStatus) => {
    try {
      await apiClient.patch(`/payments/methods/${id}/toggle`, { isActive: !currentStatus });
      showToast('تم تغيير الحالة بنجاح', 'success');
      fetchMethods();
    } catch (err) {
      showToast(err.message || 'حدث خطأ أثناء تغيير الحالة', 'error');
    }
  };

  const handleDelete = async (method) => {
    if (!window.confirm(`هل أنت متأكد من حذف طريقة الدفع "${method.label_ar}"؟`)) return;
    try {
      await apiClient.delete(`/payments/methods/${method.id}`);
      showToast('تم الحذف بنجاح', 'success');
      fetchMethods();
    } catch (err) {
      showToast(err.message || 'حدث خطأ أثناء الحذف', 'error');
    }
  };

  return (
    <Box>
      <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h6" sx={{ fontWeight: 'bold' }}>إدارة طرق الدفع</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => handleOpenDialog()}>
          إضافة طريقة دفع
        </Button>
      </Box>

      <TableContainer component={Paper} className="scrollable-table-container">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell align="right" sx={{ fontWeight: 'bold' }}>المفتاح (Key)</TableCell>
              <TableCell align="right" sx={{ fontWeight: 'bold' }}>الاسم (عربي)</TableCell>
              <TableCell align="right" sx={{ fontWeight: 'bold' }}>الاسم (انجليزي)</TableCell>
              <TableCell align="center" sx={{ fontWeight: 'bold' }}>الترتيب</TableCell>
              <TableCell align="center" sx={{ fontWeight: 'bold' }}>الحالة</TableCell>
              <TableCell align="center" sx={{ fontWeight: 'bold' }}>الإجراءات</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {methods.length === 0 && !loading && (
              <TableRow><TableCell colSpan={6} align="center">لا توجد بيانات</TableCell></TableRow>
            )}
            {methods.map(m => (
              <TableRow key={m.id}>
                <TableCell align="right" dir="ltr">{m.key}</TableCell>
                <TableCell align="right">{m.label_ar}</TableCell>
                <TableCell align="right">{m.label_en || '-'}</TableCell>
                <TableCell align="center">{m.sort_order}</TableCell>
                <TableCell align="center">
                  <Switch
                    checked={m.is_active === 1}
                    onChange={() => handleToggle(m.id, m.is_active === 1)}
                    color="success"
                  />
                </TableCell>
                <TableCell align="center">
                  <IconButton color="primary" onClick={() => handleOpenDialog(m)} size="small">
                    <EditIcon fontSize="small" />
                  </IconButton>
                  <IconButton color="error" onClick={() => handleDelete(m)} size="small" disabled={['cash', 'check', 'bank_transfer', 'e_wallet'].includes(m.key)}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Form Dialog */}
      <Dialog open={openDialog} onClose={handleCloseDialog} maxWidth="sm" fullWidth>
        <form onSubmit={handleSubmit}>
          <DialogTitle>{editingMethod ? 'تعديل طريقة دفع' : 'إضافة طريقة دفع جديدة'}</DialogTitle>
          <DialogContent dividers>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
              {!editingMethod && (
                <TextField
                  label="المفتاح (Key)"
                  value={formKey}
                  onChange={e => setFormKey(e.target.value)}
                  required
                  fullWidth
                  size="small"
                  helperText="يجب أن يكون باللغة الإنجليزية بدون مسافات (مثال: visa_card)"
                  dir="ltr"
                />
              )}
              <TextField
                label="الاسم (عربي)"
                value={formLabelAr}
                onChange={e => setFormLabelAr(e.target.value)}
                required
                fullWidth
                size="small"
              />
              <TextField
                label="الاسم (انجليزي) - اختياري"
                value={formLabelEn}
                onChange={e => setFormLabelEn(e.target.value)}
                fullWidth
                size="small"
                dir="ltr"
              />
              <TextField
                label="الترتيب (Sort Order)"
                type="number"
                value={formSortOrder}
                onChange={e => setFormSortOrder(e.target.value)}
                fullWidth
                size="small"
              />
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={handleCloseDialog}>إلغاء</Button>
            <Button type="submit" variant="contained" disabled={submitting}>حفظ</Button>
          </DialogActions>
        </form>
      </Dialog>
    </Box>
  );
}
