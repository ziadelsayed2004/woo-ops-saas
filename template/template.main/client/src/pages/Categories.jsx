import React, { useState, useEffect } from 'react';
import { useAuth } from '../app/AuthContext';
import { apiClient } from '../services/apiClient';
import LoadingState from '../components/LoadingState';
import EmptyState from '../components/EmptyState';
import { FormSection } from '../components/forms/FormSection';
import { FieldGrid } from '../components/forms/FieldGrid';
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
  TextField,
  Snackbar,
  Alert
} from '@mui/material';
import {
  Edit as EditIcon,
  Add as AddIcon,
  Delete as DeleteIcon
} from '@mui/icons-material';
import ConfirmDialog from '../components/ConfirmDialog';
import '../styles/Categories.css';

export const Categories = () => {
  const { hasPermission } = useAuth();

  // Data State
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);

  // Dialog State
  const [openModal, setOpenModal] = useState(false);
  const [modalMode, setModalMode] = useState('create');
  const [selectedCategory, setSelectedCategory] = useState(null);

  // Deletion Confirm Dialog State
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [categoryIdToDelete, setCategoryIdToDelete] = useState(null);

  // Form State
  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');

  // Notifications Toast State
  const [toastMsg, setToastMsg] = useState('');
  const [toastSeverity, setToastSeverity] = useState('success');

  const fetchCategories = async () => {
    setLoading(true);
    try {
      const data = await apiClient.get('/categories');
      setCategories(data);
    } catch (err) {
      console.error(err);
      showToast(err.message || 'فشل تحميل تصنيفات الكتب.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCategories();
  }, []);

  const showToast = (msg, severity = 'success') => {
    setToastMsg(msg);
    setToastSeverity(severity);
  };

  const handleOpenCreateModal = () => {
    setModalMode('create');
    setSelectedCategory(null);
    setFormName('');
    setFormDescription('');
    setOpenModal(true);
  };

  const handleOpenEditModal = (item) => {
    setModalMode('edit');
    setSelectedCategory(item);
    setFormName(item.name);
    setFormDescription(item.description || '');
    setOpenModal(true);
  };

  const handleFormSubmit = async (e) => {
    e.preventDefault();
    if (!formName || !formName.trim()) {
      showToast('اسم التصنيف مطلوب.', 'error');
      return;
    }

    const payload = {
      name: formName.trim(),
      description: formDescription.trim()
    };

    try {
      if (modalMode === 'create') {
        await apiClient.post('/categories', payload);
        showToast('تم إضافة تصنيف الكتب بنجاح.');
      } else {
        await apiClient.put(`/categories/${selectedCategory.id}`, payload);
        showToast('تم تحديث تصنيف الكتب بنجاح.');
      }
      setOpenModal(false);
      fetchCategories();
    } catch (err) {
      console.error(err);
      showToast(err.message || 'فشل حفظ التعديلات.', 'error');
    }
  };

  const handleDeleteCategory = (id) => {
    setCategoryIdToDelete(id);
    setConfirmOpen(true);
  };

  const executeDeleteCategory = async () => {
    if (!categoryIdToDelete) return;
    try {
      await apiClient.delete(`/categories/${categoryIdToDelete}`);
      showToast('تم حذف تصنيف الكتب بنجاح.');
      fetchCategories();
    } catch (err) {
      console.error(err);
      showToast(err.message || 'فشل حذف التصنيف لوجود كتب مرتبطة به.', 'error');
    } finally {
      setConfirmOpen(false);
      setCategoryIdToDelete(null);
    }
  };

  if (loading && categories.length === 0) {
    return <LoadingState type="skeleton" />;
  }

  const canCreate = hasPermission('categories.create');
  const canUpdate = hasPermission('categories.update');
  const canDelete = hasPermission('categories.delete');

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h5" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
          إدارة تصنيفات الكتب
        </Typography>
        {canCreate && (
          <Button
            variant="contained"
            color="secondary"
            startIcon={<AddIcon />}
            onClick={handleOpenCreateModal}
            sx={{ fontWeight: 'bold' }}
          >
            إضافة تصنيف جديد
          </Button>
        )}
      </Box>

      {categories.length === 0 ? (
        <EmptyState title="لا يوجد تصنيفات" description="لم نتمكن من العثور على أي تصنيفات كتب مدخلة في النظام بعد." />
      ) : (
        <TableContainer className="scrollable-table-container" component={Paper} sx={{ overflowX: 'auto', width: '100%' }}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell align="center" sx={{ fontWeight: 'bold' }}>اسم التصنيف</TableCell>
                <TableCell align="center" sx={{ fontWeight: 'bold' }}>الوصف</TableCell>
                <TableCell align="center" sx={{ fontWeight: 'bold' }}>تاريخ الإنشاء</TableCell>
                <TableCell align="right" sx={{ fontWeight: 'bold' }}>العمليات</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {categories.map((item) => (
                <TableRow key={item.id} hover>
                  <TableCell align="center" sx={{ fontWeight: 500 }}>{item.name}</TableCell>
                  <TableCell align="center">{item.description || '-'}</TableCell>
                  <TableCell align="center">
                    {new Date(item.created_at || item.createdAt).toLocaleDateString('ar-EG')}
                  </TableCell>
                  <TableCell align="right">
                    <Box sx={{ display: 'flex', justifyContent: 'flex-start', gap: 1 }}>
                      {canUpdate && (
                        <IconButton color="primary" onClick={() => handleOpenEditModal(item)} title="تعديل">
                          <EditIcon />
                        </IconButton>
                      )}
                      {canDelete && (
                        <IconButton color="error" onClick={() => handleDeleteCategory(item.id)} title="حذف">
                          <DeleteIcon />
                        </IconButton>
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
        title={modalMode === 'create' ? 'إضافة تصنيف جديد' : 'تعديل بيانات التصنيف'}
        actions={
          <>
            <Button onClick={() => setOpenModal(false)}>إلغاء</Button>
            <Button type="submit" form="category-editor-form" variant="contained" color="secondary">حفظ التغييرات</Button>
          </>
        }
      >
        <form onSubmit={handleFormSubmit} id="category-editor-form">
          <FormSection title="البيانات الأساسية">
            <FieldGrid columns={1}>
              <TextField
                required
                fullWidth
                size="small"
                label="اسم التصنيف (مثال: الصف الأول، ترم أول)"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
              />
              <TextField
                fullWidth
                multiline
                rows={3}
                size="small"
                label="الوصف والتوضيح"
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
              />
            </FieldGrid>
          </FormSection>
        </form>
      </EntityDrawer>

      {/* Confirm Deletion */}
      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={executeDeleteCategory}
        title="تأكيد حذف التصنيف"
        message="هل أنت متأكد من حذف هذا التصنيف؟ لا يمكن التراجع عن هذا الإجراء ولا يمكن الحذف إذا كانت هناك كتب مرتبطة به."
        severity="error"
        confirmText="حذف"
      />

      {/* Toast Alert */}
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

export default Categories;
