import React, { useState, useEffect } from 'react';
import { formatCurrencyEGP } from '../utils/formatters';
import { useAuth } from '../app/AuthContext';
import { apiClient } from '../services/apiClient';
import { t } from '../locales/t';
import LoadingState from '../components/LoadingState';
import EmptyState from '../components/EmptyState';
import { FormSection } from '../components/forms/FormSection';
import { FieldGrid } from '../components/forms/FieldGrid';
import { FormActions } from '../components/forms/FormActions';
import EntityDrawer from '../components/EntityDrawer';
import { EGYPT_GOVERNORATES } from '../constants/governorates';
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
  Drawer,
  Divider,
  Tabs,
  Tab,
  Card,
  CardContent
} from '@mui/material';
import {
  Edit as EditIcon,
  Add as AddIcon,
  Search as SearchIcon,
  Block as BlockIcon,
  CheckCircle as CheckCircleIcon,
  Delete as DeleteIcon,
  QrCode as QrCodeIcon,
  Visibility as VisibilityIcon,
  Description as DescriptionIcon,
  Book as BookIcon,
  TrendingUp as TrendingUpIcon
} from '@mui/icons-material';
import ConfirmDialog from '../components/ConfirmDialog';
import '../styles/Outlets.css';

export const Outlets = () => {
  const { hasPermission } = useAuth();
  const canLinkAccount = hasPermission('outlets.account_link') || hasPermission('users.update');
  
  // Data State
  const [outlets, setOutlets] = useState([]);
  const [outletTypes, setOutletTypes] = useState([]);
  const [governorates, setGovernorates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [usersList, setUsersList] = useState([]);

  // Filters State
  const [search, setSearch] = useState(new URLSearchParams(window.location.search).get('search') || '');
  const [governorateFilter, setGovernorateFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Dialog Controller State
  const [openModal, setOpenModal] = useState(false);
  const [modalMode, setModalMode] = useState('create');
  const [selectedOutlet, setSelectedOutlet] = useState(null);

  // Deletion confirm state
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [outletIdToDelete, setOutletIdToDelete] = useState(null);

  // Form State
  const [formName, setFormName] = useState('');
  const [formOutletTypeId, setFormOutletTypeId] = useState('');
  const [formGovernorate, setFormGovernorate] = useState('');
  const [formAddressDetails, setFormAddressDetails] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formCreditLimit, setFormCreditLimit] = useState('');
  const [formStatus, setFormStatus] = useState('active');
  const [formNotes, setFormNotes] = useState('');
  const [formUserId, setFormUserId] = useState('');
  const [formCode, setFormCode] = useState('');

  // QR Code Dialog States
  const [qrOpen, setQrOpen] = useState(false);
  const [qrData, setQrData] = useState(null);
  const handleShowQr = (outlet) => {
    setQrData(outlet);
    setQrOpen(true);
  };

  // Outlet Detail Drawer States
  const [openDetailDrawer, setOpenDetailDrawer] = useState(false);
  const [detailData, setDetailData] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailTab, setDetailTab] = useState(0);

  const handleOpenDetail = async (outlet) => {
    setDetailLoading(true);
    setOpenDetailDrawer(true);
    setDetailData(null);
    setDetailTab(0);
    try {
      const data = await apiClient.get(`/outlets/${outlet.id}/details`);
      setDetailData(data);
    } catch (err) {
      console.error(err);
      showToast(err.message || 'فشل تحميل تفاصيل المنفذ.', 'error');
      setOpenDetailDrawer(false);
    } finally {
      setDetailLoading(false);
    }
  };

  // Toast Notifications State
  const [toastMsg, setToastMsg] = useState('');
  const [toastSeverity, setToastSeverity] = useState('success');

  const fetchFiltersMetadata = async () => {
    try {
      const govData = await apiClient.get('/outlets/governorates');
      setGovernorates(govData);

      const typesData = await apiClient.get('/outlet-types?limit=100&includeDisabled=false');
      setOutletTypes(typesData);

      if (canLinkAccount) {
        const usersData = await apiClient.get('/users/linkable?target=outlet&limit=200');
        setUsersList(usersData);
      }
    } catch (err) {
      console.error('Failed to load outlets metadata:', err);
    }
  };

  const fetchOutlets = async () => {
    setLoading(true);
    try {
      let query = `/outlets?search=${search}`;
      if (governorateFilter) query += `&governorate=${governorateFilter}`;
      if (typeFilter) query += `&outletTypeId=${typeFilter}`;
      if (statusFilter) query += `&status=${statusFilter}`;
      
      const data = await apiClient.get(query);
      setOutlets(data);

      // Auto-open QR code dialog if search code matches exactly
      const searchParam = new URLSearchParams(window.location.search).get('search');
      if (searchParam && data && data.length > 0) {
        const exactMatch = data.find(o => o.code === searchParam.trim());
        if (exactMatch) {
          handleShowQr(exactMatch);
        }
      }
    } catch (err) {
      console.error(err);
      showToast(err.message || 'فشل تحميل بيانات المنافذ.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFiltersMetadata();
  }, []);

  useEffect(() => {
    fetchOutlets();
  }, [search, governorateFilter, typeFilter, statusFilter]);

  const showToast = (msg, severity = 'success') => {
    setToastMsg(msg);
    setToastSeverity(severity);
  };

  const handleOpenCreateModal = () => {
    setModalMode('create');
    setSelectedOutlet(null);
    setFormName('');
    setFormOutletTypeId('');
    setFormGovernorate('');
    setFormAddressDetails('');
    setFormPhone('');
    setFormCreditLimit('');
    setFormStatus('active');
    setFormNotes('');
    setFormUserId('');
    setFormCode('');

    // Auto-generate Outlet Code
    apiClient.get('/system/next-code?type=outlet')
      .then(res => {
        if (res && res.code) {
          setFormCode(res.code);
        }
      })
      .catch(console.error);

    setOpenModal(true);
  };

  const handleOpenEditModal = (outlet) => {
    setModalMode('edit');
    setSelectedOutlet(outlet);
    setFormName(outlet.name);
    setFormOutletTypeId(outlet.outlet_type_id);
    setFormGovernorate(outlet.governorate);
    setFormAddressDetails(outlet.address_details || '');
    setFormPhone(outlet.phone || '');
    setFormCreditLimit(outlet.credit_limit ? outlet.credit_limit.toLocaleString('en-US') : '');
    setFormStatus(outlet.status);
    setFormNotes(outlet.notes || '');
    setFormUserId(outlet.userId || '');
    setFormCode(outlet.code || '');
    setOpenModal(true);
  };

  const handleFormSubmit = async (e) => {
    e.preventDefault();
    if (!formName || !formOutletTypeId || !formGovernorate) {
      showToast('الاسم، فئة المنفذ، والمحافظة حقول مطلوبة.', 'error');
      return;
    }

    const payload = {
      name: formName,
      outletTypeId: parseInt(formOutletTypeId, 10),
      governorate: formGovernorate,
      addressDetails: formAddressDetails,
      phone: formPhone,
      creditLimit: parseFloat(String(formCreditLimit).replace(/,/g, '')) || 0,
      status: formStatus,
      notes: formNotes,
      code: formCode
    };
    if (canLinkAccount) {
      payload.userId = formUserId ? parseInt(formUserId, 10) : null;
    }

    try {
      if (modalMode === 'create') {
        await apiClient.post('/outlets', payload);
        showToast('تم إضافة منفذ التوزيع بنجاح.');
      } else {
        await apiClient.put(`/outlets/${selectedOutlet.id}`, payload);
        showToast('تم تحديث بيانات منفذ التوزيع بنجاح.');
      }
      setOpenModal(false);
      fetchOutlets();
      // Reload unique governorates list in case a new one was added
      const govData = await apiClient.get('/outlets/governorates');
      setGovernorates(govData);
    } catch (err) {
      console.error(err);
      showToast(err.message || 'فشل حفظ التعديلات.', 'error');
    }
  };

  const handleToggleStatus = async (outlet) => {
    const targetStatus = outlet.status === 'active' ? 'disabled' : 'active';
    try {
      await apiClient.put(`/outlets/${outlet.id}/status`, { status: targetStatus });
      showToast(`تم ${targetStatus === 'active' ? 'تفعيل' : 'تعطيل'} المنفذ بنجاح.`);
      fetchOutlets();
    } catch (err) {
      console.error(err);
      showToast(err.message || 'فشل تغيير حالة المنفذ.', 'error');
    }
  };

  const handleDeleteOutlet = (id) => {
    setOutletIdToDelete(id);
    setConfirmOpen(true);
  };

  const executeDeleteOutlet = async () => {
    if (!outletIdToDelete) return;
    try {
      await apiClient.delete(`/outlets/${outletIdToDelete}`);
      showToast('تم حذف منفذ التوزيع بنجاح.');
      fetchOutlets();
    } catch (err) {
      console.error(err);
      showToast(err.message || 'لا يمكن حذف هذا المنفذ لوجود فواتير أو معاملات مسجلة عليه.', 'error');
    } finally {
      setConfirmOpen(false);
      setOutletIdToDelete(null);
    }
  };

  if (loading && outlets.length === 0) {
    return <LoadingState type="skeleton" />;
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h5" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
          إدارة منافذ التوزيع والفروع
        </Typography>
        {hasPermission('outlets.create') && (
          <Button
            variant="contained"
            color="secondary"
            startIcon={<AddIcon />}
            onClick={handleOpenCreateModal}
            sx={{ fontWeight: 'bold' }}
          >
            إضافة منفذ جديد
          </Button>
        )}
      </Box>

      {/* Search & Filters */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} sm={4} md={4.5}>
            <TextField
              fullWidth
              size="small"
              placeholder="البحث باسم المنفذ أو الهاتف..."
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
          <Grid item xs={12} sm={2.6} md={2.5}>
            <FormControl fullWidth size="small">
              <InputLabel id="gov-filter-label">المحافظة</InputLabel>
              <Select
                labelId="gov-filter-label"
                value={governorateFilter}
                label="المحافظة"
                onChange={(e) => setGovernorateFilter(e.target.value)}
              >
                <MenuItem value="">الجميع</MenuItem>
                {governorates.map((gov) => (
                  <MenuItem key={gov} value={gov}>
                    {gov}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={2.6} md={2.5}>
            <FormControl fullWidth size="small">
              <InputLabel id="type-filter-label">فئة المنفذ</InputLabel>
              <Select
                labelId="type-filter-label"
                value={typeFilter}
                label="فئة المنفذ"
                onChange={(e) => setTypeFilter(e.target.value)}
              >
                <MenuItem value="">الجميع</MenuItem>
                {outletTypes.map((ot) => (
                  <MenuItem key={ot.id} value={ot.id}>
                    {ot.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={2.8} md={2.5}>
            <FormControl fullWidth size="small">
              <InputLabel id="status-filter-label">الحالة</InputLabel>
              <Select
                labelId="status-filter-label"
                value={statusFilter}
                label="الحالة"
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <MenuItem value="">الجميع</MenuItem>
                <MenuItem value="active">نشط</MenuItem>
                <MenuItem value="disabled">معطل</MenuItem>
              </Select>
            </FormControl>
          </Grid>
        </Grid>
      </Paper>

      {/* Grid listing */}
      {outlets.length === 0 ? (
        <EmptyState title="لا توجد منافذ بيع" description="لم نتمكن من العثور على أي منافذ توزيع مطابقة لمعايير البحث الحالية." />
      ) : (
        <TableContainer className="scrollable-table-container" component={Paper} sx={{ overflowX: 'auto', width: '100%' }}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell align="center" sx={{ fontWeight: 'bold' }}>اسم المنفذ</TableCell>
                <TableCell align="center" sx={{ fontWeight: 'bold' }}>الفئة والسعر المعتمد</TableCell>
                <TableCell align="center" sx={{ fontWeight: 'bold' }}>المحافظة والمدينة</TableCell>
                <TableCell align="center" sx={{ fontWeight: 'bold' }}>الهاتف</TableCell>
                <TableCell align="center" sx={{ fontWeight: 'bold' }}>الحساب المرتبط</TableCell>
                <TableCell align="center" sx={{ fontWeight: 'bold' }}>السقف الائتماني</TableCell>
                <TableCell align="center" sx={{ fontWeight: 'bold' }}>الحالة</TableCell>
                <TableCell align="right" sx={{ fontWeight: 'bold' }}>العمليات</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {outlets.map((outlet) => (
                <TableRow key={outlet.id} hover>
                  <TableCell align="center" sx={{ fontWeight: 500 }}>
                    {outlet.name}
                    <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', fontFamily: 'monospace' }}>
                      {outlet.code}
                    </Typography>
                  </TableCell>
                  <TableCell align="center">{outlet.outlet_type_name}</TableCell>
                  <TableCell align="center">{outlet.governorate}</TableCell>
                  <TableCell align="center">{outlet.phone || '-'}</TableCell>
                  <TableCell align="center">
                    {outlet.linked_username ? (
                      <Chip label={outlet.linked_username} size="small" color="primary" variant="outlined" />
                    ) : (
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>غير مرتبط</Typography>
                    )}
                  </TableCell>
                  <TableCell align="center" sx={{ fontWeight: 'bold', color: 'secondary.main' }}>
                    {formatCurrencyEGP(outlet.credit_limit || 0)}
                  </TableCell>
                  <TableCell align="center">
                    <Chip
                      label={outlet.status === 'active' ? 'نشط' : 'معطل'}
                      color={outlet.status === 'active' ? 'success' : 'error'}
                      size="small"
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Box sx={{ display: 'flex', justifyContent: 'flex-start', gap: 1 }}>
                      <IconButton color="warning" onClick={() => handleOpenDetail(outlet)} title="عرض التفاصيل والكتب والفواتير">
                        <VisibilityIcon />
                      </IconButton>
                      <IconButton color="info" onClick={() => handleShowQr(outlet)} title={t('system.viewQr')}>
                        <QrCodeIcon />
                      </IconButton>
                      {hasPermission('outlets.update') && (
                        <IconButton color="primary" onClick={() => handleOpenEditModal(outlet)} title="تعديل">
                          <EditIcon />
                        </IconButton>
                      )}
                      {((outlet.status === 'active' && hasPermission('outlets.disable'))
                        || (outlet.status !== 'active' && hasPermission('outlets.update'))) && (
                        <IconButton
                          color={outlet.status === 'active' ? 'error' : 'success'}
                          onClick={() => handleToggleStatus(outlet)}
                          title={outlet.status === 'active' ? 'تعطيل' : 'تفعيل'}
                        >
                          {outlet.status === 'active' ? <BlockIcon /> : <CheckCircleIcon />}
                        </IconButton>
                      )}
                      {hasPermission('outlets.delete') && (
                        <IconButton color="error" onClick={() => handleDeleteOutlet(outlet.id)} title="حذف">
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
      {/* Editor Drawer */}
      <EntityDrawer
        open={openModal}
        onClose={() => setOpenModal(false)}
        title={modalMode === 'create' ? 'إضافة منفذ توزيع جديد' : 'تعديل بيانات المنفذ'}
        actions={
          <>
            <Button onClick={() => setOpenModal(false)}>إلغاء</Button>
            <Button type="submit" form="outlet-editor-form" variant="contained" color="secondary">حفظ</Button>
          </>
        }
      >
        <form onSubmit={handleFormSubmit} id="outlet-editor-form">
          <FormSection title="البيانات الأساسية للمنفذ">
            <FieldGrid columns={2}>
              <TextField
                required
                fullWidth
                size="small"
                label="اسم المنفذ / المعرض"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
              />
              <TextField
                required
                fullWidth
                size="small"
                label={t('system.outletCode')}
                value={formCode}
                inputProps={{ className: 'ltr-value', readOnly: true }}
                disabled={true}
              />
              <FormControl fullWidth size="small">
                <InputLabel id="form-type-label">فئة المنفذ التسعيرية</InputLabel>
                <Select
                  labelId="form-type-label"
                  value={formOutletTypeId}
                  label="فئة المنفذ التسعيرية"
                  onChange={(e) => setFormOutletTypeId(e.target.value)}
                >
                  {outletTypes.map((ot) => (
                    <MenuItem key={ot.id} value={ot.id}>
                      {ot.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl fullWidth size="small">
                <InputLabel id="form-gov-label">المحافظة</InputLabel>
                <Select
                  labelId="form-gov-label"
                  value={formGovernorate}
                  label="المحافظة"
                  onChange={(e) => setFormGovernorate(e.target.value)}
                >
                  {EGYPT_GOVERNORATES.map((gov) => (
                    <MenuItem key={gov} value={gov}>
                      {gov}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <TextField
                fullWidth
                size="small"
                label="رقم الهاتف"
                value={formPhone}
                onChange={(e) => setFormPhone(e.target.value)}
                inputProps={{ className: 'ltr-value' }}
              />
              <TextField
                fullWidth
                size="small"
                label="السقف الائتماني المالي"
                value={formCreditLimit}
                onChange={(e) => {
                  const val = e.target.value;
                  const digits = val.replace(/\D/g, '');
                  if (!digits) {
                    setFormCreditLimit('');
                  } else {
                    setFormCreditLimit(parseInt(digits, 10).toLocaleString('en-US'));
                  }
                }}
                inputProps={{ className: 'ltr-value' }}
                InputProps={{
                  endAdornment: <InputAdornment position="end">ج.م</InputAdornment>,
                }}
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
                <InputLabel id="form-status-label">الحالة</InputLabel>
                <Select
                  labelId="form-status-label"
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

          <FormSection title="العنوان والملاحظات">
            <FieldGrid columns={1}>
              <TextField
                fullWidth
                size="small"
                label="تفاصيل العنوان (شارع، بناية، رقم المكتب)"
                value={formAddressDetails}
                onChange={(e) => setFormAddressDetails(e.target.value)}
              />
              <TextField
                fullWidth
                size="small"
                multiline
                rows={2}
                label="ملاحظات وشروط خاصة بالمنفذ"
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
              />
            </FieldGrid>
          </FormSection>
        </form>
      </EntityDrawer>

      {/* ══════ OUTLET DETAILS DRAWER ══════ */}
      <EntityDrawer
        open={openDetailDrawer}
        onClose={() => setOpenDetailDrawer(false)}
        title={detailData ? `تقرير وتفاصيل المنفذ: ${detailData.outlet.name}` : 'جاري تحميل التفاصيل...'}
        subtitle={detailData ? `كود المنفذ: ${detailData.outlet.code} (${detailData.outlet.governorate})` : ''}
        size="large"
        loading={detailLoading}
        actions={
          <Button onClick={() => setOpenDetailDrawer(false)} variant="outlined">
            إغلاق
          </Button>
        }
      >
        {detailData && (
          <Box>
            {/* Basic Info Card */}
            <Card variant="outlined" sx={{ mb: 3, backgroundColor: '#fafafa', borderColor: '#e0e0e0' }}>
              <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 'bold', color: 'primary.main', mb: 1.5, borderBottom: '1px solid #e0e0e0', pb: 0.5 }}>
                  البيانات الأساسية للمنفذ
                </Typography>
                <Grid container spacing={2}>
                  <Grid item xs={12} sm={4}>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>اسم المنفذ والكود</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                      {detailData.outlet.name} ({detailData.outlet.code})
                    </Typography>
                  </Grid>
                  <Grid item xs={6} sm={4}>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>فئة منفذ التوزيع</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      {detailData.outlet.outlet_type_name}
                    </Typography>
                  </Grid>
                  <Grid item xs={6} sm={4}>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>المحافظة</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      {detailData.outlet.governorate}
                    </Typography>
                  </Grid>
                  <Grid item xs={6} sm={4}>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>رقم الهاتف</Typography>
                    <Typography variant="body2" sx={{ direction: 'ltr', textAlign: 'right', fontWeight: 500 }}>
                      {detailData.outlet.phone || '—'}
                    </Typography>
                  </Grid>
                  <Grid item xs={6} sm={4}>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>الحساب المرتبط</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      {detailData.outlet.linked_username ? (
                        <Chip label={detailData.outlet.linked_username} size="small" color="primary" variant="outlined" sx={{ height: 20, fontSize: '0.75rem' }} />
                      ) : (
                        '—'
                      )}
                    </Typography>
                  </Grid>
                  <Grid item xs={6} sm={4}>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>حالة المنفذ</Typography>
                    <Box sx={{ mt: 0.5 }}>
                      <Chip
                        label={detailData.outlet.status === 'active' ? 'نشط' : 'معطل'}
                        color={detailData.outlet.status === 'active' ? 'success' : 'error'}
                        size="small"
                        sx={{ height: 20, fontSize: '0.75rem', fontWeight: 'bold' }}
                      />
                    </Box>
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>تفاصيل العنوان</Typography>
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                      {detailData.outlet.address_details || '—'}
                    </Typography>
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>شروط خاصة وملاحظات</Typography>
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                      {detailData.outlet.notes || '—'}
                    </Typography>
                  </Grid>
                </Grid>
              </CardContent>
            </Card>

            {/* Financial Summary Cards */}
            <Grid container spacing={2} sx={{ mb: 3 }}>
              <Grid item xs={6} sm={3}>
                <Card variant="outlined" sx={{ borderColor: 'primary.light', height: '100%' }}>
                  <CardContent sx={{ p: 2, '&:last-child': { pb: 2 }, textAlign: 'center' }}>
                    <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 'bold' }}>إجمالي المبيعات بالفواتير</Typography>
                    <Typography variant="h6" sx={{ fontWeight: 'bold', color: 'primary.main', mt: 0.5 }}>
                      {formatCurrencyEGP(detailData.summary.totalInvoiced)}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
              <Grid item xs={6} sm={3}>
                <Card variant="outlined" sx={{ borderColor: 'success.light', height: '100%' }}>
                  <CardContent sx={{ p: 2, '&:last-child': { pb: 2 }, textAlign: 'center' }}>
                    <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 'bold' }}>المسدد (المحصل نقداً)</Typography>
                    <Typography variant="h6" sx={{ fontWeight: 'bold', color: 'success.main', mt: 0.5 }}>
                      {formatCurrencyEGP(detailData.summary.totalPaid)}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
              <Grid item xs={6} sm={3}>
                <Card variant="outlined" sx={{ borderColor: 'error.light', height: '100%' }}>
                  <CardContent sx={{ p: 2, '&:last-child': { pb: 2 }, textAlign: 'center' }}>
                    <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 'bold' }}>قيمة المرتجعات</Typography>
                    <Typography variant="h6" sx={{ fontWeight: 'bold', color: 'error.main', mt: 0.5 }}>
                      {formatCurrencyEGP(detailData.summary.totalReturned)}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
              <Grid item xs={6} sm={3}>
                <Card variant="outlined" sx={{ borderColor: 'warning.light', height: '100%' }}>
                  <CardContent sx={{ p: 2, '&:last-child': { pb: 2 }, textAlign: 'center' }}>
                    <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 'bold' }}>الرصيد المتبقي (الذمم)</Typography>
                    <Typography variant="h6" sx={{ fontWeight: 'bold', color: 'warning.main', mt: 0.5 }}>
                      {formatCurrencyEGP(detailData.summary.totalRemaining)}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
            </Grid>

            {/* Tabs for details */}
            <Paper sx={{ mb: 3 }}>
              <Tabs
                value={detailTab}
                onChange={(e, val) => setDetailTab(val)}
                indicatorColor="primary"
                textColor="primary"
                variant="fullWidth"
              >
                <Tab label="الكتب والمنتجات" icon={<BookIcon />} iconPosition="start" sx={{ fontWeight: 'bold' }} />
                <Tab label="الفواتير الصادرة" icon={<DescriptionIcon />} iconPosition="start" sx={{ fontWeight: 'bold' }} />
              </Tabs>
            </Paper>

            {/* TAB 0: BOOKS purchased */}
            {detailTab === 0 && (
              <Box>
                {detailData.books && detailData.books.length > 0 ? (
                  <TableContainer component={Paper} variant="outlined">
                    <Table size="small">
                      <TableHead sx={{ backgroundColor: '#f8fafc' }}>
                        <TableRow>
                          <TableCell align="right" sx={{ fontWeight: 'bold' }}>اسم الكتاب</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 'bold' }}>كود الكتاب</TableCell>
                          <TableCell align="center" sx={{ fontWeight: 'bold' }}>الكمية المباعة</TableCell>
                          <TableCell align="center" sx={{ fontWeight: 'bold' }}>الكمية المرتجعة</TableCell>
                          <TableCell align="center" sx={{ fontWeight: 'bold' }}>صافي الكمية</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 'bold' }}>متوسط السعر</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 'bold' }}>إجمالي القيمة</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {detailData.books.map((book) => (
                          <TableRow key={book.product_id} hover>
                            <TableCell align="right" sx={{ fontWeight: 500 }}>{book.product_title}</TableCell>
                            <TableCell align="right" sx={{ fontFamily: 'monospace' }}>{book.product_code}</TableCell>
                            <TableCell align="center">{book.total_purchased}</TableCell>
                            <TableCell align="center" sx={{ color: book.total_returned > 0 ? 'error.main' : 'inherit' }}>{book.total_returned}</TableCell>
                            <TableCell align="center" sx={{ fontWeight: 'bold' }}>{book.net_quantity}</TableCell>
                            <TableCell align="right">{formatCurrencyEGP(book.average_price)}</TableCell>
                            <TableCell align="right" sx={{ fontWeight: 'bold' }}>{formatCurrencyEGP(book.total_amount)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                ) : (
                  <EmptyState title="لا توجد مبيعات كتب" description="لم يتم بيع أي كتب لهذا المنفذ بعد." />
                )}
              </Box>
            )}

            {/* TAB 1: INVOICES issued */}
            {detailTab === 1 && (
              <Box>
                {detailData.invoices && detailData.invoices.length > 0 ? (
                  <TableContainer component={Paper} variant="outlined">
                    <Table size="small">
                      <TableHead sx={{ backgroundColor: '#f8fafc' }}>
                        <TableRow>
                          <TableCell align="right" sx={{ fontWeight: 'bold' }}>رقم الفاتورة</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 'bold' }}>تاريخ الإصدار</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 'bold' }}>طريقة الدفع</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 'bold' }}>إجمالي القيمة</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 'bold' }}>المدفوع نقداً</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 'bold' }}>الرصيد المتبقي</TableCell>
                          <TableCell align="center" sx={{ fontWeight: 'bold' }}>حالة الدفع</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {detailData.invoices.map((inv) => {
                          const getPayStatusColor = (status) => {
                            switch (status) {
                              case 'paid': return 'success';
                              case 'unpaid': return 'error';
                              case 'partially_paid': return 'warning';
                              default: return 'default';
                            }
                          };
                          const getPayStatusLabel = (status) => {
                            switch (status) {
                              case 'paid': return 'مسددة بالكامل';
                              case 'unpaid': return 'غير مسددة';
                              case 'partially_paid': return 'مسددة جزئياً';
                              case 'cancelled': return 'ملغاة';
                              default: return status;
                            }
                          };
                          const getPaymentTypeLabel = (type) => {
                            switch (type) {
                              case 'cash': return 'نقدي';
                              case 'deferred': return 'آجل';
                              default: return type;
                            }
                          };
                          return (
                            <TableRow key={inv.id} hover>
                              <TableCell align="right" sx={{ fontWeight: 'bold', fontFamily: 'monospace' }}>
                                {inv.invoice_number}
                              </TableCell>
                              <TableCell align="right">
                                {inv.created_at ? new Date(inv.created_at).toLocaleDateString('ar-EG') : '—'}
                              </TableCell>
                              <TableCell align="right">
                                <Chip label={getPaymentTypeLabel(inv.payment_type)} size="small" variant="outlined" />
                              </TableCell>
                              <TableCell align="right" sx={{ fontWeight: 'bold' }}>{formatCurrencyEGP(inv.total_price)}</TableCell>
                              <TableCell align="right" sx={{ color: 'success.main' }}>{formatCurrencyEGP(inv.paid_amount)}</TableCell>
                              <TableCell align="right" sx={{ color: inv.remaining_amount > 0 ? 'error.main' : 'inherit' }}>{formatCurrencyEGP(inv.remaining_amount)}</TableCell>
                              <TableCell align="center">
                                <Chip
                                  label={getPayStatusLabel(inv.payment_status)}
                                  color={getPayStatusColor(inv.payment_status)}
                                  size="small"
                                />
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </TableContainer>
                ) : (
                  <EmptyState title="لا توجد فواتير صادرة" description="لم يتم إصدار أي فواتير لهذا المنفذ بعد." />
                )}
              </Box>
            )}
          </Box>
        )}
      </EntityDrawer>

      {/* Confirmation Dialog */}
      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={executeDeleteOutlet}
        title="تأكيد حذف منفذ التوزيع"
        message="هل أنت متأكد من حذف هذا المنفذ؟ لا يمكن التراجع عن هذا الإجراء."
        severity="error"
        confirmText="حذف"
      />

      {/* QR Code Dialog */}
      <Dialog open={qrOpen} onClose={() => setQrOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle align="center">{t('system.qrCode')}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 3 }}>
          {qrData && (
            <>
              <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mb: 1 }}>{qrData.name}</Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>{t('system.outletCode')}: {qrData.code}</Typography>
              <img 
                src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(window.location.origin + '/outlets?search=' + qrData.code)}`} 
                alt="Outlet QR Code"
                className="outlet-qr-code"
              />
              <Typography variant="caption" sx={{ color: 'text.secondary', mt: 2, textAlign: 'center' }}>{t('system.scanQr')}</Typography>
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setQrOpen(false)}>{t('system.close')}</Button>
        </DialogActions>
      </Dialog>

      {/* Snackbar alerting */}
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

export default Outlets;
