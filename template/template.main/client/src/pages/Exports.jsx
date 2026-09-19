import React, { useState, useEffect } from 'react';
import { useAuth } from '../app/AuthContext';
import { apiClient } from '../services/apiClient';
import {
  Box,
  Typography,
  Paper,
  Grid,
  Card,
  CardContent,
  CardActions,
  Button,
  Alert,
  Snackbar,
  Divider,
  Stack,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  FormHelperText,
  Tabs,
  Tab,
  TableContainer,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  IconButton,
  Tooltip,
  CircularProgress,
  RadioGroup,
  FormControlLabel,
  Radio
} from '@mui/material';
import {
  Book as BookIcon,
  AttachMoney as PriceIcon,
  People as PeopleIcon,
  Store as StoreIcon,
  Receipt as InvoiceIcon,
  Payment as PaymentIcon,
  Inventory as LedgerIcon,
  FileDownload as DownloadIcon,
  Loop as ReturnIcon,
  LocalShipping as ShippingIcon,
  FilterAlt as FilterIcon,
  Delete as DeleteIcon,
  Backup as BackupIcon,
  SettingsBackupRestore as RestoreIcon,
  Refresh as RefreshIcon,
  CloudDownload as CloudDownloadIcon
} from '@mui/icons-material';

import '../styles/Exports.css';

const EXPORT_MODULE_PERMISSIONS = {
  invoices: ['invoices.export'],
  'invoice-items': ['invoices.export'],
  payments: ['payments.view'],
  'outlet-statement': ['finance.statement.view'],
  inventory: ['inventory.view'],
  shipments: ['shipments.view'],
  'courier-sheet': ['shipments.view'],
  returns: ['returns.view'],
  products: ['products.view'],
  prices: ['product_prices.view'],
  outlets: ['outlets.view'],
  authors: ['authors.view'],
  'report-balances': ['reports.view', 'finance.view'],
  'report-stock': ['reports.view', 'inventory.view'],
  'report-authors': ['reports.view', 'authors.view'],
  'report-receipts': ['reports.view', 'inventory.view']
};

export const Exports = () => {
  const { hasPermission } = useAuth();
  const canAccessModule = (module) =>
    (EXPORT_MODULE_PERMISSIONS[module.id] || []).every(hasPermission);
  
  const getButtonStyle = (color) => ({
    py: 0.5, 
    fontWeight: 'bold', 
    borderRadius: 1.5,
    borderColor: `${color}60`,
    color: 'text.primary',
    fontSize: '0.8rem',
    transition: 'all 0.2s',
    '&:hover': {
      bgcolor: color,
      borderColor: color,
      color: '#fff'
    }
  });

  const [toastMsg, setToastMsg] = useState('');
  const [toastSeverity, setToastSeverity] = useState('success');
  
  const [outlets, setOutlets] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState(0);

  // Dialog state
  const [openDialog, setOpenDialog] = useState(false);
  const [selectedMod, setSelectedMod] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [formFilters, setFormFilters] = useState({
    startDate: '',
    endDate: '',
    outletId: '',
    productId: '',
    paymentStatus: '',
    shippingStatus: '',
    paymentType: '',
    supplyStatus: '',
    shipmentStatus: '',
    transactionType: '',
    governorate: '',
    format: 'xlsx'
  });

  const governorates = [
    'Cairo', 'Giza', 'Alexandria', 'Qalyubia', 'Gharbia', 'Dakahlia', 'Monufia', 
    'Sharqia', 'Beheira', 'Damietta', 'Port Said', 'Ismailia', 'Suez', 
    'Kafr El Sheikh', 'Fayoum', 'Beni Suef', 'Minya', 'Assiut', 'Sohag', 
    'Qena', 'Luxor', 'Aswan', 'Red Sea', 'New Valley', 'Matrouh', 'North Sinai', 'South Sinai'
  ];

  const showToast = (msg, severity = 'success') => { 
    setToastMsg(msg); 
    setToastSeverity(severity); 
  };

  useEffect(() => {
    if (hasPermission('outlets.view')) {
      apiClient.get('/outlets')
      .then(data => setOutlets(Array.isArray(data) ? data : []))
      .catch(err => console.error('Error fetching outlets:', err));
    }

    if (hasPermission('products.view')) {
      apiClient.get('/products')
      .then(data => setProducts(Array.isArray(data) ? data : []))
      .catch(err => console.error('Error fetching products:', err));
    }
  }, []);



  const getGroupedModules = () => {
    const allModules = exportSectors[2].modules;
    
    // Group 1: Catalog & Pricing
    const catalogModules = allModules.filter(m =>
      ['products', 'prices', 'authors'].includes(m.id) && canAccessModule(m)
    );
    
    // Group 2: Inventory Ledger & Operations
    const inventoryModules = allModules.filter(m =>
      ['report-stock', 'report-receipts'].includes(m.id) && canAccessModule(m)
    );
    
    // Group 3: Sales & Balances Reports
    const salesModules = allModules.filter(m =>
      ['report-balances', 'report-authors', 'outlets'].includes(m.id) && canAccessModule(m)
    );
    
    return [
      { title: 'بيانات الكتالوج والأسعار', modules: catalogModules, icon: <BookIcon sx={{ color: '#f1c40f', fontSize: '1.25rem' }} /> },
      { title: 'تقارير حركة المخزون والعمليات', modules: inventoryModules, icon: <LedgerIcon sx={{ color: '#d35400', fontSize: '1.25rem' }} /> },
      { title: 'تقارير وأرصدة المبيعات', modules: salesModules, icon: <PriceIcon sx={{ color: '#2ecc71', fontSize: '1.25rem' }} /> }
    ];
  };

  const exportSectors = [
    {
      name: 'القطاع المالي والمبيعات',
      description: 'تقارير الفواتير التفصيلية، المقبوضات المالية، كشوف الحسابات والتسويات.',
      color: '#2ecc71',
      modules: [
        {
          id: 'invoices',
          title: 'سجل الفواتير الصادرة',
          description: 'تصدير فواتير البيع المصدرة متضمنة المنفذ، محتويات الفاتورة، حالة السداد والشحن.',
          icon: <InvoiceIcon sx={{ fontSize: 22, color: '#e67e22' }} />,
          endpoint: '/exports/invoices',
          filename: 'invoices_export',
          filters: ['dateRange', 'outlet', 'paymentStatus', 'shippingStatus', 'paymentType']
        },
        {
          id: 'invoice-items',
          title: 'حركات أصناف الفواتير',
          description: 'تصدير مبيعات الكتب التفصيلية سطر بسطر متضمنة الكميات والأسعار والتاريخ.',
          icon: <InvoiceIcon sx={{ fontSize: 22, color: '#d35400' }} />,
          endpoint: '/exports/invoice-items',
          filename: 'invoice_items_export',
          filters: ['dateRange', 'outlet', 'product']
        },
        {
          id: 'payments',
          title: 'سجل المقبوضات والدفعات',
          description: 'تصدير حركات المقبوضات المالية والدفعات وحالة التوريد للمقر.',
          icon: <PaymentIcon sx={{ fontSize: 22, color: '#9b59b6' }} />,
          endpoint: '/exports/payments',
          filename: 'payments_export',
          filters: ['dateRange', 'outlet', 'supplyStatus']
        },
        {
          id: 'outlet-statement',
          title: 'كشف حساب معاملات منفذ',
          description: 'تصدير كشف حساب تفصيلي لحركات الأرصدة والمدفوعات والمبيعات لمنفذ بيع.',
          icon: <StoreIcon sx={{ fontSize: 22, color: '#27ae60' }} />,
          endpoint: '/exports/outlet-statement',
          filename: 'outlet_statement_export',
          filters: ['dateRange', 'outletRequired']
        }
      ]
    },
    {
      name: 'قطاع المخزون والخدمات اللوجستية',
      description: 'تقارير حركة المستودعات، الشحنات الصادرة، وإدارة مرتجعات المبيعات.',
      color: '#3498db',
      modules: [
        {
          id: 'inventory',
          title: 'دفتر حركات المخزون',
          description: 'تصدير دفتر الأستاذ لحركات المستودعات (الوارد، الصادر، المرتجعات، التسويات).',
          icon: <LedgerIcon sx={{ fontSize: 22, color: '#1abc9c' }} />,
          endpoint: '/exports/inventory',
          filename: 'inventory_export',
          filters: ['dateRange', 'product', 'transactionType']
        },
        {
          id: 'shipments',
          title: 'سجل الشحنات والطرود',
          description: 'تصدير كامل بيانات الطرود والشحنات المرسلة للمنافذ مع أرقام التتبع.',
          icon: <ShippingIcon sx={{ fontSize: 22, color: '#34495e' }} />,
          endpoint: '/exports/shipments',
          filename: 'shipments_export',
          filters: ['dateRange', 'outlet', 'shipmentStatus']
        },
        {
          id: 'courier-sheet',
          title: 'شيت شحن وتوصيل الطلبيات',
          description: 'تصدير شيت توصيل للمناديب وشركات الشحن يحتوي على العناوين والكميات.',
          icon: <ShippingIcon sx={{ fontSize: 22, color: '#2c3e50' }} />,
          endpoint: '/exports/courier-sheet',
          filename: 'courier_sheet_export',
          filters: ['dateRange', 'outlet', 'governorate', 'shipmentStatus']
        },
        {
          id: 'returns',
          title: 'سجل المرتجعات والمسترجعات',
          description: 'تصدير حركات مرتجعات مبيعات الكتب بالتفصيل مع قيمة وسبب الارتجاع.',
          icon: <ReturnIcon sx={{ fontSize: 22, color: '#e74c3c' }} />,
          endpoint: '/exports/returns',
          filename: 'returns_export',
          filters: ['dateRange', 'outlet']
        }
      ]
    },
    {
      name: 'قطاع البيانات الأساسية والتقارير العامة',
      description: 'دليل الكتب والمنتجات، لوائح الأسعار المعتمدة، وسجلات المؤلفين ومنافذ التوزيع.',
      color: '#f1c40f',
      modules: [
        {
          id: 'products',
          title: 'دليل المنتجات والكتب',
          description: 'تصدير كامل المنتجات والكتب المسجلة في النظام مع تفاصيل SKU والبيانات الفنية.',
          icon: <BookIcon sx={{ fontSize: 22, color: 'primary.main' }} />,
          endpoint: '/exports/products',
          filename: 'products_export',
          filters: []
        },
        {
          id: 'prices',
          title: 'قوائم الأسعار التفصيلية',
          description: 'تصدير أسعار الكتب والمنتجات الموزعة والمخصصة لكل فئة منفذ بيع.',
          icon: <PriceIcon sx={{ fontSize: 22, color: 'success.main' }} />,
          endpoint: '/exports/prices',
          filename: 'prices_export',
          filters: []
        },
        {
          id: 'outlets',
          title: 'قائمة منافذ البيع والفروع',
          description: 'تصدير دليل فروع ومنافذ البيع بالتفصيل مع المحافظات وأرقام الهواتف والتصنيف.',
          icon: <StoreIcon sx={{ fontSize: 22, color: 'secondary.main' }} />,
          endpoint: '/exports/outlets',
          filename: 'outlets_export',
          filters: []
        },
        {
          id: 'authors',
          title: 'سجل وأسماء المؤلفين',
          description: 'تصدير قائمة المؤلفين ومعلومات الاتصال وحسابات المؤلفين المرتبطة.',
          icon: <PeopleIcon sx={{ fontSize: 22, color: 'info.main' }} />,
          endpoint: '/exports/authors',
          filename: 'authors_export',
          filters: []
        },
        {
          id: 'report-balances',
          title: 'تقرير أرصدة ومبيعات المنافذ',
          description: 'تصدير تقرير الأرصدة الإجمالي لمبيعات ومقبوضات المنافذ.',
          icon: <LedgerIcon sx={{ fontSize: 22, color: '#f39c12' }} />,
          endpoint: '/exports/reports?type=balances',
          filename: 'balances_report_export',
          filters: []
        },
        {
          id: 'report-stock',
          title: 'تقرير جرد حركة الكتب',
          description: 'تصدير تقرير الجرد المخزني وتفاصيل الكميات الواردة والمنصرفة.',
          icon: <LedgerIcon sx={{ fontSize: 22, color: '#d35400' }} />,
          endpoint: '/exports/reports?type=stock',
          filename: 'stock_report_export',
          filters: []
        },
        {
          id: 'report-authors',
          title: 'تقرير مبيعات كتب المؤلفين',
          description: 'تصدير تقارير مبيعات الكتب ونسب التوزيع لكل مؤلف.',
          icon: <PeopleIcon sx={{ fontSize: 22, color: '#8e44ad' }} />,
          endpoint: '/exports/reports?type=authors',
          filename: 'authors_report_export',
          filters: []
        },
        {
          id: 'report-receipts',
          title: 'تقرير توريد الكتب والاستلام',
          description: 'تصدير سجلات استلام الكتب المطبوعة من المطابع والموردين.',
          icon: <PriceIcon sx={{ fontSize: 22, color: '#16a085' }} />,
          endpoint: '/exports/reports?type=receipts',
          filename: 'receipts_report_export',
          filters: []
        }
      ]
    }
  ];

  const handleOpenFilters = (mod) => {
    if (!hasPermission('exports.run') || !canAccessModule(mod)) {
      showToast('ليس لديك صلاحية لتصدير هذا النوع من البيانات.', 'error');
      return;
    }
    setSelectedMod(mod);
    setErrorMsg('');
    setFormFilters({
      startDate: '',
      endDate: '',
      outletId: '',
      productId: '',
      paymentStatus: '',
      shippingStatus: '',
      paymentType: '',
      supplyStatus: '',
      shipmentStatus: '',
      transactionType: '',
      governorate: '',
      format: 'xlsx'
    });
    setOpenDialog(true);
  };

  const handleExportSubmit = () => {
    if (!hasPermission('exports.run') || !selectedMod || !canAccessModule(selectedMod)) {
      showToast('ليس لديك صلاحية تصدير البيانات', 'error');
      return;
    }

    if (selectedMod.filters.includes('outletRequired') && !formFilters.outletId) {
      setErrorMsg('يجب اختيار منفذ التوزيع أولاً');
      return;
    }

    setErrorMsg('');
    setLoading(true);

    const queryParams = new URLSearchParams();
    if (formFilters.startDate) queryParams.append('startDate', formFilters.startDate);
    if (formFilters.endDate) queryParams.append('endDate', formFilters.endDate);
    if (formFilters.outletId) queryParams.append('outletId', formFilters.outletId);
    if (formFilters.productId) queryParams.append('productId', formFilters.productId);
    if (formFilters.paymentStatus) queryParams.append('paymentStatus', formFilters.paymentStatus);
    if (formFilters.shippingStatus) queryParams.append('shippingStatus', formFilters.shippingStatus);
    if (formFilters.paymentType) queryParams.append('paymentType', formFilters.paymentType);
    if (formFilters.supplyStatus) queryParams.append('supplyStatus', formFilters.supplyStatus);
    if (formFilters.shipmentStatus) queryParams.append('status', formFilters.shipmentStatus); 
    if (formFilters.transactionType) queryParams.append('transactionType', formFilters.transactionType);
    if (formFilters.governorate) queryParams.append('governorate', formFilters.governorate);
    queryParams.append('format', formFilters.format);

    let downloadUrl = `/api${selectedMod.endpoint}`;
    if (downloadUrl.includes('?')) {
      downloadUrl += `&${queryParams.toString()}`;
    } else {
      downloadUrl += `?${queryParams.toString()}`;
    }

    window.open(downloadUrl, '_blank');
    setOpenDialog(false);
    setLoading(false);
    showToast('جاري تحضير وتنزيل الملف بالتنسيق المختار...', 'success');
  };

  const currentSector = exportSectors[activeTab];

  return (
    <Box className="exports-container">
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" sx={{ fontWeight: 'bold', color: 'primary.main', mb: 1 }}>
          مركز تصدير التقارير المتقدم
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          تصفية واستخراج البيانات بالتنسيق المناسب كملفات Excel مهيأة وموسطة الخلايا مع دعم كامل لاتجاه الصفحة RTL والجداول الملونة أو ملفات CSV.
        </Typography>
      </Box>

      {!hasPermission('exports.run') && !hasPermission('backup.create') ? (
        <Alert severity="error" sx={{ mb: 3 }}>
          تنبيه: أنت لا تملك صلاحية لتصدير السجلات أو إجراء النسخ الاحتياطي للبيانات. يرجى مراجعة المسؤول.
        </Alert>
      ) : (
        <Box>
          <Tabs
            value={activeTab}
            onChange={(e, val) => setActiveTab(val)}
            indicatorColor="primary"
            textColor="primary"
            variant="scrollable"
            scrollButtons="auto"
            sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}
          >
            <Tab label="القطاع المالي والمبيعات" />
            <Tab label="المستودعات والخدمات اللوجستية" />
            <Tab label="البيانات الأساسية والتقارير العامة" />
          </Tabs>

          {/* Export Sectors Tab Panels */}
          {activeTab < 3 && currentSector && (
            <Box>
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 3 }}>
                {currentSector.description}
              </Typography>
              
              {activeTab === 2 ? (
                // Grouped view for tab 2
                <Stack spacing={4}>
                  {getGroupedModules().map((group, gIdx) => (
                    <Box key={gIdx}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                        {group.icon}
                        <Typography variant="subtitle1" sx={{ fontWeight: 'bold', color: 'text.primary' }}>
                          {group.title}
                        </Typography>
                      </Box>
                      <Grid container spacing={2}>
                        {group.modules.map((mod, mIdx) => (
                          <Grid item xs={12} sm={6} md={3} key={mIdx}>
                            <Card className="exports-card" sx={{ 
                              height: '100%', 
                              display: 'flex', 
                              flexDirection: 'column', 
                              justifyContent: 'space-between', 
                              borderTop: `4px solid ${currentSector.color} !important`,
                            }}>
                              <CardContent sx={{ p: 2 }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', mb: 1.5, gap: 1.5 }}>
                                  <Box className="exports-icon-wrapper" sx={{ 
                                    p: 1, 
                                    borderRadius: '8px', 
                                    bgcolor: `${currentSector.color}15`, 
                                    display: 'flex', 
                                    alignItems: 'center', 
                                    justifyContent: 'center' 
                                  }}>
                                    {mod.icon}
                                  </Box>
                                  <Typography variant="subtitle2" sx={{ fontWeight: 700, fontSize: '0.875rem', color: 'text.primary', lineHeight: 1.3 }}>
                                    {mod.title}
                                  </Typography>
                                </Box>
                                <Divider sx={{ my: 1, opacity: 0.6 }} />
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', height: 40, overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.4 }}>
                                  {mod.description}
                                </Typography>
                              </CardContent>
                              <CardActions sx={{ p: 2, pt: 0 }}>
                                <Button
                                  fullWidth
                                  variant="outlined"
                                  size="small"
                                  onClick={() => handleOpenFilters(mod)}
                                  startIcon={<FilterIcon sx={{ fontSize: '0.9rem !important' }} />}
                                  sx={getButtonStyle(currentSector.color)}
                                >
                                  تصفية وتصدير
                                </Button>
                              </CardActions>
                            </Card>
                          </Grid>
                        ))}
                      </Grid>
                      {gIdx < 2 && <Divider sx={{ mt: 4 }} />}
                    </Box>
                  ))}
                </Stack>
              ) : (
                // Flat grid view for tabs 0 and 1
                <Grid container spacing={2}>
                  {currentSector.modules.filter(canAccessModule).map((mod, mIdx) => (
                    <Grid item xs={12} sm={6} md={3} key={mIdx}>
                      <Card className="exports-card" sx={{ 
                        height: '100%', 
                        display: 'flex', 
                        flexDirection: 'column', 
                        justifyContent: 'space-between', 
                        borderTop: `4px solid ${currentSector.color} !important`,
                      }}>
                        <CardContent sx={{ p: 2 }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', mb: 1.5, gap: 1.5 }}>
                            <Box className="exports-icon-wrapper" sx={{ 
                              p: 1, 
                              borderRadius: '8px', 
                              bgcolor: `${currentSector.color}15`, 
                              display: 'flex', 
                              alignItems: 'center', 
                              justifyContent: 'center' 
                            }}>
                              {mod.icon}
                            </Box>
                            <Typography variant="subtitle2" sx={{ fontWeight: 700, fontSize: '0.875rem', color: 'text.primary', lineHeight: 1.3 }}>
                              {mod.title}
                            </Typography>
                          </Box>
                          <Divider sx={{ my: 1, opacity: 0.6 }} />
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', height: 40, overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.4 }}>
                            {mod.description}
                          </Typography>
                        </CardContent>
                        <CardActions sx={{ p: 2, pt: 0 }}>
                          <Button
                            fullWidth
                            variant="outlined"
                            size="small"
                            onClick={() => handleOpenFilters(mod)}
                            startIcon={<FilterIcon sx={{ fontSize: '0.9rem !important' }} />}
                            sx={getButtonStyle(currentSector.color)}
                          >
                            تصفية وتصدير
                          </Button>
                        </CardActions>
                      </Card>
                    </Grid>
                  ))}
                </Grid>
              )}
            </Box>
          )}
        </Box>
      )}

      {/* Dynamic Export Dialog */}
      <Dialog open={openDialog} onClose={() => setOpenDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle className="exports-dialog-header" sx={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 1 }}>
          <FilterIcon />
          تصفية وتحديد خيارات التصدير
        </DialogTitle>
        <DialogContent className="exports-dialog-content" dividers>
          {selectedMod && (
            <Stack spacing={3} sx={{ mt: 1 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
                {selectedMod.title}
              </Typography>

              {errorMsg && <Alert severity="error">{errorMsg}</Alert>}

              {selectedMod.filters.length === 0 && (
                <Typography variant="body2" color="text.secondary">
                  هذا التقرير لا يحتوي على معايير تصفية إضافية وسيتم تصدير كافة البيانات.
                </Typography>
              )}

              {/* Date range filters */}
              {selectedMod.filters.includes('dateRange') && (
                <Grid container spacing={2}>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      label="من تاريخ"
                      type="date"
                      value={formFilters.startDate}
                      onChange={(e) => setFormFilters({ ...formFilters, startDate: e.target.value })}
                      InputLabelProps={{ shrink: true }}
                    />
                  </Grid>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      label="إلى تاريخ"
                      type="date"
                      value={formFilters.endDate}
                      onChange={(e) => setFormFilters({ ...formFilters, endDate: e.target.value })}
                      InputLabelProps={{ shrink: true }}
                    />
                  </Grid>
                </Grid>
              )}

              {/* Outlet filter */}
              {(selectedMod.filters.includes('outlet') || selectedMod.filters.includes('outletRequired')) && (
                <FormControl fullWidth required={selectedMod.filters.includes('outletRequired')}>
                  <InputLabel id="export-outlet-select-label">منفذ التوزيع</InputLabel>
                  <Select
                    labelId="export-outlet-select-label"
                    value={formFilters.outletId}
                    label="منفذ التوزيع"
                    onChange={(e) => setFormFilters({ ...formFilters, outletId: e.target.value })}
                  >
                    <MenuItem value="">
                      <em>{selectedMod.filters.includes('outletRequired') ? 'اختر منفذاً...' : 'كافة المنافذ'}</em>
                    </MenuItem>
                    {outlets.map(out => (
                      <MenuItem key={out.id} value={out.id}>{out.name}</MenuItem>
                    ))}
                  </Select>
                  {selectedMod.filters.includes('outletRequired') && (
                    <FormHelperText>هذا الحقل إجباري لتوليد التقرير</FormHelperText>
                  )}
                </FormControl>
              )}

              {/* Product filter */}
              {selectedMod.filters.includes('product') && (
                <FormControl fullWidth>
                  <InputLabel id="export-product-select-label">الكتاب / المنتج</InputLabel>
                  <Select
                    labelId="export-product-select-label"
                    value={formFilters.productId}
                    label="الكتاب / المنتج"
                    onChange={(e) => setFormFilters({ ...formFilters, productId: e.target.value })}
                  >
                    <MenuItem value=""><em>كافة الكتب والمنتجات</em></MenuItem>
                    {products.map(prod => (
                      <MenuItem key={prod.id} value={prod.id}>{prod.title} ({prod.code})</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}

              {/* Governorate filter */}
              {selectedMod.filters.includes('governorate') && (
                <FormControl fullWidth>
                  <InputLabel id="export-gov-select-label">المحافظة</InputLabel>
                  <Select
                    labelId="export-gov-select-label"
                    value={formFilters.governorate}
                    label="المحافظة"
                    onChange={(e) => setFormFilters({ ...formFilters, governorate: e.target.value })}
                  >
                    <MenuItem value=""><em>كافة المحافظات</em></MenuItem>
                    {governorates.map(gov => (
                      <MenuItem key={gov} value={gov}>{gov}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}

              {/* Payment status filter */}
              {selectedMod.filters.includes('paymentStatus') && (
                <FormControl fullWidth>
                  <InputLabel id="export-pay-status-label">حالة الدفع</InputLabel>
                  <Select
                    labelId="export-pay-status-label"
                    value={formFilters.paymentStatus}
                    label="حالة الدفع"
                    onChange={(e) => setFormFilters({ ...formFilters, paymentStatus: e.target.value })}
                  >
                    <MenuItem value=""><em>كافة الحالات</em></MenuItem>
                    <MenuItem value="unpaid">آجل / غير مدفوع</MenuItem>
                    <MenuItem value="partially_paid">مدفوع جزئياً</MenuItem>
                    <MenuItem value="paid">مدفوع بالكامل</MenuItem>
                  </Select>
                </FormControl>
              )}

              {/* Shipping status filter */}
              {selectedMod.filters.includes('shippingStatus') && (
                <FormControl fullWidth>
                  <InputLabel id="export-ship-status-label">حالة الشحن</InputLabel>
                  <Select
                    labelId="export-ship-status-label"
                    value={formFilters.shippingStatus}
                    label="حالة الشحن"
                    onChange={(e) => setFormFilters({ ...formFilters, shippingStatus: e.target.value })}
                  >
                    <MenuItem value=""><em>كافة الحالات</em></MenuItem>
                    <MenuItem value="pending">قيد الانتظار</MenuItem>
                    <MenuItem value="cancelled">ملغاة</MenuItem>
                  </Select>
                </FormControl>
              )}

              {/* Shipment status filter */}
              {selectedMod.filters.includes('shipmentStatus') && (
                <FormControl fullWidth>
                  <InputLabel id="export-shipment-status-label">حالة الشحنة</InputLabel>
                  <Select
                    labelId="export-shipment-status-label"
                    value={formFilters.shipmentStatus}
                    label="حالة الشحنة"
                    onChange={(e) => setFormFilters({ ...formFilters, shipmentStatus: e.target.value })}
                  >
                    <MenuItem value=""><em>كافة الحالات</em></MenuItem>
                    <MenuItem value="pending">قيد الانتظار / التجهيز</MenuItem>
                    <MenuItem value="cancelled">ملغاة</MenuItem>
                  </Select>
                </FormControl>
              )}

              {/* Supply status filter */}
              {selectedMod.filters.includes('supplyStatus') && (
                <FormControl fullWidth>
                  <InputLabel id="export-supply-status-label">حالة التوريد للمقر</InputLabel>
                  <Select
                    labelId="export-supply-status-label"
                    value={formFilters.supplyStatus}
                    label="حالة التوريد للمقر"
                    onChange={(e) => setFormFilters({ ...formFilters, supplyStatus: e.target.value })}
                  >
                    <MenuItem value=""><em>كافة الحالات</em></MenuItem>
                    <MenuItem value="not_supplied">معلق لم يتم التوريد</MenuItem>
                    <MenuItem value="supplied">تم التوريد للمقر الرئيسي</MenuItem>
                  </Select>
                </FormControl>
              )}

              {/* Payment Type filter */}
              {selectedMod.filters.includes('paymentType') && (
                <FormControl fullWidth>
                  <InputLabel id="export-pay-type-label">نوع الدفع</InputLabel>
                  <Select
                    labelId="export-pay-type-label"
                    value={formFilters.paymentType}
                    label="نوع الدفع"
                    onChange={(e) => setFormFilters({ ...formFilters, paymentType: e.target.value })}
                  >
                    <MenuItem value=""><em>كافة الأنواع</em></MenuItem>
                    <MenuItem value="cash">نقدي (كاش)</MenuItem>
                    <MenuItem value="deferred">آجل</MenuItem>
                  </Select>
                </FormControl>
              )}

              {/* Transaction type filter */}
              {selectedMod.filters.includes('transactionType') && (
                <FormControl fullWidth>
                  <InputLabel id="export-txn-type-label">نوع الحركة</InputLabel>
                  <Select
                    labelId="export-txn-type-label"
                    value={formFilters.transactionType}
                    label="نوع الحركة"
                    onChange={(e) => setFormFilters({ ...formFilters, transactionType: e.target.value })}
                  >
                    <MenuItem value=""><em>كافة الحركات</em></MenuItem>
                    <MenuItem value="receipt">توريد (وارد)</MenuItem>
                    <MenuItem value="dispatch">شحن/صرف (صادر)</MenuItem>
                    <MenuItem value="return">مرتجع مبيعات</MenuItem>
                    <MenuItem value="adjustment">تسوية مخزنية</MenuItem>
                  </Select>
                </FormControl>
              )}

              {/* Format selection */}
              <FormControl component="fieldset">
                <Typography variant="body2" sx={{ fontWeight: 'bold', mb: 1 }}>تنسيق الملف المستخرج</Typography>
                <RadioGroup 
                  row 
                  value={formFilters.format} 
                  onChange={(e) => setFormFilters({ ...formFilters, format: e.target.value })}
                >
                  <FormControlLabel value="xlsx" control={<Radio />} label="Excel (.xlsx) ملوّن ومهيأ" />
                  <FormControlLabel value="pdf" control={<Radio />} label="PDF (.pdf) تقرير طباعة منسّق" />
                  <FormControlLabel value="csv" control={<Radio />} label="CSV (.csv) عربي قياسي" />
                </RadioGroup>
              </FormControl>
            </Stack>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2.5 }}>
          <Button onClick={() => setOpenDialog(false)} color="inherit">إلغاء</Button>
          <Button 
            onClick={handleExportSubmit} 
            variant="contained" 
            color="primary" 
            disabled={loading}
            startIcon={<DownloadIcon />}
          >
            {loading ? 'جاري التحضير...' : 'تصدير وتنزيل'}
          </Button>
        </DialogActions>
      </Dialog>



      <Snackbar open={!!toastMsg} autoHideDuration={4000} onClose={() => setToastMsg('')} anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}>
        <Alert onClose={() => setToastMsg('')} severity={toastSeverity} sx={{ width: '100%' }}>{toastMsg}</Alert>
      </Snackbar>
    </Box>
  );
};

export default Exports;
