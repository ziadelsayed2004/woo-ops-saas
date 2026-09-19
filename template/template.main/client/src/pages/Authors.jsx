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
  Snackbar,
  InputAdornment
} from '@mui/material';
import {
  Edit as EditIcon,
  Add as AddIcon,
  Search as SearchIcon,
  Block as BlockIcon,
  CheckCircle as CheckCircleIcon,
  Delete as DeleteIcon,
  Visibility as VisibilityIcon,
  Book as BookIcon
} from '@mui/icons-material';
import ConfirmDialog from '../components/ConfirmDialog';
import '../styles/Authors.css';

export const Authors = () => {
  const { hasPermission } = useAuth();
  const canLinkAccount = hasPermission('authors.account_link') || hasPermission('users.update');
  
  // State
  const [authors, setAuthors] = useState([]);
  const [usersList, setUsersList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  
  // Notification toast state
  const [toastMsg, setToastMsg] = useState('');
  const [toastSeverity, setToastSeverity] = useState('success');

  // Dialog state
  const [openModal, setOpenModal] = useState(false);
  const [modalMode, setModalMode] = useState('create');
  const [selectedAuthor, setSelectedAuthor] = useState(null);

  // Deletion confirm state
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [authorIdToDelete, setAuthorIdToDelete] = useState(null);

  // Form fields
  const [formName, setFormName] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formStatus, setFormStatus] = useState('active');
  const [formUserId, setFormUserId] = useState('');

  // Author Detail Drawer States
  const [openDetailDrawer, setOpenDetailDrawer] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedAuthorDetail, setSelectedAuthorDetail] = useState(null);
  const [authorBooks, setAuthorBooks] = useState([]);

  const handleOpenDetail = async (author) => {
    setDetailLoading(true);
    setOpenDetailDrawer(true);
    setSelectedAuthorDetail(author);
    setAuthorBooks([]);
    try {
      const booksData = await apiClient.get(`/authors/${author.id}/books`);
      setAuthorBooks(booksData);
    } catch (err) {
      console.error(err);
      showToast(err.message || 'فشل تحميل كتب المؤلف.', 'error');
      setOpenDetailDrawer(false);
    } finally {
      setDetailLoading(false);
    }
  };

  const fetchAuthors = async () => {
    setLoading(true);
    try {
      let query = `/authors?search=${search}`;
      if (statusFilter) query += `&status=${statusFilter}`;
      const data = await apiClient.get(query);
      setAuthors(data);
      
      // Linking a master record to a login account is an identity-management action.
      if (canLinkAccount) {
        const usersData = await apiClient.get('/users/linkable?target=author&limit=200');
        setUsersList(usersData);
      }
    } catch (err) {
      console.error(err);
      showToast(err.message || 'فشل تحميل بيانات المؤلفين.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAuthors();
  }, [search, statusFilter]);

  const showToast = (msg, severity = 'success') => {
    setToastMsg(msg);
    setToastSeverity(severity);
  };

  const handleOpenCreateModal = () => {
    setModalMode('create');
    setSelectedAuthor(null);
    setFormName('');
    setFormPhone('');
    setFormStatus('active');
    setFormUserId('');
    setOpenModal(true);
  };

  const handleOpenEditModal = (author) => {
    setModalMode('edit');
    setSelectedAuthor(author);
    setFormName(author.name);
    setFormPhone(author.phone || '');
    setFormStatus(author.status);
    setFormUserId(author.userId || '');
    setOpenModal(true);
  };

  const handleFormSubmit = async (e) => {
    e.preventDefault();
    if (!formName) {
      showToast('الاسم الكامل للمؤلف مطلوب.', 'error');
      return;
    }

    const payload = {
      name: formName,
      phone: formPhone,
      status: formStatus
    };
    if (canLinkAccount) {
      payload.userId = formUserId ? parseInt(formUserId, 10) : null;
    }

    try {
      if (modalMode === 'create') {
        await apiClient.post('/authors', payload);
        showToast('تم إنشاء سجل المؤلف بنجاح.');
      } else {
        await apiClient.put(`/authors/${selectedAuthor.id}`, payload);
        showToast('تم تحديث سجل المؤلف بنجاح.');
      }
      setOpenModal(false);
      fetchAuthors();
    } catch (err) {
      console.error(err);
      showToast(err.message || 'فشل حفظ سجل المؤلف.', 'error');
    }
  };

  const handleDeleteAuthor = (id) => {
    setAuthorIdToDelete(id);
    setConfirmOpen(true);
  };

  const executeDeleteAuthor = async () => {
    if (!authorIdToDelete) return;
    try {
      await apiClient.delete(`/authors/${authorIdToDelete}`);
      showToast('تم حذف سجل المؤلف بنجاح.');
      fetchAuthors();
    } catch (err) {
      console.error(err);
      showToast(err.message || 'فشل حذف سجل المؤلف لوجود كتب مرتبطة به.', 'error');
    } finally {
      setConfirmOpen(false);
      setAuthorIdToDelete(null);
    }
  };

  const handleToggleStatus = async (author) => {
    const targetStatus = author.status === 'active' ? 'inactive' : 'active';
    const payload = {
      name: author.name,
      phone: author.phone,
      status: targetStatus
    };
    if (canLinkAccount) {
      payload.userId = author.userId || null;
    }
    try {
      await apiClient.put(`/authors/${author.id}`, payload);
      showToast(`تم ${targetStatus === 'active' ? 'تفعيل' : 'تعطيل'} المؤلف بنجاح.`);
      fetchAuthors();
    } catch (err) {
      console.error(err);
      showToast(err.message || 'فشل تعديل حالة المؤلف.', 'error');
    }
  };

  if (loading && authors.length === 0) {
    return <LoadingState type="skeleton" />;
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h5" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
          إدارة شؤون المؤلفين
        </Typography>
        {hasPermission('authors.create') && (
          <Button
            variant="contained"
            color="secondary"
            startIcon={<AddIcon />}
            onClick={handleOpenCreateModal}
            sx={{ fontWeight: 'bold' }}
          >
            إضافة مؤلف جديد
          </Button>
        )}
      </Box>

      {/* Search & Filters */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} sm={8}>
            <TextField
              fullWidth
              size="small"
              placeholder="البحث باسم المؤلف..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              sx={{ minWidth: 280 }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon />
                  </InputAdornment>
                ),
              }}
            />
          </Grid>
          <Grid item xs={12} sm={4}>
            <FormControl fullWidth size="small">
              <InputLabel id="status-filter-label">حالة المؤلف</InputLabel>
              <Select
                labelId="status-filter-label"
                value={statusFilter}
                label="حالة المؤلف"
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <MenuItem value="">الجميع</MenuItem>
                <MenuItem value="active">نشط</MenuItem>
                <MenuItem value="inactive">معطل</MenuItem>
              </Select>
            </FormControl>
          </Grid>
        </Grid>
      </Paper>

      {/* Grid listing */}
      {authors.length === 0 ? (
        <EmptyState title="لا يوجد مؤلفين" description="لم نتمكن من العثور على أي مؤلفين مسجلين يطابقون شروط البحث." />
      ) : (
        <TableContainer className="scrollable-table-container" component={Paper} sx={{ overflowX: 'auto', width: '100%' }}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell align="center" sx={{ fontWeight: 'bold' }}>اسم المؤلف</TableCell>
                <TableCell align="center" sx={{ fontWeight: 'bold' }}>رقم الهاتف</TableCell>
                {hasPermission('users.view') && (
                  <TableCell align="center" sx={{ fontWeight: 'bold' }}>الحساب المرتبط</TableCell>
                )}
                <TableCell align="center" sx={{ fontWeight: 'bold' }}>الحالة</TableCell>
                <TableCell align="right" sx={{ fontWeight: 'bold' }}>العمليات</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {authors.map((author) => (
                <TableRow key={author.id} hover>
                  <TableCell align="center" sx={{ fontWeight: 500 }}>{author.name}</TableCell>
                  <TableCell align="center">{author.phone || '-'}</TableCell>
                  {(hasPermission('users.view') || hasPermission('authors.account_link')) && (
                    <TableCell align="center">
                      {author.linked_username ? (
                        <Chip label={author.linked_username} size="small" color="primary" variant="outlined" />
                      ) : (
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>غير مرتبط</Typography>
                      )}
                    </TableCell>
                  )}
                  <TableCell align="center">
                    <Chip
                      label={author.status === 'active' ? 'نشط' : 'معطل'}
                      color={author.status === 'active' ? 'success' : 'error'}
                      size="small"
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Box sx={{ display: 'flex', justifyContent: 'flex-start', gap: 1 }}>
                      <IconButton color="warning" onClick={() => handleOpenDetail(author)} title="عرض التفاصيل والكتب">
                        <VisibilityIcon />
                      </IconButton>
                      {hasPermission('authors.update') && (
                        <IconButton color="primary" onClick={() => handleOpenEditModal(author)} title="تعديل">
                          <EditIcon />
                        </IconButton>
                      )}
                      {hasPermission('authors.update') && (
                        <IconButton
                          color={author.status === 'active' ? 'error' : 'success'}
                          onClick={() => handleToggleStatus(author)}
                          title={author.status === 'active' ? 'تعطيل' : 'تفعيل'}
                        >
                          {author.status === 'active' ? <BlockIcon /> : <CheckCircleIcon />}
                        </IconButton>
                      )}
                      {hasPermission('authors.delete') && (
                        <IconButton color="error" onClick={() => handleDeleteAuthor(author.id)} title="حذف">
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

      {/* Create / Edit Drawer */}
      <EntityDrawer
        open={openModal}
        onClose={() => setOpenModal(false)}
        title={modalMode === 'create' ? 'إضافة سجل مؤلف' : 'تعديل سجل مؤلف'}
        actions={
          <>
            <Button onClick={() => setOpenModal(false)}>إلغاء</Button>
            <Button type="submit" form="author-editor-form" variant="contained" color="secondary">حفظ</Button>
          </>
        }
      >
        <form onSubmit={handleFormSubmit} id="author-editor-form">
          <FormSection title="تفاصيل سجل المؤلف">
            <FieldGrid columns={1}>
              <TextField
                required
                fullWidth
                size="small"
                label="اسم المؤلف"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
              />
              <TextField
                fullWidth
                size="small"
                label="رقم الهاتف"
                value={formPhone}
                onChange={(e) => setFormPhone(e.target.value)}
                inputProps={{ className: 'ltr-value' }}
              />
              {canLinkAccount && (
                <FormControl fullWidth size="small">
                  <InputLabel id="link-user-label">ربط الحساب البرمجي (اختياري)</InputLabel>
                  <Select
                    labelId="link-user-label"
                    value={formUserId}
                    label="ربط الحساب البرمجي (اختياري)"
                    onChange={(e) => setFormUserId(e.target.value)}
                  >
                    <MenuItem value="">غير مرتبط</MenuItem>
                    {usersList.map((u) => (
                      <MenuItem key={u.id} value={u.id}>
                        {u.fullName} ({u.username})
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}
              <FormControl fullWidth size="small">
                <InputLabel id="status-label">الحالة</InputLabel>
                <Select
                  labelId="status-label"
                  value={formStatus}
                  label="الحالة"
                  onChange={(e) => setFormStatus(e.target.value)}
                >
                  <MenuItem value="active">نشط</MenuItem>
                  <MenuItem value="inactive">معطل</MenuItem>
                </Select>
              </FormControl>
            </FieldGrid>
          </FormSection>
        </form>
      </EntityDrawer>

      {/* ══════ AUTHOR DETAILS DRAWER ══════ */}
      <EntityDrawer
        open={openDetailDrawer}
        onClose={() => setOpenDetailDrawer(false)}
        title={selectedAuthorDetail ? `تفاصيل سجل المؤلف: ${selectedAuthorDetail.name}` : 'جاري تحميل التفاصيل...'}
        subtitle={selectedAuthorDetail ? `الهاتف: ${selectedAuthorDetail.phone || 'غير مسجل'}` : ''}
        size="medium"
        loading={detailLoading}
        actions={
          <Button onClick={() => setOpenDetailDrawer(false)} variant="outlined">
            إغلاق
          </Button>
        }
      >
        {selectedAuthorDetail && (
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mb: 2, color: 'primary.dark' }}>
              الكتب والمؤلفات المرتبطة بالمؤلف ({authorBooks.length})
            </Typography>

            {authorBooks.length > 0 ? (
              <TableContainer component={Paper} variant="outlined" sx={{ overflowX: 'auto', width: '100%' }}>
                <Table size="small">
                  <TableHead sx={{ backgroundColor: '#f8fafc' }}>
                    <TableRow>
                      <TableCell align="center" sx={{ fontWeight: 'bold' }}>اسم الكتاب</TableCell>
                      <TableCell align="center" sx={{ fontWeight: 'bold' }}>الكود</TableCell>
                      <TableCell align="center" sx={{ fontWeight: 'bold' }}>السعر الحالي</TableCell>
                      <TableCell align="center" sx={{ fontWeight: 'bold' }}>المخزون الحالي</TableCell>
                      <TableCell align="center" sx={{ fontWeight: 'bold' }}>الحالة</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {authorBooks.map((book) => (
                      <TableRow key={book.id} hover>
                        <TableCell align="center" sx={{ fontWeight: 500 }}>{book.title}</TableCell>
                        <TableCell align="center" sx={{ fontFamily: 'monospace' }}>{book.code || '—'}</TableCell>
                        <TableCell align="center" sx={{ fontWeight: 'bold', color: 'secondary.main' }}>
                          {book.retail_price ? `${book.retail_price} ج.م` : 'مجاني/هدية'}
                        </TableCell>
                        <TableCell align="center" sx={{ fontWeight: 'bold', color: book.stock > 0 ? 'success.main' : 'error.main' }}>
                          {book.stock}
                        </TableCell>
                        <TableCell align="center">
                          <Chip
                            label={book.status === 'active' ? 'نشط' : 'معطل'}
                            color={book.status === 'active' ? 'success' : 'default'}
                            size="small"
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            ) : (
              <EmptyState title="لا توجد كتب مرتبطة" description="لم يتم ربط أي كتب بهذا المؤلف حالياً في النظام." />
            )}
          </Box>
        )}
      </EntityDrawer>

      {/* Confirmation Dialog */}
      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={executeDeleteAuthor}
        title="تأكيد حذف سجل المؤلف"
        message="هل أنت متأكد من حذف هذا المؤلف؟ لا يمكن التراجع عن هذا الإجراء."
        severity="error"
        confirmText="حذف"
      />

      {/* Snackbar Toast */}
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

export default Authors;
