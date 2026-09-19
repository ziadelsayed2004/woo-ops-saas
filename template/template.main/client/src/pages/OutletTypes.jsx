import React, { useState, useEffect } from 'react';
import { useAuth } from '../app/AuthContext';
import { apiClient } from '../services/apiClient';
import LoadingState from '../components/LoadingState';
import EmptyState from '../components/EmptyState';
import { FormSection } from '../components/forms/FormSection';
import { FieldGrid } from '../components/forms/FieldGrid';
import { FormActions } from '../components/forms/FormActions';
import EntityDrawer from '../components/EntityDrawer';
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
  Drawer,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Grid,
  Alert,
  Snackbar
} from '@mui/material';
import {
  Edit as EditIcon,
  Add as AddIcon,
  Delete as DeleteIcon,
  Visibility as VisibilityIcon
} from '@mui/icons-material';
import ConfirmDialog from '../components/ConfirmDialog';
import '../styles/OutletTypes.css';

export const OutletTypes = () => {
  const { hasPermission } = useAuth();
  
  // Data State
  const [types, setTypes] = useState([]);
  const [loading, setLoading] = useState(true);

  // Dialog State
  const [openModal, setOpenModal] = useState(false);
  const [modalMode, setModalMode] = useState('create');
  const [selectedType, setSelectedType] = useState(null);

  // Deletion Confirm Dialog State
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [typeIdToDelete, setTypeIdToDelete] = useState(null);

  // Form State
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formStatus, setFormStatus] = useState('active');

  // Outlet Type Detail Drawer States
  const [openDetailDrawer, setOpenDetailDrawer] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedTypeDetail, setSelectedTypeDetail] = useState(null);
  const [typeOutlets, setTypeOutlets] = useState([]);

  const handleOpenDetail = async (type) => {
    setDetailLoading(true);
    setOpenDetailDrawer(true);
    setSelectedTypeDetail(type);
    setTypeOutlets([]);
    try {
      const outletsData = await apiClient.get(`/outlets?outletTypeId=${type.id}&limit=200`);
      setTypeOutlets(outletsData);
    } catch (err) {
      console.error(err);
      showToast(err.message || 'فشل تحميل منافذ هذه الفئة.', 'error');
      setOpenDetailDrawer(false);
    } finally {
      setDetailLoading(false);
    }
  };

  // Notifications Toast State
  const [toastMsg, setToastMsg] = useState('');
  const [toastSeverity, setToastSeverity] = useState('success');

  const fetchTypes = async () => {
    setLoading(true);
    try {
      const data = await apiClient.get('/outlet-types?limit=100');
      setTypes(data);
    } catch (err) {
      console.error(err);
      showToast(err.message || 'فشل تحميل فئات المنافذ.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTypes();
  }, []);

  const showToast = (msg, severity = 'success') => {
    setToastMsg(msg);
    setToastSeverity(severity);
  };

  const handleOpenCreateModal = () => {
    setModalMode('create');
    setSelectedType(null);
    setFormName('');
    setFormDescription('');
    setFormStatus('active');
    setOpenModal(true);
  };

  const handleOpenEditModal = (item) => {
    setModalMode('edit');
    setSelectedType(item);
    setFormName(item.name);
    setFormDescription(item.description || '');
    setFormStatus(item.status);
    setOpenModal(true);
  };

  const handleFormSubmit = async (e) => {
    e.preventDefault();
    if (!formName) {
      showToast('اسم الفئة مطلوب.', 'error');
      return;
    }

    const payload = {
      name: formName,
      description: formDescription,
      status: formStatus
    };

    try {
      if (modalMode === 'create') {
        await apiClient.post('/outlet-types', payload);
        showToast('تم إضافة فئة المنفذ بنجاح.');
      } else {
        await apiClient.put(`/outlet-types/${selectedType.id}`, payload);
        showToast('تم تحديث فئة المنفذ بنجاح.');
      }
      setOpenModal(false);
      fetchTypes();
    } catch (err) {
      console.error(err);
      showToast(err.message || 'فشل حفظ التعديلات.', 'error');
    }
  };

  const handleDeleteType = (id) => {
    setTypeIdToDelete(id);
    setConfirmOpen(true);
  };

  const executeDeleteType = async () => {
    if (!typeIdToDelete) return;
    try {
      await apiClient.delete(`/outlet-types/${typeIdToDelete}`);
      showToast('تم حذف فئة منفذ التوزيع بنجاح.');
      fetchTypes();
    } catch (err) {
      console.error(err);
      showToast(err.message || 'فشل حذف فئة منفذ التوزيع لوجود ارتباطات قائمة.', 'error');
    } finally {
      setConfirmOpen(false);
      setTypeIdToDelete(null);
    }
  };

  if (loading && types.length === 0) {
    return <LoadingState type="skeleton" />;
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h5" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
          إدارة فئات منافذ التوزيع
        </Typography>
        {hasPermission('outlet_types.create') && (
          <Button
            variant="contained"
            color="secondary"
            startIcon={<AddIcon />}
            onClick={handleOpenCreateModal}
            sx={{ fontWeight: 'bold' }}
          >
            إضافة فئة جديدة
          </Button>
        )}
      </Box>

      {types.length === 0 ? (
        <EmptyState title="لا توجد فئات منافذ" description="لم يتم تسجيل أي فئات منافذ توزيع في النظام بعد." />
      ) : (
        <TableContainer className="scrollable-table-container" component={Paper} sx={{ overflowX: 'auto', width: '100%' }}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell align="center" sx={{ fontWeight: 'bold' }}>اسم الفئة</TableCell>
                <TableCell align="center" sx={{ fontWeight: 'bold' }}>الوصف والبيانات الإضافية</TableCell>
                <TableCell align="center" sx={{ fontWeight: 'bold' }}>الحالة</TableCell>
                <TableCell align="right" sx={{ fontWeight: 'bold' }}>العمليات</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {types.map((item) => (
                <TableRow key={item.id} hover>
                  <TableCell align="center" sx={{ fontWeight: 500 }}>{item.name}</TableCell>
                  <TableCell align="center">{item.description || '-'}</TableCell>
                  <TableCell align="center">
                    <Chip
                      label={item.status === 'active' ? 'نشط' : 'معطل'}
                      color={item.status === 'active' ? 'success' : 'error'}
                      size="small"
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Box sx={{ display: 'flex', justifyContent: 'flex-start', gap: 1 }}>
                      <IconButton color="warning" onClick={() => handleOpenDetail(item)} title="عرض التفاصيل والمنافذ">
                        <VisibilityIcon />
                      </IconButton>
                      {(hasPermission('outlet_types.update') || hasPermission('outlet_types.delete')) && (
                        <>
                          {hasPermission('outlet_types.update') && (
                            <IconButton color="primary" onClick={() => handleOpenEditModal(item)} title="تعديل">
                              <EditIcon />
                            </IconButton>
                          )}
                          {hasPermission('outlet_types.delete') && (
                            <IconButton color="error" onClick={() => handleDeleteType(item.id)} title="حذف">
                              <DeleteIcon />
                            </IconButton>
                          )}
                        </>
                      )}
                    </Box>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Editor Drawer */}
      <EntityDrawer
        open={openModal}
        onClose={() => setOpenModal(false)}
        title={modalMode === 'create' ? 'إضافة فئة منفذ توزيع' : 'تعديل فئة منفذ توزيع'}
        actions={
          <>
            <Button onClick={() => setOpenModal(false)}>إلغاء</Button>
            <Button type="submit" form="outlet-type-form" variant="contained" color="secondary">حفظ</Button>
          </>
        }
      >
        <form onSubmit={handleFormSubmit} id="outlet-type-form">
          <FormSection title="بيانات فئة منفذ التوزيع">
            <FieldGrid columns={1}>
              <TextField
                required
                fullWidth
                size="small"
                label="اسم الفئة (مثال: جملة، مفرق، معارض خارجية)"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
              />
              <TextField
                fullWidth
                size="small"
                multiline
                rows={3}
                label="الوصف والتفاصيل"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
              />
              <FormControl fullWidth size="small">
                <InputLabel id="status-label">الحالة</InputLabel>
                <Select
                  labelId="status-label"
                  value={formStatus}
                  label="الحالة"
                  onChange={(e) => setFormStatus(e.target.value)}
                >
                  <MenuItem value="active">نشط</MenuItem>
                  <MenuItem value="disabled">معطل</MenuItem>
                </Select>
              </FormControl>
            </FieldGrid>
          </FormSection>
        </form>
      </EntityDrawer>

      {/* ══════ OUTLET TYPE DETAILS DRAWER ══════ */}
      <EntityDrawer
        open={openDetailDrawer}
        onClose={() => setOpenDetailDrawer(false)}
        title={selectedTypeDetail ? `تفاصيل الفئة: ${selectedTypeDetail.name}` : 'جاري تحميل التفاصيل...'}
        subtitle={selectedTypeDetail ? `الوصف: ${selectedTypeDetail.description || 'لا يوجد وصف'}` : ''}
        size="medium"
        loading={detailLoading}
        actions={
          <Button onClick={() => setOpenDetailDrawer(false)} variant="outlined">
            إغلاق
          </Button>
        }
      >
        {selectedTypeDetail && (
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mb: 2, color: 'primary.dark' }}>
              منافذ التوزيع المدرجة تحت هذه الفئة ({typeOutlets.length})
            </Typography>

            {typeOutlets.length > 0 ? (
              <TableContainer component={Paper} variant="outlined" sx={{ overflowX: 'auto', width: '100%' }}>
                <Table size="small">
                  <TableHead sx={{ backgroundColor: '#f8fafc' }}>
                    <TableRow>
                      <TableCell align="center" sx={{ fontWeight: 'bold' }}>اسم المنفذ</TableCell>
                      <TableCell align="center" sx={{ fontWeight: 'bold' }}>الكود</TableCell>
                      <TableCell align="center" sx={{ fontWeight: 'bold' }}>المحافظة</TableCell>
                      <TableCell align="center" sx={{ fontWeight: 'bold' }}>رقم الهاتف</TableCell>
                      <TableCell align="center" sx={{ fontWeight: 'bold' }}>الحد الائتماني</TableCell>
                      <TableCell align="center" sx={{ fontWeight: 'bold' }}>الحالة</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {typeOutlets.map((outlet) => (
                      <TableRow key={outlet.id} hover>
                        <TableCell align="center" sx={{ fontWeight: 500 }}>{outlet.name}</TableCell>
                        <TableCell align="center" sx={{ fontFamily: 'monospace' }}>{outlet.code || '—'}</TableCell>
                        <TableCell align="center">{outlet.governorate}</TableCell>
                        <TableCell align="center" sx={{ direction: 'ltr' }}>{outlet.phone || '—'}</TableCell>
                        <TableCell align="center" sx={{ fontWeight: 'bold', color: 'secondary.main' }}>
                          {outlet.credit_limit ? `${outlet.credit_limit.toLocaleString('en-US')} ج.م` : 'بدون حد'}
                        </TableCell>
                        <TableCell align="center">
                          <Chip
                            label={outlet.status === 'active' ? 'نشط' : 'معطل'}
                            color={outlet.status === 'active' ? 'success' : 'default'}
                            size="small"
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            ) : (
              <EmptyState title="لا توجد منافذ" description="لا يوجد أي منافذ توزيع مسجلة تحت هذه الفئة حالياً." />
            )}
          </Box>
        )}
      </EntityDrawer>

      {/* Confirmation Dialog */}
      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={executeDeleteType}
        title="تأكيد حذف فئة منفذ التوزيع"
        message="هل أنت متأكد من حذف فئة منفذ التوزيع هذه؟ لا يمكن التراجع عن هذا الإجراء."
        severity="error"
        confirmText="حذف"
      />

      {/* Snackbar alerts */}
      <Snackbar
        open={!!toastMsg}
        autoHideDuration={4000}
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

export default OutletTypes;
