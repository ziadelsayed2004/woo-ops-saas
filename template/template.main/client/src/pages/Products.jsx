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
import ConfirmDialog from '../components/ConfirmDialog';
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
  InputAdornment,
  Divider,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions
} from '@mui/material';
import {
  Edit as EditIcon,
  Add as AddIcon,
  Search as SearchIcon,
  Delete as DeleteIcon,
  Visibility as VisibilityIcon
} from '@mui/icons-material';

import '../styles/Products.css';

export const Products = () => {
  const { hasPermission } = useAuth();
  
  // Products listing states
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [authorsList, setAuthorsList] = useState([]);
  const [outletTypes, setOutletTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(new URLSearchParams(window.location.search).get('search') || '');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  // Dialog controllers
  const [openModal, setOpenModal] = useState(false);
  const [modalMode, setModalMode] = useState('create'); // 'create' or 'edit'
  const [selectedProduct, setSelectedProduct] = useState(null);
  
  const [openDetailsModal, setOpenDetailsModal] = useState(false);
  const [detailsProduct, setDetailsProduct] = useState(null);
  const [detailsPrices, setDetailsPrices] = useState([]);

  // Form states
  const [formTitle, setFormTitle] = useState('');
  const [formCode, setFormCode] = useState('');
  const [formCategoryIds, setFormCategoryIds] = useState([]);
  const [formStatus, setFormStatus] = useState('active');
  const [formStockPolicy, setFormStockPolicy] = useState('track');
  const [formAuthorId, setFormAuthorId] = useState('');
  const [formPrices, setFormPrices] = useState({}); // { outletTypeId: priceValue }

  // Notifications toast state
  const [toastMsg, setToastMsg] = useState('');
  const [toastSeverity, setToastSeverity] = useState('success');

  // Confirmation dialog state
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [productIdToDelete, setProductIdToDelete] = useState(null);

  const fetchInitialData = async () => {
    const requests = [
      apiClient.get('/categories')
        .then(setCategories)
        .catch((err) => console.error('Failed to load categories:', err))
    ];

    if (hasPermission('authors.view')) {
      requests.push(
        apiClient.get('/authors?limit=500&status=active')
          .then(setAuthorsList)
          .catch((err) => console.error('Failed to load authors:', err))
      );
    }
    if (hasPermission('outlet_types.view') && hasPermission('product_prices.view')) {
      requests.push(
        apiClient.get('/outlet-types?limit=100&includeDisabled=false')
          .then(setOutletTypes)
          .catch((err) => console.error('Failed to load outlet types:', err))
      );
    }

    await Promise.all(requests);
  };

  const fetchProducts = async () => {
    setLoading(true);
    try {
      let query = `/products?search=${search}`;
      if (categoryFilter) query += `&category=${categoryFilter}`;
      if (statusFilter) query += `&status=${statusFilter}`;
      
      const data = await apiClient.get(query);
      setProducts(data);

      // Auto-open details if search code matches exactly
      const searchParam = new URLSearchParams(window.location.search).get('search');
      if (searchParam && data && data.length > 0) {
        const exactMatch = data.find(p => p.code === searchParam.trim());
        if (exactMatch) {
          handleOpenDetails(exactMatch);
        }
      }
    } catch (err) {
      console.error(err);
      showToast(err.message || 'فشل تحميل المنتجات.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInitialData();
  }, []);

  useEffect(() => {
    fetchProducts();
  }, [search, categoryFilter, statusFilter]);

  const showToast = (msg, severity = 'success') => {
    setToastMsg(msg);
    setToastSeverity(severity);
  };

  // Open Details View (fetches outlet type prices dynamically)
  const handleOpenDetails = async (product) => {
    setDetailsProduct(product);
    setDetailsPrices([]);
    setOpenDetailsModal(true);
    if (!hasPermission('product_prices.view')) return;
    try {
      const prices = await apiClient.get(`/product-prices/product/${product.id}`);
      setDetailsPrices(prices);
    } catch (err) {
      console.error(err);
      showToast('فشل تحميل قائمة أسعار المنتج.', 'error');
    }
  };

  const handleOpenCreateModal = () => {
    setModalMode('create');
    setSelectedProduct(null);
    setFormTitle('');
    setFormCode('');
    setFormCategoryIds([]);
    setFormStatus('active');
    setFormStockPolicy('track');
    setFormAuthorId('');
    
    // Initialise empty prices for all active outlet types
    const initialPrices = {};
    outletTypes.forEach(ot => {
      initialPrices[ot.id] = '';
    });
    setFormPrices(initialPrices);
    
    // Auto-generate SKU
    apiClient.get('/system/next-code?type=product')
      .then(res => {
        if (res && res.code) {
          setFormCode(res.code);
        }
      })
      .catch(console.error);

    setOpenModal(true);
  };

  const handleOpenEditModal = async (product) => {
    setModalMode('edit');
    setSelectedProduct(product);
    setFormTitle(product.title);
    setFormCode(product.code);
    setFormCategoryIds(product.categories ? product.categories.map(c => c.id) : []);
    setFormStatus(product.status);
    setFormStockPolicy(product.stockPolicy || 'track');
    setFormAuthorId(product.authors?.[0]?.id || '');
    
    // Fetch prices to populate form
    const initialPrices = {};
    outletTypes.forEach(ot => {
      initialPrices[ot.id] = '';
    });
    setFormPrices(initialPrices);
    
    setOpenModal(true);
    if (!hasPermission('product_prices.view')) return;
    try {
      const prices = await apiClient.get(`/product-prices/product/${product.id}`);
      const priceMap = {};
      prices.forEach(p => {
        priceMap[p.outletTypeId] = p.price;
      });
      setFormPrices({
        ...initialPrices,
        ...priceMap
      });
    } catch (err) {
      console.error('Failed to fetch pricing list for edit:', err);
    }
  };

  const handlePriceChange = (outletTypeId, val) => {
    setFormPrices({
      ...formPrices,
      [outletTypeId]: val
    });
  };

  const handleFormSubmit = async (e) => {
    e.preventDefault();
    if (!formTitle || !formCode) {
      showToast('عنوان الكتاب ورمز SKU مطلوبان.', 'error');
      return;
    }

    const payload = {
      title: formTitle,
      code: formCode,
      categoryIds: formCategoryIds,
      status: formStatus,
      stockPolicy: formStockPolicy,
      authorIds: formAuthorId ? [formAuthorId] : []
    };

    try {
      let productId;
      if (modalMode === 'create') {
        const res = await apiClient.post('/products', payload);
        productId = res.product.id;
        showToast('تم إنشاء المنتج بنجاح.');
      } else {
        await apiClient.put(`/products/${selectedProduct.id}`, payload);
        productId = selectedProduct.id;
        showToast('تم تحديث بيانات المنتج بنجاح.');
      }

      // Map prices payload: format array [{ outletTypeId, price }]
      const pricesPayload = [];
      Object.keys(formPrices).forEach(otId => {
        const priceVal = parseFloat(formPrices[otId]);
        if (!isNaN(priceVal) && priceVal >= 0) {
          pricesPayload.push({
            outletTypeId: parseInt(otId, 10),
            price: priceVal
          });
        }
      });

      // Send bulk prices update
      if (hasPermission('product_prices.update') && pricesPayload.length > 0) {
        await apiClient.put(`/product-prices/product/${productId}`, { prices: pricesPayload });
      }

      setOpenModal(false);
      fetchProducts();
      // Reload categories list
      const cats = await apiClient.get('/categories');
      setCategories(cats);
    } catch (err) {
      console.error(err);
      showToast(err.message || 'فشل حفظ التعديلات.', 'error');
    }
  };

  const handleDeleteProduct = (prodId) => {
    setProductIdToDelete(prodId);
    setConfirmOpen(true);
  };

  const executeDeleteProduct = async () => {
    if (!productIdToDelete) return;
    try {
      await apiClient.delete(`/products/${productIdToDelete}`);
      showToast('تم حذف المنتج بنجاح.');
      fetchProducts();
    } catch (err) {
      console.error(err);
      showToast(err.message || 'فشل حذف المنتج من قاعدة البيانات.', 'error');
    } finally {
      setConfirmOpen(false);
      setProductIdToDelete(null);
    }
  };

  if (loading && products.length === 0) {
    return <LoadingState type="skeleton" />;
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h5" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
          دليل الكتب والمنشورات
        </Typography>
        {hasPermission('products.create') && (
          <Button
            variant="contained"
            color="secondary"
            startIcon={<AddIcon />}
            onClick={handleOpenCreateModal}
            sx={{ fontWeight: 'bold' }}
          >
            إضافة كتاب / منتج جديد
          </Button>
        )}
      </Box>

      {/* Search & Filters */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              size="small"
              placeholder="البحث بالاسم أو الرمز SKU..."
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
          <Grid item xs={12} sm={3}>
            <FormControl fullWidth size="small">
              <InputLabel id="cat-filter-label">التصنيف</InputLabel>
              <Select
                labelId="cat-filter-label"
                value={categoryFilter}
                label="التصنيف"
                onChange={(e) => setCategoryFilter(e.target.value)}
              >
                <MenuItem value="">الجميع</MenuItem>
                {categories.map((c) => (
                  <MenuItem key={c.id} value={c.id.toString()}>
                    {c.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>
          <Grid item xs={12} sm={3}>
            <FormControl fullWidth size="small">
              <InputLabel id="status-filter-label">حالة المنتج</InputLabel>
              <Select
                labelId="status-filter-label"
                value={statusFilter}
                label="حالة المنتج"
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

      {/* Table grid */}
      {products.length === 0 ? (
        <EmptyState title="لا يوجد منتجات" description="لم نتمكن من العثور على أي كتب تطابق معايير البحث الحالية." />
      ) : (
        <TableContainer className="scrollable-table-container" component={Paper} sx={{ overflowX: 'auto', width: '100%' }}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell align="center" sx={{ fontWeight: 'bold' }}>الرمز (SKU)</TableCell>
                <TableCell align="center" sx={{ fontWeight: 'bold' }}>العنوان والكتاب</TableCell>
                <TableCell align="center" sx={{ fontWeight: 'bold' }}>التصنيف</TableCell>
                <TableCell align="center" sx={{ fontWeight: 'bold' }}>المؤلف</TableCell>
                <TableCell align="center" sx={{ fontWeight: 'bold' }}>سياسة الجرد</TableCell>
                <TableCell align="center" sx={{ fontWeight: 'bold' }}>الحالة</TableCell>
                <TableCell align="right" sx={{ fontWeight: 'bold' }}>العمليات</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {products.map((p) => (
                <TableRow key={p.id} hover>
                  <TableCell align="center" sx={{ fontFamily: 'monospace' }}>{p.code}</TableCell>
                  <TableCell align="center" sx={{ fontWeight: 500 }}>{p.title}</TableCell>
                  <TableCell align="center">
                    {p.categories && p.categories.length > 0 ? (
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 0.5 }}>
                        {p.categories.map((c) => (
                          <Chip key={c.id} label={c.name} size="small" variant="outlined" color="primary" />
                        ))}
                      </Box>
                    ) : (
                      '-'
                    )}
                  </TableCell>
                  <TableCell align="center">
                    {p.authors && p.authors.length > 0 ? (
                      p.authors[0].name
                    ) : (
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>غير محدد</Typography>
                    )}
                  </TableCell>
                  <TableCell align="center">
                    {p.stockPolicy === 'track' ? 'تتبع الكميات' : 'تجاهل الجرد'}
                  </TableCell>
                  <TableCell align="center">
                    <Chip
                      label={p.status === 'active' ? 'نشط' : 'معطل'}
                      color={p.status === 'active' ? 'success' : 'error'}
                      size="small"
                    />
                  </TableCell>
                  <TableCell align="right">
                    <Box sx={{ display: 'flex', justifyContent: 'flex-start', gap: 1 }}>
                      <IconButton
                        color="secondary"
                        onClick={() => handleOpenDetails(p)}
                        title={hasPermission('product_prices.view') ? 'عرض التفاصيل والأسعار' : 'عرض التفاصيل'}
                      >
                        <VisibilityIcon />
                      </IconButton>
                      {hasPermission('products.update') && (
                        <IconButton color="primary" onClick={() => handleOpenEditModal(p)} title="تعديل">
                          <EditIcon />
                        </IconButton>
                      )}
                      {hasPermission('products.delete') && (
                        <IconButton color="error" onClick={() => handleDeleteProduct(p.id)} title="حذف">
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

      {/* Details Drawer */}
      <EntityDrawer
        open={openDetailsModal}
        onClose={() => setOpenDetailsModal(false)}
        title={hasPermission('product_prices.view') ? 'تفاصيل الكتاب والأسعار' : 'تفاصيل الكتاب'}
        actions={<Button onClick={() => setOpenDetailsModal(false)} variant="outlined">إغلاق</Button>}
      >
        {detailsProduct && (
          <FormSection title={detailsProduct.title} description={`${t('system.sku')}: ${detailsProduct.code}`}>
            <FieldGrid columns={1}>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                التصنيفات: {detailsProduct.categories && detailsProduct.categories.length > 0
                  ? detailsProduct.categories.map(c => c.name).join('، ')
                  : 'غير محدد'}
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
                المؤلف: {detailsProduct.authors?.[0]?.name || 'غير محدد'}
              </Typography>
            </FieldGrid>

            {/* QR Code section */}
            <Box sx={{ mt: 3, display: 'flex', flexDirection: 'column', alignItems: 'center', p: 2, border: '1px dashed #cbd5e1', borderRadius: 1 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1 }}>{t('system.qrCode')}</Typography>
              <img 
                src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(window.location.origin + '/products?search=' + detailsProduct.code)}`} 
                alt="Product QR Code"
                className="product-qr-code"
              />
              <Typography variant="caption" sx={{ color: 'text.secondary', mt: 1 }}>{t('system.scanToViewProduct')}</Typography>
            </Box>
            
            {hasPermission('product_prices.view') && (
              <>
                <Divider sx={{ my: 3 }} />
                <Typography variant="subtitle1" sx={{ fontWeight: 'bold', mb: 1.5 }}>
                  أسعار البيع المعتمدة بحسب فئات المنافذ:
                </Typography>
                {detailsPrices.length === 0 ? (
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>لا توجد أسعار مدخلة بعد لهذا المنتج.</Typography>
                ) : (
                  <TableContainer className="scrollable-table-container">
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell align="right">فئة المنفذ</TableCell>
                          <TableCell align="right">السعر المعتمد</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {detailsPrices.map((pr) => (
                          <TableRow key={pr.outletTypeId}>
                            <TableCell align="right">{pr.outletTypeName}</TableCell>
                            <TableCell align="right" sx={{ fontWeight: 'bold', color: 'secondary.main' }}>
                              {formatCurrencyEGP(pr.price)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
              </>
            )}
          </FormSection>
        )}
      </EntityDrawer>

      {/* Editor Drawer */}
      <EntityDrawer
        open={openModal}
        onClose={() => setOpenModal(false)}
        title={modalMode === 'create' ? 'إضافة كتاب / منتج جديد' : 'تعديل بيانات المنتج'}
        actions={
          <>
            <Button onClick={() => setOpenModal(false)}>إلغاء</Button>
            <Button type="submit" form="product-editor-form" variant="contained" color="secondary">حفظ التغييرات</Button>
          </>
        }
      >
        <form onSubmit={handleFormSubmit} id="product-editor-form">
          <FormSection title="البيانات الأساسية">
            <FieldGrid columns={1}>
              <TextField
                required
                fullWidth
                size="small"
                label="عنوان الكتاب / المنتج"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
              />
              <TextField
                required
                fullWidth
                size="small"
                label={t('system.sku')}
                value={formCode}
                inputProps={{ className: 'ltr-value', readOnly: true }}
                disabled={true}
              />
              <FormControl fullWidth size="small">
                <InputLabel id="form-categories-label">التصنيفات</InputLabel>
                <Select
                  labelId="form-categories-label"
                  multiple
                  value={formCategoryIds}
                  onChange={(e) => setFormCategoryIds(e.target.value)}
                  label="التصنيفات"
                  renderValue={(selected) => (
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                      {selected.map((value) => {
                        const cat = categories.find(c => c.id === value);
                        return <Chip key={value} label={cat ? cat.name : value} size="small" />;
                      })}
                    </Box>
                  )}
                >
                  {categories.map((c) => (
                    <MenuItem key={c.id} value={c.id}>
                      {c.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl fullWidth size="small">
                <InputLabel id="form-stock-policy-label">سياسة المخزون والجرد</InputLabel>
                <Select
                  labelId="form-stock-policy-label"
                  value={formStockPolicy}
                  label="سياسة المخزون والجرد"
                  onChange={(e) => setFormStockPolicy(e.target.value)}
                >
                  <MenuItem value="track">تتبع الجرد والكميات</MenuItem>
                  <MenuItem value="ignore">تجاهل الجرد ومراقبة stock</MenuItem>
                </Select>
              </FormControl>
              <FormControl fullWidth size="small">
                <InputLabel id="form-author-label">المؤلف</InputLabel>
                <Select
                  labelId="form-author-label"
                  value={formAuthorId}
                  label="المؤلف"
                  onChange={(e) => setFormAuthorId(e.target.value)}
                >
                  <MenuItem value="">غير محدد</MenuItem>
                  {authorsList.map((a) => (
                    <MenuItem key={a.id} value={a.id}>
                      {a.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl fullWidth size="small">
                <InputLabel id="form-status-label">حالة المنتج</InputLabel>
                <Select
                  labelId="form-status-label"
                  value={formStatus}
                  label="حالة المنتج"
                  onChange={(e) => setFormStatus(e.target.value)}
                >
                  <MenuItem value="active">نشط</MenuItem>
                  <MenuItem value="disabled">معطل</MenuItem>
                </Select>
              </FormControl>
            </FieldGrid>
          </FormSection>

          {hasPermission('product_prices.update') && (
            <FormSection title="قائمة أسعار البيع المعتمدة بحسب فئات المنافذ">
              <FieldGrid columns={2}>
                {outletTypes.map((ot) => (
                  <TextField
                    key={ot.id}
                    type="number"
                    size="small"
                    label={`السعر لـ (${ot.name})`}
                    value={formPrices[ot.id] || ''}
                    onChange={(e) => handlePriceChange(ot.id, e.target.value)}
                    placeholder="0.00"
                    fullWidth
                    InputProps={{
                      endAdornment: <InputAdornment position="end">ج.م</InputAdornment>,
                    }}
                  />
                ))}
              </FieldGrid>
            </FormSection>
          )}
        </form>
      </EntityDrawer>

      {/* Confirmation Dialog */}
      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={executeDeleteProduct}
        title="تأكيد حذف المنتج"
        message="هل أنت متأكد من حذف هذا المنتج؟ لا يمكن التراجع عن هذا الإجراء."
        severity="error"
        confirmText="حذف"
      />

      {/* Snackbar Alert */}
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

export default Products;
