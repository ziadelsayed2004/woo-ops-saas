import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { formatCurrencyEGP, formatEgyptDate, formatEgyptDateTime } from '../utils/formatters';
import { compressImageAndConvertToBase64 } from '../utils/fileCompressor';
import { useAuth } from '../app/AuthContext';
import { apiClient } from '../services/apiClient';
import { t } from '../locales/t';
import LoadingState from '../components/LoadingState';
import EmptyState from '../components/EmptyState';
import EntityDrawer from '../components/EntityDrawer';
import ConfirmDialog from '../components/ConfirmDialog';
import InvoiceDetailsDrawer from '../components/invoices/InvoiceDetailsDrawer';
import InvoiceWizardDrawer from '../components/invoices/InvoiceWizardDrawer';
import InvoiceReturnDrawer from '../components/invoices/InvoiceReturnDrawer';
import { FormSection } from '../components/forms/FormSection';
import { FieldGrid } from '../components/forms/FieldGrid';
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
  Checkbox,
  Divider,
  Tab,
  Tabs,
  Card,
  CardContent,
  Collapse,
  Autocomplete,
  Drawer
} from '@mui/material';
import {
  Edit as EditIcon,
  Add as AddIcon,
  Search as SearchIcon,
  Visibility as VisibilityIcon,
  CloudDownload as DownloadIcon,
  FilterList as FilterIcon,
  Clear as ClearIcon,
  Delete as DeleteIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  Payments as PaymentsIcon,
  EventNote as EventNoteIcon,
  LocalShipping as LocalShippingIcon,
  SettingsBackupRestore as SettingsBackupRestoreIcon,
  CheckCircle as CheckCircleIcon,
  Receipt as ReceiptIcon,
  Print as PrintIcon,
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
  Archive as ArchiveIcon,
  Unarchive as UnarchiveIcon,
  Undo as UndoIcon,
  RestoreFromTrash as RestoreFromTrashIcon,
  DeleteForever as DeleteForeverIcon
} from '@mui/icons-material';
import '../styles/Invoices.css';

export const Invoices = () => {
  const { user, hasPermission } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const userRoles = Array.isArray(user?.roles) ? user.roles : [];
  const isSuperAdmin = userRoles.includes('super_admin');
  const isInvoiceVisibilityRestricted = userRoles.some((role) =>
    ['shipping_user', 'inventory_manager'].includes(role)
  ) && !userRoles.some((role) => ['super_admin', 'assistant', 'readonly_viewer'].includes(role));
  const canViewInvoicePricing = !userRoles.includes('shipping_user') ||
    userRoles.some(role => ['super_admin', 'assistant', 'readonly_viewer'].includes(role));
  const canRecordInvoicePayments =
    hasPermission('invoices.pay') && hasPermission('payments.create');
  const getInitialDetailsTab = () => {
    if (hasPermission('payments.view')) return 0;
    if (hasPermission('shipments.view')) return 1;
    if (hasPermission('returns.view')) return 2;
    return 3;
  };

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

  // Primary Data States
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);

  // Metadata/Filter list options
  const [outlets, setOutlets] = useState([]);
  const [outletTypes, setOutletTypes] = useState([]);
  const [productsList, setProductsList] = useState([]);
  const [authorsList, setAuthorsList] = useState([]);
  const [categoriesList, setCategoriesList] = useState([]);
  const [paymentMethods, setPaymentMethods] = useState([]);

  // Pagination State
  const [limit, setLimit] = useState(25);
  const [offset, setOffset] = useState(0);

  // Filter States
  const [showFilters, setShowFilters] = useState(false);
  const [filterSearch, setFilterSearch] = useState(new URLSearchParams(window.location.search).get('search') || '');
  const [filterOutletId, setFilterOutletId] = useState('');
  const [filterOutletTypeId, setFilterOutletTypeId] = useState('');
  const [filterProductId, setFilterProductId] = useState('');
  const [filterAuthorId, setFilterAuthorId] = useState('');
  const [filterGovernorate, setFilterGovernorate] = useState('');
  const [filterPaymentStatus, setFilterPaymentStatus] = useState('');
  const [filterShippingStatus, setFilterShippingStatus] = useState('');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');
  const [filterHasRemaining, setFilterHasRemaining] = useState('');
  const [filterMinRemaining, setFilterMinRemaining] = useState('');
  const [filterMaxRemaining, setFilterMaxRemaining] = useState('');

  // Selection state for batch actions
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState([]);
  const [openBulkShippingModal, setOpenBulkShippingModal] = useState(false);
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [invoiceListMode, setInvoiceListMode] = useState('active');
  const [bulkActionDialog, setBulkActionDialog] = useState(null);
  const [bulkActionConfirmation, setBulkActionConfirmation] = useState('');

  // Toast Notification State
  const [toastMsg, setToastMsg] = useState('');
  const [toastSeverity, setToastSeverity] = useState('success');

  // Details Modal Controller
  const [openDetailsModal, setOpenDetailsModal] = useState(false);
  const [detailsInvoice, setDetailsInvoice] = useState(null);
  const [detailsTabValue, setDetailsTabValue] = useState(0);

  // Supply payment confirmation states
  const [supplyConfirmOpen, setSupplyConfirmOpen] = useState(false);
  const [paymentIdToSupply, setPaymentIdToSupply] = useState(null);

  // Form state loading
  const [scheduleLoading, setScheduleLoading] = useState(false);

  // Create/Edit Wizard Modal Controller
  const [openFormModal, setOpenFormModal] = useState(false);
  const [formMode, setFormMode] = useState('create'); // 'create' or 'edit'
  const [selectedFormInvoice, setSelectedFormInvoice] = useState(null);

  // Wizard Form Fields
  const [formOutletId, setFormOutletId] = useState('');
  const [formOutletTypeLabel, setFormOutletTypeLabel] = useState('');
  const [formDiscount, setFormDiscount] = useState(0);
  const [formShippingCost, setFormShippingCost] = useState(0);
  const [formPaymentType, setFormPaymentType] = useState('cash');
  const [formPaymentMethod, setFormPaymentMethod] = useState('cash');
  const [formNotes, setFormNotes] = useState('');
  const [formItems, setFormItems] = useState([]); // [{ productId, productTitle, productCode, quantity, price, stock, stockPolicy, error }]
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [formCollectionType, setFormCollectionType] = useState('none'); // 'none', 'partial', 'full'
  const [formCollectedAmount, setFormCollectedAmount] = useState(0);
  const [formSupplyStatus, setFormSupplyStatus] = useState('not_supplied'); // 'not_supplied', 'supplied'
  const [formCollectionNotes, setFormCollectionNotes] = useState('');
  const [formReceiptName, setFormReceiptName] = useState('');
  const [formReceiptData, setFormReceiptData] = useState('');
  const [formInvoiceNumber, setFormInvoiceNumber] = useState('');
  const [outletBalances, setOutletBalances] = useState([]);

  const [openReturnDrawer, setOpenReturnDrawer] = useState(false);
  const [returnInvoice, setReturnInvoice] = useState(null);
  const [returnQuantities, setReturnQuantities] = useState({});
  const [returnReason, setReturnReason] = useState('');
  const [returnSubmitting, setReturnSubmitting] = useState(false);

  // Toast trigger
  const showToast = (msg, severity = 'success') => {
    setToastMsg(msg);
    setToastSeverity(severity);
  };

  // Fetch only metadata the current account is allowed to read. Keeping each
  // request independent prevents a single 403 from breaking the invoice list.
  const fetchMetadata = async () => {
    const safeLoad = async (permission, endpoint, setter, fallback = []) => {
      if (!hasPermission(permission)) {
        setter(fallback);
        return fallback;
      }
      try {
        const data = await apiClient.get(endpoint);
        setter(data || fallback);
        return data || fallback;
      } catch (err) {
        console.error(`Error fetching ${endpoint}:`, err);
        setter(fallback);
        return fallback;
      }
    };

    const tasks = [
      safeLoad('outlets.view', '/outlets?limit=500&status=active', setOutlets),
      safeLoad('outlet_types.view', '/outlet-types?limit=100&includeDisabled=false', setOutletTypes),
      safeLoad('authors.view', '/authors?limit=500&status=active', setAuthorsList),
      safeLoad('products.view', '/products/categories', setCategoriesList),
      safeLoad('finance.view', '/finance/outlets', setOutletBalances)
    ];

    const productsTask = safeLoad(
      'products.view',
      '/products?limit=500&status=active',
      () => {}
    );
    const stockTask = safeLoad(
      'inventory.view',
      '/inventory/stock-summary?limit=500',
      () => {}
    );
    const [productsData, stockData] = await Promise.all([productsTask, stockTask]);
    const stockByProductId = new Map(stockData.map((item) => [item.id, item.stock]));
    setProductsList(productsData.map((product) => ({
      ...product,
      stock: stockByProductId.get(product.id) || 0
    })));
    await Promise.all(tasks);
  };

  // Main fetch invoices list function
  const fetchInvoices = async () => {
    setLoading(true);
    try {
      if (invoiceListMode === 'trash') {
        let trashQuery = `/invoices/trash?limit=${limit}&offset=${offset}`;
        if (filterSearch) trashQuery += `&search=${encodeURIComponent(filterSearch)}`;
        const trashData = await apiClient.get(trashQuery);
        setInvoices(trashData.items || []);
        setTotalCount(trashData.total || 0);
        return;
      }

      let query = `/invoices?limit=${limit}&offset=${offset}&archived=${invoiceListMode === 'archived'}`;

      if (filterSearch) query += `&search=${encodeURIComponent(filterSearch)}`;
      if (filterOutletId) query += `&outletId=${filterOutletId}`;
      if (filterOutletTypeId) query += `&outletTypeId=${filterOutletTypeId}`;
      if (filterProductId) query += `&productId=${filterProductId}`;
      if (filterAuthorId) query += `&authorId=${filterAuthorId}`;
      if (filterGovernorate) query += `&governorate=${encodeURIComponent(filterGovernorate)}`;
      if (hasPermission('payments.view') && filterPaymentStatus) query += `&paymentStatus=${filterPaymentStatus}`;
      if (filterShippingStatus) query += `&shippingStatus=${filterShippingStatus}`;
      if (filterStartDate) query += `&startDate=${filterStartDate}`;
      if (filterEndDate) query += `&endDate=${filterEndDate}`;
      if (hasPermission('payments.view') && filterHasRemaining) query += `&hasRemaining=${filterHasRemaining}`;
      if (hasPermission('payments.view') && filterMinRemaining) query += `&minRemaining=${filterMinRemaining}`;
      if (hasPermission('payments.view') && filterMaxRemaining) query += `&maxRemaining=${filterMaxRemaining}`;

      const data = await apiClient.get(query);
      setInvoices(data);
      // Since backend doesn't return count directly, calculate totalCount dynamically
      // if rows length matches limit, there could be more. Otherwise offset + data.length
      setTotalCount(data.length < limit ? offset + data.length : offset + data.length + limit);

      // Auto-open details if search code matches exactly
      const searchParam = new URLSearchParams(window.location.search).get('search');
      if (searchParam && data && data.length > 0) {
        const exactMatch = data.find(inv => inv.invoice_number === searchParam.trim());
        if (exactMatch) {
          handleOpenDetails(exactMatch);
        }
      }
    } catch (err) {
      console.error(err);
      showToast(err.message || 'فشل تحميل الفواتير.', 'error');
    } finally {
      setLoading(false);
    }
  };

  // Run on mount
  useEffect(() => {
    fetchMetadata();
    apiClient.get('/payments/methods').then(data => {
      const methods = data || [];
      setPaymentMethods(methods);
      setFormPaymentMethod(current => methods.some(method => method.key === current) ? current : (methods[0]?.key || ''));
    }).catch(() => setPaymentMethods([]));
  }, []);

  // Run on filter/pagination changes
  useEffect(() => {
    fetchInvoices();
  }, [limit, offset, invoiceListMode]);

  // Handle pagination navigation
  const handlePrevPage = () => {
    if (offset >= limit) {
      setOffset(offset - limit);
    }
  };

  const handleNextPage = () => {
    setOffset(offset + limit);
  };

  // Reset all advanced filter values
  const handleResetFilters = () => {
    setFilterSearch('');
    setFilterOutletId('');
    setFilterOutletTypeId('');
    setFilterProductId('');
    setFilterAuthorId('');
    setFilterGovernorate('');
    setFilterPaymentStatus('');
    setFilterShippingStatus('');
    setFilterStartDate('');
    setFilterEndDate('');
    setFilterHasRemaining('');
    setFilterMinRemaining('');
    setFilterMaxRemaining('');
    setOffset(0);
    showToast('تمت إعادة تعيين الفلاتر.');
    setTimeout(() => fetchInvoices(), 50);
  };

  const handleApplyFilters = () => {
    if (offset === 0) fetchInvoices();
    else setOffset(0);
  };

  // Handle single and multi-selection of rows
  const isInvoiceShippable = (invoice) =>
    invoice.payment_status !== 'cancelled' &&
    ['pending', 'partially_shipped'].includes(invoice.shipping_status);

  const handleSelectAll = (e) => {
    if (e.target.checked) {
      setSelectedInvoiceIds(invoices.map((inv) => inv.id));
    } else {
      setSelectedInvoiceIds([]);
    }
  };

  const selectedInvoices = invoices.filter(invoice => selectedInvoiceIds.includes(invoice.id));
  const canShipSelection = selectedInvoices.length > 0 && selectedInvoices.every(isInvoiceShippable);
  const canUndoSelection = selectedInvoices.length > 0 && selectedInvoices.every(invoice =>
    invoice.payment_status !== 'cancelled' && ['partially_shipped', 'shipped'].includes(invoice.shipping_status)
  );

  const openInvoiceAction = (action, invoiceIds = selectedInvoiceIds) => {
    setSelectedInvoiceIds(invoiceIds);
    setBulkActionConfirmation('');
    setBulkActionDialog(action);
  };

  const closeInvoiceAction = () => {
    if (bulkSubmitting) return;
    setBulkActionDialog(null);
    setBulkActionConfirmation('');
  };

  const executeBulkInvoiceAction = async () => {
    if (!bulkActionDialog || selectedInvoiceIds.length === 0) return;
    const endpoints = {
      undo: '/invoices/bulk/undo-latest-shipment',
      archive: '/invoices/bulk/archive',
      restore: '/invoices/bulk/restore',
      trash: '/invoices/bulk/trash',
      trashRestore: '/invoices/bulk/restore-from-trash',
      permanentDelete: '/invoices/trash/permanent-delete'
    };
    if (bulkActionDialog === 'trash' && bulkActionConfirmation !== 'حذف') return;
    if (bulkActionDialog === 'permanentDelete' && bulkActionConfirmation !== 'حذف نهائي') return;
    setBulkSubmitting(true);
    try {
      if (bulkActionDialog === 'permanentDelete') {
        await apiClient.post(endpoints[bulkActionDialog], {
          invoiceIds: selectedInvoiceIds,
          confirmation: bulkActionConfirmation
        });
      } else {
        await apiClient.put(endpoints[bulkActionDialog], { invoiceIds: selectedInvoiceIds });
      }
      const messages = {
        undo: 'تم التراجع عن أحدث شحنة للفواتير المحددة.',
        archive: 'تمت أرشفة الفواتير المحددة.',
        restore: 'تم استرجاع الفواتير المحددة من الأرشيف.',
        trash: 'تم نقل الفواتير المحددة إلى سلة المحذوفات وإزالة أثرها من الحسابات.',
        trashRestore: 'تم استرجاع الفواتير المحددة من سلة المحذوفات.',
        permanentDelete: 'تم حذف الفواتير المحددة نهائيًا.'
      };
      showToast(messages[bulkActionDialog]);
      setSelectedInvoiceIds([]);
      setBulkActionDialog(null);
      setBulkActionConfirmation('');
      fetchInvoices();
    } catch (error) {
      showToast(error.message || 'تعذر تنفيذ العملية الجماعية.', 'error');
    } finally {
      setBulkSubmitting(false);
    }
  };

  const handleSelectInvoice = (id) => {
    if (selectedInvoiceIds.includes(id)) {
      setSelectedInvoiceIds(selectedInvoiceIds.filter((x) => x !== id));
    } else {
      setSelectedInvoiceIds([...selectedInvoiceIds, id]);
    }
  };

  // Bulk update shipping status for selected invoices
  const handleBulkShippingUpdate = async () => {
    if (selectedInvoiceIds.length === 0) return;
    if (!hasPermission('invoices.ship')) {
      showToast('ليس لديك صلاحية للتعديل المباشر على حالة شحن الفواتير.', 'error');
      return;
    }
    setBulkSubmitting(true);
    try {
      await apiClient.put('/invoices/bulk/shipping-status', {
        invoiceIds: selectedInvoiceIds,
        shippingStatus: 'shipped'
      });
      showToast(`تم شحن كل الكميات المتبقية بنجاح لـ ${selectedInvoiceIds.length} فاتورة.`);
      setSelectedInvoiceIds([]);
      setOpenBulkShippingModal(false);
      fetchInvoices();
    } catch (err) {
      console.error(err);
      showToast(err.message || 'فشل تحديث حالة الشحن للمجموعة.', 'error');
    } finally {
      setBulkSubmitting(false);
    }
  };

  // Batch Export PDF method
  const handleBatchPdfExport = async () => {
    if (selectedInvoiceIds.length === 0) return;
    try {
      showToast('جاري إنشاء ملف الـ PDF...');
      const response = await apiClient.post('/invoices/export/pdf', {
        invoiceIds: selectedInvoiceIds
      }, {
        headers: { 'Accept': 'application/pdf' }
      });

      // apiClient returns body, if it's already structured as text/data or blob, handle it
      // Since custom apiClient converts JSON or text, let's invoke a direct window download trigger for safety
      // Or we can construct standard fetch to get the binary stream properly.
      const rawResponse = await fetch('/api/invoices/export/pdf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/pdf'
        },
        body: JSON.stringify({ invoiceIds: selectedInvoiceIds })
      });
      
      if (!rawResponse.ok) throw new Error('فشل تصدير ملف الـ PDF');
      const blob = await rawResponse.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.setAttribute('download', `تقرير_الفواتير_${Date.now()}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      showToast('تم تحميل التقرير بنجاح.');
    } catch (err) {
      console.error(err);
      showToast('حدث خطأ أثناء تصدير ملف الـ PDF.', 'error');
    }
  };

  // Single PDF Export
  const handleSinglePdfExport = async (invoiceId) => {
    try {
      showToast('جاري تحميل الفاتورة...');
      const rawResponse = await fetch('/api/invoices/export/pdf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/pdf'
        },
        body: JSON.stringify({ invoiceIds: [invoiceId] })
      });
      
      if (!rawResponse.ok) throw new Error('فشل تصدير الفاتورة');
      const blob = await rawResponse.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.setAttribute('download', `فاتورة_${invoiceId}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      showToast('تم تحميل الفاتورة بنجاح.');
    } catch (err) {
      console.error(err);
      showToast('فشل تحميل ملف الـ PDF للفاتورة.', 'error');
    }
  };

  // Single PDF Print (Open in new window to print)
  const handleSinglePdfPrint = async (invoiceId) => {
    try {
      showToast('جاري تحضير ملف الـ PDF للطباعة...', 'info');
      const rawResponse = await fetch('/api/invoices/export/pdf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/pdf'
        },
        body: JSON.stringify({ invoiceIds: [invoiceId] })
      });
      
      if (!rawResponse.ok) throw new Error('فشل تصدير الفاتورة للطباعة');
      const blob = await rawResponse.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const printWindow = window.open(blobUrl, '_blank');
      if (!printWindow) {
        showToast('يرجى السماح بالنوافذ المنبثقة لطباعة الفاتورة.', 'warning');
      }
    } catch (err) {
      console.error(err);
      showToast('فشل فتح ملف الـ PDF للطباعة.', 'error');
    }
  };

  // Batch PDF Print (Open in new window to print)
  const handleBatchPdfPrint = async () => {
    if (selectedInvoiceIds.length === 0) return;
    try {
      showToast('جاري تحضير ملف الـ PDF للطباعة...', 'info');
      const rawResponse = await fetch('/api/invoices/export/pdf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/pdf'
        },
        body: JSON.stringify({ invoiceIds: selectedInvoiceIds })
      });
      
      if (!rawResponse.ok) throw new Error('فشل تصدير التقرير للطباعة');
      const blob = await rawResponse.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const printWindow = window.open(blobUrl, '_blank');
      if (!printWindow) {
        showToast('يرجى السماح بالنوافذ المنبثقة للطباعة.', 'warning');
      }
    } catch (err) {
      console.error(err);
      showToast('حدث خطأ أثناء فتح ملف الـ PDF للطباعة.', 'error');
    }
  };

  const handlePrintInvoice = (inv) => {
    if (!inv) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      showToast('يرجى السماح بالنوافذ المنبثقة لطباعة الفاتورة.', 'warning');
      return;
    }

    const itemsHtml = inv.items?.map((item, idx) => {
      const billableQty = Math.max(0, item.quantity - (item.free_quantity || 0));
      return `
        <tr>
          <td style="border: 1px solid #cbd5e1; padding: 10px; text-align: center;">${idx + 1}</td>
          <td style="border: 1px solid #cbd5e1; padding: 10px; font-weight: 500;">${item.product_title}</td>
          <td style="border: 1px solid #cbd5e1; padding: 10px; text-align: center; font-family: monospace;">${item.product_code || '-'}</td>
          <td style="border: 1px solid #cbd5e1; padding: 10px; text-align: center; font-weight: bold;">${item.quantity}</td>
          <td style="border: 1px solid #cbd5e1; padding: 10px; text-align: center; color: #16a34a; font-weight: 500;">${item.free_quantity || 0}</td>
          <td style="border: 1px solid #cbd5e1; padding: 10px; text-align: center;">${billableQty}</td>
          <td style="border: 1px solid #cbd5e1; padding: 10px; text-align: left; font-family: monospace;">${formatCurrencyEGP(item.unit_price)}</td>
          <td style="border: 1px solid #cbd5e1; padding: 10px; text-align: left; font-family: monospace; font-weight: bold;">${formatCurrencyEGP(item.total_price)}</td>
        </tr>
      `;
    }).join('');

    const formattedDate = formatEgyptDateTime(inv.created_at);

    printWindow.document.write(`
      <html dir="rtl" lang="ar">
      <head>
        <title>فاتورة مبيعات - ${inv.invoice_number}</title>
        <style>
          @page { size: A4; margin: 15mm; }
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 10px; color: #1e293b; background-color: #fff; line-height: 1.5; font-size: 14px; }
          .header-container { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #0f172a; padding-bottom: 15px; margin-bottom: 25px; }
          .logo-area { text-align: right; }
          .logo-area h1 { margin: 0; font-size: 24px; color: #1e3a8a; font-weight: 800; letter-spacing: -0.5px; }
          .logo-area p { margin: 4px 0 0 0; font-size: 12px; color: #64748b; }
          .title-area { text-align: left; }
          .title-area h2 { margin: 0; font-size: 20px; color: #0f172a; font-weight: 700; }
          .title-area p { margin: 4px 0 0 0; font-size: 13px; font-family: monospace; font-weight: bold; color: #1e3a8a; }
          
          .info-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; margin-bottom: 25px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 15px; }
          .info-block h4 { margin: 0 0 8px 0; font-size: 13px; color: #64748b; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; }
          .info-block p { margin: 4px 0; font-size: 14px; }
          .info-block p strong { color: #0f172a; }

          .items-table { width: 100%; border-collapse: collapse; margin-top: 15px; margin-bottom: 25px; }
          .items-table th { background-color: #f1f5f9; border: 1px solid #cbd5e1; padding: 10px; font-weight: 700; color: #334155; font-size: 13px; }
          
          .summary-container { display: flex; justify-content: space-between; align-items: flex-start; gap: 40px; margin-top: 15px; page-break-inside: avoid; }
          .notes-box { flex: 1; border: 1px dashed #cbd5e1; padding: 12px; border-radius: 6px; background-color: #fafafa; }
          .notes-box h5 { margin: 0 0 6px 0; font-size: 13px; color: #475569; }
          .notes-box p { margin: 0; font-size: 12px; color: #64748b; }
          
          .totals-table { width: 280px; border-collapse: collapse; }
          .totals-table td { padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 13px; }
          .totals-table tr.grand-total td { font-weight: bold; font-size: 15px; border-bottom: 2px solid #0f172a; color: #1e3a8a; background-color: #f8fafc; }
          
          .signature-section { display: flex; justify-content: space-between; margin-top: 60px; padding: 0 20px; page-break-inside: avoid; }
          .signature-box { text-align: center; width: 200px; }
          .signature-box p { margin: 0; font-size: 13px; color: #475569; }
          .signature-line { border-top: 1px dashed #94a3b8; margin-top: 40px; }

          .footer { margin-top: 65px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 10px; page-break-inside: avoid; }
          
          .qr-wrapper { display: flex; flex-direction: column; align-items: center; justify-content: center; }
          .qr-wrapper img { width: 75px; height: 75px; margin-bottom: 4px; }
          .qr-wrapper span { font-size: 9px; color: #64748b; }
        </style>
      </head>
      <body>
        <div class="header-container">
          <div class="logo-area">
            <h1>مطبعة حمزة</h1>
            <p>للطباعة والنشر والتوزيع - إدارة المبيعات</p>
          </div>
          <div class="title-area">
            <h2>فاتورة مبيعات</h2>
            <p>رقم: ${inv.invoice_number}</p>
          </div>
        </div>

        <div class="info-grid">
          <div class="info-block">
            <h4>بيانات العميل / منفذ البيع</h4>
            <p><strong>الاسم:</strong> ${inv.outlet_name}</p>
            <p><strong>المحافظة:</strong> ${inv.governorate || '-'}</p>
            <p><strong>نوع الدفع المعتمد:</strong> ${
              inv.payment_status === 'paid' ? 'دفع كلي' :
              inv.payment_status === 'partially_paid' ? 'دفع جزئي' :
              inv.payment_type === 'cash' ? 'نقدي' :
              inv.payment_type === 'deferred' ? 'آجل' : inv.payment_type
            }</p>
          </div>
          <div class="info-block">
            <h4>تفاصيل الفاتورة</h4>
            <p><strong>تاريخ الإصدار:</strong> ${formattedDate}</p>
            <p><strong>حالة الدفع:</strong> ${
              inv.payment_status === 'paid' ? '<span style="color:#16a34a; font-weight:bold;">مسددة</span>' :
              inv.payment_status === 'partially_paid' ? '<span style="color:#ca8a04; font-weight:bold;">مسددة جزئياً</span>' :
              '<span style="color:#dc2626; font-weight:bold;">غير مسددة</span>'
            }</p>
            <p><strong>حالة الشحن:</strong> ${
              inv.shipping_status === 'shipped' ? '<span style="color:#16a34a; font-weight:bold;">تم الشحن</span>' :
              inv.shipping_status === 'partially_shipped' ? '<span style="color:#ca8a04; font-weight:bold;">شحن جزئي</span>' :
              '<span style="color:#94a3b8;">قيد الانتظار</span>'
            }</p>
          </div>
        </div>

        <table class="items-table" style="width: 100%; border-collapse: collapse; margin-top: 15px; margin-bottom: 25px;">
          <thead>
            <tr>
              <th style="background-color: #f1f5f9; border: 1px solid #cbd5e1; padding: 10px; font-weight: 700; color: #334155; font-size: 13px;">#</th>
              <th style="background-color: #f1f5f9; border: 1px solid #cbd5e1; padding: 10px; font-weight: 700; color: #334155; font-size: 13px; text-align: right;">الكتاب / الصنف</th>
              <th style="background-color: #f1f5f9; border: 1px solid #cbd5e1; padding: 10px; font-weight: 700; color: #334155; font-size: 13px;">الرمز (SKU)</th>
              <th style="background-color: #f1f5f9; border: 1px solid #cbd5e1; padding: 10px; font-weight: 700; color: #334155; font-size: 13px;">الكمية الإجمالية</th>
              <th style="background-color: #f1f5f9; border: 1px solid #cbd5e1; padding: 10px; font-weight: 700; color: #334155; font-size: 13px;">المجاني</th>
              <th style="background-color: #f1f5f9; border: 1px solid #cbd5e1; padding: 10px; font-weight: 700; color: #334155; font-size: 13px;">المدفوع</th>
              <th style="background-color: #f1f5f9; border: 1px solid #cbd5e1; padding: 10px; font-weight: 700; color: #334155; font-size: 13px; text-align: left;">سعر الوحدة</th>
              <th style="background-color: #f1f5f9; border: 1px solid #cbd5e1; padding: 10px; font-weight: 700; color: #334155; font-size: 13px; text-align: left;">الإجمالي</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHtml}
          </tbody>
        </table>

        <div class="summary-container">
          <div class="notes-box">
            <h5>ملاحظات وشروط:</h5>
            <p>${inv.notes || 'لا يوجد ملاحظات إضافية.'}</p>
            <div style="margin-top: 15px; display: flex; gap: 20px; align-items: center;">
              <div class="qr-wrapper">
                <img src="https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(window.location.origin + '/invoices?search=' + inv.invoice_number)}" alt="Invoice QR" />
                <span>امسح للتحقق</span>
              </div>
            </div>
          </div>
          
          <table class="totals-table">
            <tr>
              <td>المجموع الفرعي:</td>
              <td style="text-align: left; font-family: monospace;">${formatCurrencyEGP(inv.subtotal || 0)}</td>
            </tr>
            <tr>
              <td style="color:#16a34a;">+ تكلفة الشحن:</td>
              <td style="text-align: left; font-family: monospace; color:#16a34a;">${formatCurrencyEGP(inv.shipping_cost || 0)}</td>
            </tr>
            <tr>
              <td style="color:#dc2626;">- الخصم المباشر:</td>
              <td style="text-align: left; font-family: monospace; color:#dc2626;">${formatCurrencyEGP(inv.discount || 0)}</td>
            </tr>
            <tr class="grand-total">
              <td>الإجمالي قبل المرتجعات:</td>
              <td style="text-align: left; font-family: monospace;">${formatCurrencyEGP(inv.total_price)}</td>
            </tr>
            <tr>
              <td style="color:#dc2626;">- إجمالي المرتجعات:</td>
              <td style="text-align: left; font-family: monospace; color:#dc2626;">${formatCurrencyEGP(inv.returned_amount || 0)}</td>
            </tr>
            <tr class="grand-total">
              <td>الإجمالي بعد المرتجعات:</td>
              <td style="text-align: left; font-family: monospace;">${formatCurrencyEGP(inv.net_amount ?? inv.total_price)}</td>
            </tr>
            <tr>
              <td style="color:#16a34a; font-weight:500;">المبلغ المسدد:</td>
              <td style="text-align: left; font-family: monospace; color:#16a34a; font-weight:500;">${formatCurrencyEGP(inv.paid_amount || 0)}</td>
            </tr>
            <tr style="border-top:1px solid #cbd5e1;">
              <td style="color:#dc2626; font-weight:bold;">المبلغ المتبقي (الذمة المالية):</td>
              <td style="text-align: left; font-family: monospace; color:#dc2626; font-weight:bold;">${formatCurrencyEGP(inv.remaining_amount || 0)}</td>
            </tr>
          </table>
        </div>

        <div class="signature-section">
          <div class="signature-box">
            <p>توقيع أمين المخزن المستلم</p>
            <div class="signature-line"></div>
          </div>
          <div class="signature-box">
            <p>توقيع العميل / المستلم</p>
            <div class="signature-line"></div>
          </div>
          <div class="signature-box">
            <p>الختم والاعتماد المالي</p>
            <div class="signature-line"></div>
          </div>
        </div>

        <div class="footer">
          مطبعة حمزة للنشر والتوزيع - نظام إدارة المستودعات والمبيعات الإلكتروني
        </div>
        <script>
          window.onload = function() { window.print(); window.close(); }
        </script>
      </body>
      </html>
    `);
    printWindow.document.close();
  };

  const handleFetchAndPrintInvoice = async (id) => {
    try {
      showToast('جاري تحميل تفاصيل الفاتورة للطباعة...', 'info');
      const data = await apiClient.get(`/invoices/${id}`);
      handlePrintInvoice(data);
    } catch (err) {
      console.error(err);
      showToast(err.message || 'فشل تحميل بيانات الفاتورة للطباعة.', 'error');
    }
  };

  // Open Details Modal and fetch full details
  const handleOpenDetails = async (invoice) => {
    setDetailsTabValue(getInitialDetailsTab());
    try {
      const data = await apiClient.get(`/invoices/${invoice.id}`);
      setDetailsInvoice(data);
      setOpenDetailsModal(true);
    } catch (err) {
      console.error(err);
      showToast('فشل تحميل تفاصيل الفاتورة.', 'error');
    }
  };

  // Navigate between invoices in details drawer
  const handleNavigateInvoice = async (direction) => {
    if (!detailsInvoice || !invoices || invoices.length === 0) return;
    const currentIndex = invoices.findIndex(inv => inv.id === detailsInvoice.id);
    if (currentIndex === -1) return;

    let targetIndex = currentIndex;
    if (direction === 'next') {
      targetIndex = currentIndex + 1;
    } else if (direction === 'prev') {
      targetIndex = currentIndex - 1;
    }

    if (targetIndex >= 0 && targetIndex < invoices.length) {
      setDetailsTabValue(getInitialDetailsTab());
      try {
        const targetInvoice = invoices[targetIndex];
        const data = await apiClient.get(`/invoices/${targetInvoice.id}`);
        setDetailsInvoice(data);
      } catch (err) {
        console.error(err);
        showToast('فشل تحميل الفاتورة.', 'error');
      }
    }
  };

  // Operational drawer handoffs and validations
  const handlePayHandoff = (invoice) => {
    if (!hasPermission('payments.create')) {
      showToast('ليس لديك صلاحية لتسجيل المدفوعات.', 'error');
      return;
    }
    if (invoice.remaining_amount <= 0) {
      showToast('هذه الفاتورة مدفوعة بالكامل بالفعل.', 'warning');
      return;
    }
    if (invoice.payment_status === 'cancelled') {
      showToast('لا يمكن الدفع لفاتورة ملغاة.', 'warning');
      return;
    }
    navigate(`/payments?outletId=${invoice.outlet_id}&invoiceId=${invoice.id}&action=create`);
  };

  const handleMarkPaidHandoff = (invoice) => {
    if (!hasPermission('payments.create')) {
      showToast('ليس لديك صلاحية لتسجيل المدفوعات.', 'error');
      return;
    }
    if (invoice.remaining_amount <= 0) {
      showToast('هذه الفاتورة مدفوعة بالكامل بالفعل.', 'warning');
      return;
    }
    if (invoice.payment_status === 'cancelled') {
      showToast('لا يمكن الدفع لفاتورة ملغاة.', 'warning');
      return;
    }
    navigate(`/payments?outletId=${invoice.outlet_id}&invoiceId=${invoice.id}&action=create&amount=${invoice.remaining_amount}&mode=full`);
  };

  const handleShipHandoff = (invoice) => {
    if (!hasPermission('shipments.create')) {
      showToast('ليس لديك صلاحية لتسجيل الشحنات.', 'error');
      return;
    }
    if (invoice.payment_status === 'cancelled') {
      showToast('لا يمكن تسجيل شحنة لفاتورة ملغاة.', 'warning');
      return;
    }
    navigate(`/shipments?invoiceId=${invoice.id}&action=create`);
  };

  const handleReturnClick = async (invoice) => {
    if (!hasPermission('returns.create')) {
      showToast('ليس لديك صلاحية لتسجيل المرتجعات.', 'error');
      return;
    }
    if (invoice.payment_status === 'cancelled') {
      showToast('لا يمكن عمل مرتجع لفاتورة ملغاة.', 'warning');
      return;
    }
    if (invoice.shipping_status !== 'shipped') {
      showToast('لا يمكن عمل مرتجع إلا بعد شحن الفاتورة بالكامل.', 'warning');
      return;
    }
    try {
      const fullInvoice = await apiClient.get(`/invoices/${invoice.id}`);
      const hasReturnable = fullInvoice.items?.some(item => (item.remaining_returnable_quantity || 0) > 0);
      if (!hasReturnable) {
        showToast('لا توجد كتب قابلة للإرجاع في هذه الفاتورة (تم إرجاع كافة الكميات بالفعل).', 'warning');
        return;
      }
      setReturnInvoice(fullInvoice);
      const initialQtys = {};
      fullInvoice.items?.forEach(item => {
        initialQtys[item.id] = 0;
      });
      setReturnQuantities(initialQtys);
      setReturnReason('');
      setOpenReturnDrawer(true);
    } catch (err) {
      console.error(err);
      showToast('فشل تحميل تفاصيل الفاتورة لإنشاء المرتجع.', 'error');
    }
  };

  const handleOpenReturnDrawer = async (invoice) => {
    try {
      const fullInvoice = await apiClient.get(`/invoices/${invoice.id}`);
      setReturnInvoice(fullInvoice);
      // Initialize return quantities with 0 for all items
      const initialQtys = {};
      fullInvoice.items?.forEach(item => {
        initialQtys[item.id] = 0;
      });
      setReturnQuantities(initialQtys);
      setReturnReason('');
      setOpenReturnDrawer(true);
    } catch (err) {
      console.error(err);
      showToast('فشل تحميل تفاصيل الفاتورة لإنشاء المرتجع.', 'error');
    }
  };

  const handleReturnQtyChange = (itemId, val) => {
    const qty = parseInt(val, 10) || 0;
    setReturnQuantities(prev => ({
      ...prev,
      [itemId]: qty
    }));
  };

  const handleSubmitReturn = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!returnInvoice) return;

    const itemsToReturn = [];
    let hasExceeded = false;
    let exceedsMessage = '';

    for (const item of returnInvoice.items) {
      const qty = returnQuantities[item.id] || 0;
      if (qty > 0) {
        if (qty > item.remaining_returnable_quantity) {
          hasExceeded = true;
          exceedsMessage = `الكمية المدخلة للكتاب "${item.product_title}" (${qty}) تتجاوز الكمية المتاحة للإرجاع وهي ${item.remaining_returnable_quantity}.`;
          break;
        }
        itemsToReturn.push({
          invoiceItemId: item.id,
          quantity: qty
        });
      }
    }

    if (hasExceeded) {
      showToast(exceedsMessage, 'error');
      return;
    }

    if (itemsToReturn.length === 0) {
      showToast('يرجى تحديد كمية إرجاع واحدة على الأقل أكبر من الصفر.', 'warning');
      return;
    }

    setReturnSubmitting(true);
    try {
      await apiClient.post('/returns', {
        invoiceId: returnInvoice.id,
        reason: returnReason,
        items: itemsToReturn
      });
      showToast('تم تسجيل مرتجع المبيعات بنجاح وتحديث المخزون والماليات.');
      setOpenReturnDrawer(false);
      fetchInvoices();
    } catch (err) {
      console.error(err);
      showToast(err.message || 'فشل تسجيل مرتجع المبيعات.', 'error');
    } finally {
      setReturnSubmitting(false);
    }
  };

  const handleMarkPaymentSupplied = (paymentId) => {
    setPaymentIdToSupply(paymentId);
    setSupplyConfirmOpen(true);
  };

  const executeMarkPaymentSupplied = async () => {
    if (!paymentIdToSupply) return;
    try {
      await apiClient.post(`/payments/${paymentIdToSupply}/supply`);
      showToast('تم تأكيد توريد الدفعة بنجاح.');
      
      // Refresh current details invoice to update the list of payments
      if (detailsInvoice) {
        const refreshed = await apiClient.get(`/invoices/${detailsInvoice.id}`);
        setDetailsInvoice(refreshed);
      }
      fetchInvoices();
    } catch (err) {
      console.error(err);
      showToast(err.message || 'فشل تأكيد توريد الدفعة.', 'error');
    } finally {
      setSupplyConfirmOpen(false);
      setPaymentIdToSupply(null);
    }
  };

  // Open Create Wizard Form Modal
  const handleOpenCreateModal = () => {
    setFormMode('create');
    setSelectedFormInvoice(null);
    setFormOutletId('');
    setFormOutletTypeLabel('');
    setFormDiscount(0);
    setFormShippingCost(0);
    setFormPaymentType('cash');
    setFormPaymentMethod('cash');
    setFormNotes('');
    setFormItems([]);
    setFormCollectionType('none');
    setFormCollectedAmount(0);
    setFormSupplyStatus('not_supplied');
    setFormCollectionNotes('');
    setFormReceiptName('');
    setFormReceiptData('');
    setFormInvoiceNumber('');
    apiClient.get('/system/next-code?type=invoice')
      .then(res => {
        if (res && res.code) {
          setFormInvoiceNumber(res.code);
        }
      })
      .catch(console.error);
    setOpenFormModal(true);
  };

  // Open Edit Wizard Form Modal
  const handleOpenEditModal = async (invoice) => {
    try {
      const data = await apiClient.get(`/invoices/${invoice.id}`);
      setFormMode('edit');
      setSelectedFormInvoice(data);
      setFormOutletId(data.outlet_id);
      
      const outlet = outlets.find(o => o.id === data.outlet_id);
      const outletType = outletTypes.find(t => t.id === outlet?.outlet_type_id);
      setFormOutletTypeLabel(outletType ? outletType.name : '');

      setFormDiscount(data.discount);
      setFormShippingCost(data.shipping_cost);
      setFormPaymentType(data.payment_type);
      setFormNotes(data.notes || '');
      setFormInvoiceNumber(data.invoice_number || '');

      // Load products items
      const loadedItems = data.items.map(item => {
        const prod = productsList.find(p => p.id === item.product_id);
        return {
          productId: item.product_id,
          productTitle: item.product_title,
          productCode: item.product_code,
          quantity: item.quantity,
          freeQuantity: item.free_quantity || 0,
          price: item.unit_price,
          stock: prod ? prod.stock : 9999, // default if not found
          stockPolicy: prod ? prod.stockPolicy : 'ignore',
          error: ''
        };
      });
      setFormItems(loadedItems);
      setOpenFormModal(true);
    } catch (err) {
      console.error(err);
      showToast('فشل تحميل بيانات الفاتورة للتعديل.', 'error');
    }
  };

  // Outlet selection change in Create form: resolves Outlet Type and clears products prices
  const handleFormOutletChange = (outletId) => {
    setFormOutletId(outletId);
    const outlet = outlets.find((o) => o.id === outletId);
    if (outlet) {
      const type = outletTypes.find((t) => t.id === outlet.outlet_type_id);
      setFormOutletTypeLabel(type ? type.name : '');
    } else {
      setFormOutletTypeLabel('');
    }

    // Clear resolved prices of existing items when outlet changes, so we re-resolve
    setFormItems([]);
  };

  // Add Item line in wizard
  const handleAddFormItem = () => {
    if (!formOutletId) {
      showToast('يرجى اختيار المنفذ أولاً لتحديد قائمة الأسعار.', 'warning');
      return;
    }
    setFormItems([
      ...formItems,
      {
        productId: '',
        productTitle: '',
        productCode: '',
        quantity: 1,
        freeQuantity: 0,
        price: 0,
        stock: 0,
        stockPolicy: 'ignore',
        error: ''
      }
    ]);
  };

  // Remove Item line
  const handleRemoveFormItem = (index) => {
    const updated = [...formItems];
    updated.splice(index, 1);
    setFormItems(updated);
  };

  // Product selection in item line: resolves price automatically
  const handleFormItemProductChange = async (index, productObj) => {
    const updated = [...formItems];
    if (!productObj) {
      updated[index] = {
        ...updated[index],
        productId: '',
        productTitle: '',
        productCode: '',
        price: 0,
        stock: 0,
        stockPolicy: 'ignore',
        error: ''
      };
      setFormItems(updated);
      return;
    }

    // Update row details
    updated[index].productId = productObj.id;
    updated[index].productTitle = productObj.title;
    updated[index].productCode = productObj.code;
    updated[index].stock = productObj.stock;
    updated[index].stockPolicy = productObj.stockPolicy;
    updated[index].error = '';

    // Resolve price dynamically
    try {
      const resolved = await apiClient.get(
        `/product-prices/resolve?productId=${productObj.id}&outletId=${formOutletId}`
      );
      if (resolved && resolved.price !== null) {
        updated[index].price = parseFloat(resolved.price);
        updated[index].error = '';
      } else {
        updated[index].price = 0;
        updated[index].error = 'لا يوجد سعر محدد للفئة';
      }
    } catch (err) {
      console.error(err);
      updated[index].price = 0;
      updated[index].error = 'خطأ في جلب السعر';
    }
    setFormItems(updated);
  };

  // Item quantity changed
  const handleFormItemQtyChange = (index, qty) => {
    const updated = [...formItems];
    const parsedQty = parseInt(qty, 10) || 0;
    updated[index].quantity = parsedQty;

    // Validate that freeQuantity does not exceed physical quantity
    if ((updated[index].freeQuantity || 0) > parsedQty) {
      updated[index].freeQuantity = parsedQty;
    }

    // Validate stock quantity if policy is track (disabled to allow negative inventory)
    /*
    if (updated[index].stockPolicy === 'track' && parsedQty > updated[index].stock) {
      updated[index].error = `الكمية المدخلة (${parsedQty}) تتجاوز المتوفر بالمخزن (${updated[index].stock})`;
    } else {
      // Clear stock error if it was the reason
      if (updated[index].error && updated[index].error.includes('المتوفر')) {
        updated[index].error = '';
      }
    }
    */
    if (updated[index].error && updated[index].error.includes('المتوفر')) {
      updated[index].error = '';
    }
    setFormItems(updated);
  };

  // Item free quantity changed
  const handleFormItemFreeQtyChange = (index, freeQtyVal) => {
    const updated = [...formItems];
    const parsedFreeQty = parseInt(freeQtyVal, 10) || 0;

    if (parsedFreeQty < 0) {
      updated[index].error = 'الكمية المجانية لا يمكن أن تكون سالبة';
    } else if (parsedFreeQty > updated[index].quantity) {
      updated[index].error = 'الكمية المجانية لا يمكن أن تتجاوز الكمية الإجمالية للمادة';
    } else {
      updated[index].freeQuantity = parsedFreeQty;
      // Clear free quantity error if it was the reason
      if (updated[index].error && (updated[index].error.includes('المجانية') || updated[index].error.includes('سالبة'))) {
        updated[index].error = '';
      }
    }
    setFormItems(updated);
  };

  // Calculate Subtotal and Total for form display
  const calculateFormTotals = () => {
    const subtotal = formItems.reduce((acc, curr) => {
      const billable = Math.max(0, curr.quantity - (curr.freeQuantity || 0));
      return acc + billable * curr.price;
    }, 0);
    const shipping = parseFloat(formShippingCost) || 0;
    const discount = parseFloat(formDiscount) || 0;
    const total = Math.max(0, subtotal + shipping - discount);
    return {
      subtotal: subtotal.toFixed(2),
      total: total.toFixed(2)
    };
  };

  // Form submit handler
  const handleFormSubmit = async (e) => {
    e.preventDefault();
    if (!formOutletId) {
      showToast('المنفذ مطلوب.', 'error');
      return;
    }
    if (formItems.length === 0) {
      showToast('يجب إضافة مادة واحدة على الأقل في الفاتورة.', 'error');
      return;
    }

    // Check for errors in rows
    const hasRowErrors = formItems.some((item) => item.error || !item.productId);
    if (hasRowErrors) {
      showToast('يرجى تصحيح أخطاء المواد المدرجة والتأكد من تحديد الكتب.', 'error');
      return;
    }

    const totals = calculateFormTotals();
    const subtotalVal = parseFloat(totals.subtotal) || 0;
    const finalTotal = parseFloat(totals.total) || 0;
    const discountVal = parseFloat(formDiscount) || 0;

    if (discountVal > subtotalVal) {
      showToast('قيمة الخصم المباشر لا يمكن أن تتجاوز المجموع الفرعي.', 'error');
      return;
    }

    let collectedVal = 0;
    if (formMode === 'create' && canRecordInvoicePayments) {
      if (formCollectionType === 'full') {
        collectedVal = finalTotal;
      } else if (formCollectionType === 'partial') {
        collectedVal = parseFloat(formCollectedAmount) || 0;
        if (collectedVal <= 0) {
          showToast('يرجى إدخال مبلغ التحصيل للدفعة الجزئية.', 'error');
          return;
        }
        if (collectedVal > finalTotal) {
          showToast('المبلغ المحصل لا يمكن أن يتجاوز المجموع الإجمالي للفاتورة.', 'error');
          return;
        }
      }
    }

    setFormSubmitting(true);
    try {
      const payload = {
        invoiceNumber: formInvoiceNumber,
        outletId: parseInt(formOutletId, 10),
        discount: discountVal,
        shippingCost: parseFloat(formShippingCost) || 0,
        notes: formNotes,
        items: formItems.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          freeQuantity: parseInt(item.freeQuantity, 10) || 0
        }))
      };

      if (canRecordInvoicePayments) {
          payload.paymentType = formMode === 'create'
          ? (formCollectionType === 'full' ? 'cash' : 'deferred')
          : formPaymentType;
        payload.paymentMethod = formPaymentMethod;
      }

      if (formMode === 'create') {
        if (canRecordInvoicePayments) {
          payload.paymentAmount = collectedVal;
          payload.paymentSupplyStatus = formSupplyStatus;
          payload.paymentNotes = formCollectionNotes || 'تحصيل تلقائي عند إنشاء الفاتورة.';
          payload.paymentReceiptName = formReceiptName;
          payload.paymentReceiptData = formReceiptData;
        }

        await apiClient.post('/invoices', payload);
        showToast(canRecordInvoicePayments
          ? 'تم إنشاء الفاتورة وحسم الكميات وتسجيل التحصيل بنجاح.'
          : 'تم إنشاء الفاتورة وحسم الكميات بنجاح دون تسجيل تحصيل.');
      } else {
        await apiClient.put(`/invoices/${selectedFormInvoice.id}`, payload);
        showToast('تم تحديث الفاتورة وتعديل حركة المخزون بنجاح.');
      }

      setOpenFormModal(false);
      fetchInvoices();
      // Reload balances to ensure UI is perfectly synced
      try {
        if (!hasPermission('finance.view')) return;
        const balancesData = await apiClient.get('/finance/outlets');
        setOutletBalances(balancesData);
      } catch (err) {
        console.error('Error reloading balances:', err);
      }
    } catch (err) {
      console.error(err);
      showToast(err.message || 'فشل حفظ الفاتورة.', 'error');
    } finally {
      setFormSubmitting(false);
    }
  };

  // Format Helper Status mappings
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

  const getPaymentTypeDisplay = (row) => {
    if (row.payment_status === 'paid') {
      return <Chip label="دفع كلي" variant="outlined" color="success" size="small" sx={{ fontWeight: 500 }} />;
    }
    if (row.payment_status === 'partially_paid') {
      return <Chip label="دفع جزئي" variant="outlined" color="warning" size="small" sx={{ fontWeight: 500 }} />;
    }
    const label = translatePaymentType(row.payment_type);
    return <Chip label={label} variant="outlined" color="default" size="small" sx={{ fontWeight: 500 }} />;
  };

  const formTotals = calculateFormTotals();
  const selectedOutlet = outlets.find(o => o.id === formOutletId);
  const selectedOutletBalance = outletBalances.find(b => b.id === formOutletId);

  return (
    <Box sx={{ p: 1 }}>
      {/* Title & Top Action Bar */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h5" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
          إدارة فواتير المبيعات
        </Typography>

        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
          {invoiceListMode === 'active' && selectedInvoiceIds.length > 0 && hasPermission('invoices.ship') && (
            <Button
              variant="outlined"
              color="warning"
              startIcon={<LocalShippingIcon />}
              onClick={() => setOpenBulkShippingModal(true)}
              disabled={!canShipSelection}
            >
              تحديث حالة الشحن ({selectedInvoiceIds.length})
            </Button>
          )}

          {invoiceListMode === 'active' && selectedInvoiceIds.length > 0 && hasPermission('invoices.ship') && (
            <Button variant="outlined" color="warning" startIcon={<UndoIcon />} onClick={() => setBulkActionDialog('undo')} disabled={!canUndoSelection}>
              تراجع عن آخر شحنة ({selectedInvoiceIds.length})
            </Button>
          )}

          {invoiceListMode === 'active' && selectedInvoiceIds.length > 0 && hasPermission('invoices.archive') && (
            <Button variant="outlined" color="inherit" startIcon={<ArchiveIcon />} onClick={() => setBulkActionDialog('archive')}>
              أرشفة المحدد ({selectedInvoiceIds.length})
            </Button>
          )}

          {invoiceListMode === 'archived' && selectedInvoiceIds.length > 0 && hasPermission('invoices.archive') && (
            <Button variant="outlined" color="success" startIcon={<UnarchiveIcon />} onClick={() => setBulkActionDialog('restore')}>
              استرجاع المحدد ({selectedInvoiceIds.length})
            </Button>
          )}

          {invoiceListMode !== 'trash' && selectedInvoiceIds.length > 0 && isSuperAdmin && (
            <Button
              variant="outlined"
              color="error"
              startIcon={<DeleteIcon />}
              onClick={() => openInvoiceAction('trash')}
            >
              نقل إلى السلة ({selectedInvoiceIds.length})
            </Button>
          )}

          {invoiceListMode === 'trash' && selectedInvoiceIds.length > 0 && isSuperAdmin && (
            <>
              <Button
                variant="outlined"
                color="success"
                startIcon={<RestoreFromTrashIcon />}
                onClick={() => openInvoiceAction('trashRestore')}
              >
                استرجاع المحدد ({selectedInvoiceIds.length})
              </Button>
              <Button
                variant="contained"
                color="error"
                startIcon={<DeleteForeverIcon />}
                onClick={() => openInvoiceAction('permanentDelete')}
              >
                حذف نهائي ({selectedInvoiceIds.length})
              </Button>
            </>
          )}

          {invoiceListMode !== 'trash' && selectedInvoiceIds.length > 0 && hasPermission('invoices.export') && (
            <>
              <Button
                variant="outlined"
                color="secondary"
                startIcon={<DownloadIcon />}
                onClick={handleBatchPdfExport}
              >
                تصدير المحددة ({selectedInvoiceIds.length}) PDF
              </Button>
              <Button
                variant="outlined"
                color="primary"
                startIcon={<PrintIcon />}
                onClick={handleBatchPdfPrint}
              >
                طباعة المحددة ({selectedInvoiceIds.length}) PDF
              </Button>
            </>
          )}

          {invoiceListMode === 'active' && hasPermission('invoices.create') && (
            <Button
              variant="contained"
              color="primary"
              startIcon={<AddIcon />}
              onClick={handleOpenCreateModal}
            >
              إنشاء فاتورة جديدة
            </Button>
          )}
        </Box>
      </Box>

      {(hasPermission('invoices.archive.view') || hasPermission('invoices.archive')) && (
        <Tabs
          value={invoiceListMode}
          onChange={(_, value) => {
            setInvoiceListMode(value);
            setSelectedInvoiceIds([]);
            setOffset(0);
          }}
          sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
        >
          <Tab value="active" label="الفواتير الحالية" />
          <Tab value="archived" label="الأرشيف" icon={<ArchiveIcon />} iconPosition="start" />
          {isSuperAdmin && <Tab value="trash" label="سلة المحذوفات" icon={<DeleteIcon />} iconPosition="start" />}
        </Tabs>
      )}

      {isInvoiceVisibilityRestricted && (
        <Alert severity="info" variant="outlined" sx={{ mb: 3 }}>
          المعروض هنا يقتصر على الفواتير غير الملغاة التي ما زالت قيد الانتظار أو تم شحنها جزئياً.
        </Alert>
      )}

      {/* Expandable Search & Filter Panel */}
      {invoiceListMode === 'trash' ? (
        <Card sx={{ mb: 3 }}>
          <CardContent sx={{ display: 'flex', gap: 1.5, alignItems: 'center', p: 2, '&:last-child': { pb: 2 } }}>
            <TextField
              fullWidth
              size="small"
              label="ابحث برقم الفاتورة أو اسم المنفذ"
              value={filterSearch}
              onChange={(event) => setFilterSearch(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && handleApplyFilters()}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start"><SearchIcon size="small" /></InputAdornment>
                )
              }}
            />
            <Button variant="contained" startIcon={<SearchIcon />} onClick={handleApplyFilters}>بحث</Button>
          </CardContent>
        </Card>
      ) : (
      <Card sx={{ mb: 3 }}>
        <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              cursor: 'pointer'
            }}
            onClick={() => setShowFilters(!showFilters)}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <FilterIcon color="action" />
              <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
                خيارات البحث المتقدم والتصفية
              </Typography>
            </Box>
            <IconButton size="small">
              {showFilters ? <ExpandLessIcon /> : <ExpandMoreIcon />}
            </IconButton>
          </Box>

          <Collapse in={showFilters} sx={{ mt: 2 }}>
            <Divider sx={{ my: 1.5 }} />
            <Grid container spacing={2} className="filter-grid">
              {/* Row 1: Search (3), Outlet (3), Outlet Type (2), Governorate (2), Payment Status (2) */}
              <Grid item xs={12} sm={6} md={3}>
                <TextField
                  fullWidth
                  label="رقم الفاتورة، المنفذ، الملاحظات"
                  size="small"
                  value={filterSearch}
                  onChange={(e) => setFilterSearch(e.target.value)}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <SearchIcon size="small" />
                      </InputAdornment>
                    )
                  }}
                />
              </Grid>

              <Grid item xs={12} sm={6} md={3}>
                <FormControl fullWidth size="small">
                  <InputLabel id="filter-outlet-select-label">المنفذ</InputLabel>
                  <Select
                    labelId="filter-outlet-select-label"
                    value={filterOutletId}
                    onChange={(e) => setFilterOutletId(e.target.value)}
                    label="المنفذ"
                  >
                    <MenuItem value="">الكل</MenuItem>
                    {outlets.map((o) => (
                      <MenuItem key={o.id} value={o.id}>
                        {o.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>

              <Grid item xs={12} sm={6} md={2}>
                <FormControl fullWidth size="small">
                  <InputLabel id="filter-outlet-type-select-label">فئة المنفذ</InputLabel>
                  <Select
                    labelId="filter-outlet-type-select-label"
                    value={filterOutletTypeId}
                    onChange={(e) => setFilterOutletTypeId(e.target.value)}
                    label="فئة المنفذ"
                  >
                    <MenuItem value="">الكل</MenuItem>
                    {outletTypes.map((ot) => (
                      <MenuItem key={ot.id} value={ot.id}>
                        {ot.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>

              <Grid item xs={12} sm={6} md={2}>
                <FormControl fullWidth size="small">
                  <InputLabel id="filter-governorate-select-label">المحافظة</InputLabel>
                  <Select
                    labelId="filter-governorate-select-label"
                    value={filterGovernorate}
                    onChange={(e) => setFilterGovernorate(e.target.value)}
                    label="المحافظة"
                  >
                    <MenuItem value="">الكل</MenuItem>
                    {EGYPT_GOVERNORATES.map((gov) => (
                      <MenuItem key={gov} value={gov}>
                        {gov}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>

              <Grid item xs={12} sm={6} md={2}>
                <FormControl fullWidth size="small">
                  <InputLabel id="filter-payment-status-select-label">حالة الدفع</InputLabel>
                  <Select
                    labelId="filter-payment-status-select-label"
                    value={filterPaymentStatus}
                    onChange={(e) => setFilterPaymentStatus(e.target.value)}
                    label="حالة الدفع"
                  >
                    <MenuItem value="">الكل</MenuItem>
                    <MenuItem value="paid">مسددة</MenuItem>
                    <MenuItem value="unpaid">غير مسددة</MenuItem>
                    <MenuItem value="partially_paid">مسددة جزئياً</MenuItem>
                    <MenuItem value="overdue">متأخرة</MenuItem>
                  </Select>
                </FormControl>
              </Grid>

              {/* Row 2: Has Remaining (2), Shipping Status (2), Min Remaining (2), Max Remaining (2), Start Date (2), End Date (2) */}
              <Grid item xs={12} sm={6} md={2}>
                <FormControl fullWidth size="small">
                  <InputLabel id="filter-remaining-select-label">حالة المتبقي</InputLabel>
                  <Select
                    labelId="filter-remaining-select-label"
                    value={filterHasRemaining}
                    onChange={(e) => setFilterHasRemaining(e.target.value)}
                    label="حالة المتبقي"
                  >
                    <MenuItem value="">الكل</MenuItem>
                    <MenuItem value="yes">يوجد متبقي ذمة مالية</MenuItem>
                    <MenuItem value="no">مسددة بالكامل</MenuItem>
                  </Select>
                </FormControl>
              </Grid>

              <Grid item xs={12} sm={6} md={2}>
                <FormControl fullWidth size="small">
                  <InputLabel id="filter-shipping-status-select-label">حالة الشحن</InputLabel>
                  <Select
                    labelId="filter-shipping-status-select-label"
                    value={filterShippingStatus}
                    onChange={(e) => setFilterShippingStatus(e.target.value)}
                    label="حالة الشحن"
                  >
                    <MenuItem value="">الكل</MenuItem>
                    <MenuItem value="pending">قيد الانتظار</MenuItem>
                    <MenuItem value="partially_shipped">شحن جزئي</MenuItem>
                    {!isInvoiceVisibilityRestricted && <MenuItem value="shipped">تم الشحن</MenuItem>}
                  </Select>
                </FormControl>
              </Grid>

              <Grid item xs={12} sm={6} md={2}>
                <TextField
                  fullWidth
                  label="أدنى متبقي"
                  size="small"
                  type="number"
                  value={filterMinRemaining}
                  onChange={(e) => setFilterMinRemaining(e.target.value)}
                />
              </Grid>

              <Grid item xs={12} sm={6} md={2}>
                <TextField
                  fullWidth
                  label="أقصى متبقي"
                  size="small"
                  type="number"
                  value={filterMaxRemaining}
                  onChange={(e) => setFilterMaxRemaining(e.target.value)}
                />
              </Grid>

              <Grid item xs={12} sm={6} md={2}>
                <TextField
                  fullWidth
                  label="من تاريخ"
                  size="small"
                  type="date"
                  InputLabelProps={{ shrink: true }}
                  InputProps={{ notched: true }}
                  value={filterStartDate}
                  onChange={(e) => setFilterStartDate(e.target.value)}
                />
              </Grid>

              <Grid item xs={12} sm={6} md={2}>
                <TextField
                  fullWidth
                  label="إلى تاريخ"
                  size="small"
                  type="date"
                  InputLabelProps={{ shrink: true }}
                  InputProps={{ notched: true }}
                  value={filterEndDate}
                  onChange={(e) => setFilterEndDate(e.target.value)}
                />
              </Grid>

              {/* Row 3: Book (6), Author (6) */}
              <Grid item xs={12} sm={6} md={6}>
                <Autocomplete
                  fullWidth
                  options={productsList}
                  getOptionLabel={(option) => `(${option.code}) ${option.title}`}
                  size="small"
                  onChange={(e, val) => setFilterProductId(val ? val.id : '')}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="تصفية بحسب الكتاب"
                    />
                  )}
                />
              </Grid>

              <Grid item xs={12} sm={6} md={6}>
                <Autocomplete
                  fullWidth
                  options={authorsList}
                  getOptionLabel={(option) => option.name}
                  size="small"
                  onChange={(e, val) => setFilterAuthorId(val ? val.id : '')}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="تصفية بحسب المؤلف"
                    />
                  )}
                />
              </Grid>
            </Grid>

            {/* Filter Action Buttons */}
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1.5, mt: 2.5 }}>
              <Button
                variant="outlined"
                color="inherit"
                startIcon={<ClearIcon />}
                onClick={handleResetFilters}
              >
                إلغاء التصفية
              </Button>
              <Button
                variant="contained"
                color="secondary"
                startIcon={<FilterIcon />}
                onClick={handleApplyFilters}
              >
                تطبيق الفلاتر
              </Button>
            </Box>
          </Collapse>
        </CardContent>
      </Card>
      )}

      {/* Main Table Card */}
      <Paper className="main-table-paper">
        {loading ? (
          <LoadingState message="جاري تحميل قائمة الفواتير وحساب المبالغ المتبقية..." />
        ) : invoices.length === 0 ? (
          <EmptyState
            title={invoiceListMode === 'trash' ? 'سلة المحذوفات فارغة' : 'لا يوجد فواتير'}
            description={invoiceListMode === 'trash'
              ? 'لا توجد فواتير محذوفة حاليًا.'
              : 'لم يتم العثور على فواتير تطابق معايير البحث والخيارات المحددة.'}
          />
        ) : (
          <TableContainer className="scrollable-table-container" sx={{ maxHeight: 600 }}>
            <Table stickyHeader size="small">
              <TableHead>
                <TableRow>
                  <TableCell padding="checkbox">
                    <Checkbox
                      disabled={invoices.length === 0}
                      indeterminate={
                        selectedInvoiceIds.length > 0 &&
                        selectedInvoiceIds.length < invoices.length
                      }
                      checked={
                        invoices.length > 0 &&
                        selectedInvoiceIds.length === invoices.length
                      }
                      onChange={handleSelectAll}
                    />
                  </TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>رقم الفاتورة</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>التاريخ</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>المنفذ</TableCell>
                  {invoiceListMode === 'trash' && <TableCell sx={{ fontWeight: 'bold' }}>تاريخ الحذف</TableCell>}
                  {invoiceListMode === 'trash' && <TableCell sx={{ fontWeight: 'bold' }}>الحذف التلقائي</TableCell>}
                  {invoiceListMode !== 'trash' && hasPermission('payments.view') && <TableCell sx={{ fontWeight: 'bold' }}>نوع الدفع</TableCell>}
                  {hasPermission('payments.view') && <TableCell sx={{ fontWeight: 'bold' }}>حالة الدفع</TableCell>}
                  <TableCell sx={{ fontWeight: 'bold' }}>حالة الشحن</TableCell>
                  {canViewInvoicePricing && <TableCell align="right" sx={{ fontWeight: 'bold' }}>
                    المجموع
                  </TableCell>}
                  {invoiceListMode !== 'trash' && hasPermission('payments.view') && <TableCell align="right" sx={{ fontWeight: 'bold' }}>
                    المسدد / المتبقي
                  </TableCell>}
                  <TableCell align="center" sx={{ fontWeight: 'bold', minWidth: 150 }}>
                    خيارات
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {invoices.map((row) => {
                  const isSelected = selectedInvoiceIds.includes(row.id);
                  return (
                    <TableRow key={row.id} hover selected={isSelected}>
                      <TableCell padding="checkbox">
                        <Checkbox
                          checked={isSelected}
                          onChange={() => handleSelectInvoice(row.id)}
                        />
                      </TableCell>
                      <TableCell sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                        {row.invoice_number}
                      </TableCell>
                      <TableCell>
                        {formatEgyptDate(row.created_at)}
                      </TableCell>
                      <TableCell>{row.outlet_name}</TableCell>
                      {invoiceListMode === 'trash' && <TableCell>{formatEgyptDateTime(row.trashed_at)}</TableCell>}
                      {invoiceListMode === 'trash' && (
                        <TableCell>
                          <Typography variant="body2">{formatEgyptDateTime(row.purge_at)}</Typography>
                          <Typography variant="caption" color="error.main">
                            متبقي {Math.max(0, Math.ceil((new Date(row.purge_at).getTime() - Date.now()) / 86400000))} يوم
                          </Typography>
                        </TableCell>
                      )}
                      {invoiceListMode !== 'trash' && hasPermission('payments.view') && <TableCell>{getPaymentTypeDisplay(row)}</TableCell>}
                      {hasPermission('payments.view') && <TableCell>{getPaymentStatusChip(row.payment_status)}</TableCell>}
                      <TableCell>{getShippingStatusChip(row.shipping_status)}</TableCell>
                      {canViewInvoicePricing && <TableCell align="right" sx={{ fontWeight: 'bold', color: 'primary.dark' }}>
                        {formatCurrencyEGP(row.author_subtotal ?? row.net_amount ?? row.total_price)}
                      </TableCell>}
                      {invoiceListMode !== 'trash' && hasPermission('payments.view') && <TableCell align="right">
                        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                          <Typography variant="body2" sx={{ color: 'success.main', fontWeight: 500 }}>
                            {formatCurrencyEGP(row.paid_amount || 0)}
                          </Typography>
                          <Typography variant="caption" sx={{ color: 'error.main', fontWeight: 500 }}>
                            {formatCurrencyEGP(row.remaining_amount || 0)} متبقي
                          </Typography>
                        </Box>
                      </TableCell>}
                      <TableCell align="center">
                        {invoiceListMode !== 'trash' && (
                          <IconButton
                            color="primary"
                            title="عرض التفاصيل الكاملة"
                            onClick={() => handleOpenDetails(row)}
                          >
                            <VisibilityIcon size="small" />
                          </IconButton>
                        )}

                        {invoiceListMode === 'active' && hasPermission('payments.create') && row.payment_status !== 'cancelled' && row.remaining_amount > 0 && (
                          <IconButton
                            color="success"
                            title="تسجيل دفع (Pay)"
                            onClick={() => handlePayHandoff(row)}
                          >
                            <PaymentsIcon size="small" />
                          </IconButton>
                        )}

                        {invoiceListMode === 'active' && hasPermission('payments.create') && row.payment_status !== 'cancelled' && row.remaining_amount > 0 && (
                          <IconButton
                            color="success"
                            title="تعليم كمدفوعة كلياً"
                            onClick={() => handleMarkPaidHandoff(row)}
                          >
                            <CheckCircleIcon size="small" />
                          </IconButton>
                        )}

                        {invoiceListMode === 'active' && hasPermission('shipments.create') && row.payment_status !== 'cancelled' && (
                          <IconButton
                            color="warning"
                            title="إنشاء شحنة للفاتورة"
                            onClick={() => handleShipHandoff(row)}
                          >
                            <LocalShippingIcon size="small" />
                          </IconButton>
                        )}

                        {invoiceListMode === 'active' && hasPermission('returns.create') && row.payment_status !== 'cancelled' && (
                          <IconButton
                            color="secondary"
                            title="إنشاء مرتجع (Return)"
                            onClick={() => handleReturnClick(row)}
                          >
                            <SettingsBackupRestoreIcon size="small" />
                          </IconButton>
                        )}

                        {invoiceListMode === 'active' && hasPermission('invoices.update') && (
                          <IconButton
                            color="info"
                            title="تعديل الفاتورة"
                            onClick={() => handleOpenEditModal(row)}
                          >
                            <EditIcon size="small" />
                          </IconButton>
                        )}

                        {invoiceListMode !== 'trash' && hasPermission('invoices.export') && (
                          <IconButton
                            color="inherit"
                            title="تحميل فاتورة PDF"
                            onClick={() => handleSinglePdfExport(row.id)}
                          >
                            <DownloadIcon size="small" />
                          </IconButton>
                        )}

                        {invoiceListMode !== 'trash' && hasPermission('invoices.view') && (
                          <IconButton
                            color="primary"
                            title="طباعة الفاتورة"
                            onClick={() => handleFetchAndPrintInvoice(row.id)}
                          >
                            <PrintIcon size="small" />
                          </IconButton>
                        )}

                        {invoiceListMode !== 'trash' && isSuperAdmin && (
                          <IconButton
                            color="error"
                            title="نقل الفاتورة إلى سلة المحذوفات"
                            onClick={() => openInvoiceAction('trash', [row.id])}
                          >
                            <DeleteIcon size="small" />
                          </IconButton>
                        )}

                        {invoiceListMode === 'trash' && isSuperAdmin && (
                          <>
                            <IconButton
                              color="success"
                              title="استرجاع الفاتورة"
                              onClick={() => openInvoiceAction('trashRestore', [row.id])}
                            >
                              <RestoreFromTrashIcon size="small" />
                            </IconButton>
                            <IconButton
                              color="error"
                              title="حذف الفاتورة نهائيًا"
                              onClick={() => openInvoiceAction('permanentDelete', [row.id])}
                            >
                              <DeleteForeverIcon size="small" />
                            </IconButton>
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}

        {/* Custom Table Pagination */}
        <Box
          sx={{
            p: 2,
            display: 'flex',
            flexDirection: { xs: 'column', sm: 'row' },
            gap: { xs: 2, sm: 0 },
            justifyContent: 'space-between',
            alignItems: 'center',
            borderTop: '1px solid rgba(224, 224, 224, 1)'
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="body2" color="textSecondary">
              عدد الفواتير المعروضة بالصفحة:
            </Typography>
            <Select
              size="small"
              value={limit}
              onChange={(e) => {
                setLimit(e.target.value);
                setOffset(0);
              }}
              sx={{ minWidth: 70 }}
            >
              <MenuItem value={10}>10</MenuItem>
              <MenuItem value={25}>25</MenuItem>
              <MenuItem value={50}>50</MenuItem>
              <MenuItem value={100}>100</MenuItem>
            </Select>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Button size="small" disabled={offset === 0} onClick={handlePrevPage}>
              السابق
            </Button>
            <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
              السجلات ({invoices.length === 0 ? 0 : offset + 1} - {offset + invoices.length})
            </Typography>
            <Button size="small" disabled={offset + invoices.length >= totalCount} onClick={handleNextPage}>
              التالي
            </Button>
          </Box>
        </Box>
      </Paper>

      {/* --- modal details view --- */}
      <InvoiceDetailsDrawer
        open={openDetailsModal}
        onClose={() => setOpenDetailsModal(false)}
        detailsInvoice={detailsInvoice}
        invoices={invoices}
        handleNavigateInvoice={handleNavigateInvoice}
        hasPermission={hasPermission}
        handlePayHandoff={handlePayHandoff}
        handleMarkPaidHandoff={handleMarkPaidHandoff}
        handleShipHandoff={handleShipHandoff}
        handleReturnClick={handleReturnClick}
        handleSinglePdfExport={handleSinglePdfExport}
        handleSinglePdfPrint={handleSinglePdfPrint}
        handlePrintInvoice={handlePrintInvoice}
        detailsTabValue={detailsTabValue}
        setDetailsTabValue={setDetailsTabValue}
        handleMarkPaymentSupplied={handleMarkPaymentSupplied}
      />

      {/* --- wizard creation / edit invoice modal --- */}
      {/* --- wizard creation / edit invoice Drawer --- */}
      <InvoiceWizardDrawer
        open={openFormModal}
        onClose={() => setOpenFormModal(false)}
        formSubmitting={formSubmitting}
        formMode={formMode}
        formInvoiceNumber={formInvoiceNumber}
        formOutletId={formOutletId}
        handleFormOutletChange={handleFormOutletChange}
        outlets={outlets}
        formCollectionType={formCollectionType}
        setFormCollectionType={setFormCollectionType}
        formCollectedAmount={formCollectedAmount}
        setFormCollectedAmount={setFormCollectedAmount}
        formTotals={formTotals}
        formPaymentType={formPaymentType}
        formPaymentMethod={formPaymentMethod}
        setFormPaymentMethod={setFormPaymentMethod}
        paymentMethods={paymentMethods}
        formDiscount={formDiscount}
        setFormDiscount={setFormDiscount}
        formShippingCost={formShippingCost}
        setFormShippingCost={setFormShippingCost}
        formNotes={formNotes}
        setFormNotes={setFormNotes}
        selectedOutlet={selectedOutlet}
        formOutletTypeLabel={formOutletTypeLabel}
        selectedOutletBalance={selectedOutletBalance}
        formSupplyStatus={formSupplyStatus}
        setFormSupplyStatus={setFormSupplyStatus}
        formCollectionNotes={formCollectionNotes}
        setFormCollectionNotes={setFormCollectionNotes}
        formReceiptName={formReceiptName}
        setFormReceiptName={setFormReceiptName}
        formReceiptData={formReceiptData}
        setFormReceiptData={setFormReceiptData}
        formItems={formItems}
        handleAddFormItem={handleAddFormItem}
        productsList={productsList}
        handleFormItemProductChange={handleFormItemProductChange}
        handleFormItemQtyChange={handleFormItemQtyChange}
        handleFormItemFreeQtyChange={handleFormItemFreeQtyChange}
        handleRemoveFormItem={handleRemoveFormItem}
        handleFormSubmit={handleFormSubmit}
        setToastMsg={setToastMsg}
        setToastSeverity={setToastSeverity}
        canRecordPayments={canRecordInvoicePayments}
        canViewFinance={hasPermission('finance.view')}
        canSupplyPayments={hasPermission('payments.mark_supplied')}
      />



      {/* --- إنشاء مرتجع Drawer --- */}
      <InvoiceReturnDrawer
        open={openReturnDrawer}
        onClose={() => setOpenReturnDrawer(false)}
        returnSubmitting={returnSubmitting}
        returnInvoice={returnInvoice}
        returnQuantities={returnQuantities}
        handleReturnQtyChange={handleReturnQtyChange}
        returnReason={returnReason}
        setReturnReason={setReturnReason}
        setReturnQuantities={setReturnQuantities}
        handleSubmitReturn={handleSubmitReturn}
      />

      {/* Supply Payment Confirmation Dialog */}
      <ConfirmDialog
        open={supplyConfirmOpen}
        onClose={() => setSupplyConfirmOpen(false)}
        onConfirm={executeMarkPaymentSupplied}
        title="تأكيد توريد الدفعة"
        message="هل أنت متأكد من تأكيد توريد هذه الدفعة للخزينة؟"
        severity="warning"
        confirmText="تأكيد التوريد"
      />

      {/* Bulk Shipping Status Dialog */}
      <Dialog
        open={openBulkShippingModal}
        onClose={() => setOpenBulkShippingModal(false)}
        maxWidth="xs"
        fullWidth
        slotProps={{
          paper: {
            sx: {
              width: 'calc(100vw - 32px)',
              maxWidth: '520px !important',
              margin: 2
            }
          }
        }}
      >
        <DialogTitle sx={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 1 }}>
          <LocalShippingIcon color="primary" />
          {selectedInvoiceIds.length === 1 ? 'تأكيد شحن الفاتورة' : `تأكيد شحن (${selectedInvoiceIds.length}) فواتير`}
        </DialogTitle>
        <DialogContent dividers>
          <Alert severity="warning" sx={{ mt: 1 }}>
            سيتم إنشاء شحنة مستقلة لكل فاتورة وشحن كل الكميات المتبقية. إذا تعذر شحن أي فاتورة فلن تُنفذ العملية على أي فاتورة.
          </Alert>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setOpenBulkShippingModal(false)} color="inherit" disabled={bulkSubmitting}>
            إلغاء
          </Button>
          <Button
            onClick={handleBulkShippingUpdate}
            variant="contained"
            color="primary"
            disabled={bulkSubmitting}
            startIcon={<LocalShippingIcon />}
          >
            {bulkSubmitting ? 'جاري الشحن...' : 'تأكيد الشحن'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(bulkActionDialog)}
        onClose={closeInvoiceAction}
        maxWidth="xs"
        fullWidth
        slotProps={{ paper: { sx: { width: 'calc(100vw - 32px)', maxWidth: '520px !important', margin: 2 } } }}
      >
        <DialogTitle sx={{ fontWeight: 'bold' }}>
          {bulkActionDialog === 'undo' && 'تأكيد التراجع عن آخر شحنة'}
          {bulkActionDialog === 'archive' && 'تأكيد أرشفة الفواتير'}
          {bulkActionDialog === 'restore' && 'تأكيد استرجاع الفواتير'}
          {bulkActionDialog === 'trash' && 'نقل الفواتير إلى سلة المحذوفات'}
          {bulkActionDialog === 'trashRestore' && 'استرجاع الفواتير من سلة المحذوفات'}
          {bulkActionDialog === 'permanentDelete' && 'حذف الفواتير نهائيًا'}
        </DialogTitle>
        <DialogContent dividers>
          <Alert severity={['trash', 'permanentDelete', 'undo'].includes(bulkActionDialog) ? 'warning' : 'info'}>
            {bulkActionDialog === 'undo' && `سيتم إلغاء أحدث شحنة لكل فاتورة من ${selectedInvoiceIds.length} فاتورة. قد تصبح الحالة مشحون جزئيًا أو قيد الانتظار، وستعود كميات الشحنة الملغاة للمخزون.`}
            {bulkActionDialog === 'archive' && `سيتم نقل ${selectedInvoiceIds.length} فاتورة إلى الأرشيف دون حذف بياناتها أو التأثير على المدفوعات والشحنات.`}
            {bulkActionDialog === 'restore' && `سيتم استرجاع ${selectedInvoiceIds.length} فاتورة إلى قائمة الفواتير الحالية.`}
            {bulkActionDialog === 'trash' && `سيتم نقل ${selectedInvoiceIds.length} فاتورة إلى السلة وإزالة أثرها فورًا من الحسابات والمخزون والتقارير. يمكن استرجاعها خلال 30 يومًا.`}
            {bulkActionDialog === 'trashRestore' && `سيتم استرجاع ${selectedInvoiceIds.length} فاتورة بكل دفعاتها وشحناتها ومرتجعاتها إلى وضعها السابق.`}
            {bulkActionDialog === 'permanentDelete' && `سيتم حذف ${selectedInvoiceIds.length} فاتورة نهائيًا مع إيصالات الدفع الخاصة بها. لا يمكن التراجع عن هذه العملية.`}
          </Alert>
          {bulkActionDialog === 'trash' && (
            <TextField
              fullWidth
              autoFocus
              sx={{ mt: 2 }}
              label="اكتب «حذف» للتأكيد"
              value={bulkActionConfirmation}
              onChange={(event) => setBulkActionConfirmation(event.target.value)}
            />
          )}
          {bulkActionDialog === 'permanentDelete' && (
            <TextField
              fullWidth
              autoFocus
              sx={{ mt: 2 }}
              label="اكتب «حذف نهائي» للتأكيد"
              value={bulkActionConfirmation}
              onChange={(event) => setBulkActionConfirmation(event.target.value)}
            />
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button color="inherit" onClick={closeInvoiceAction} disabled={bulkSubmitting}>إلغاء</Button>
          <Button
            variant="contained"
            color={['trash', 'permanentDelete'].includes(bulkActionDialog) ? 'error' : bulkActionDialog === 'archive' ? 'warning' : 'primary'}
            onClick={executeBulkInvoiceAction}
            disabled={bulkSubmitting || (bulkActionDialog === 'trash' && bulkActionConfirmation !== 'حذف') || (bulkActionDialog === 'permanentDelete' && bulkActionConfirmation !== 'حذف نهائي')}
          >
            {bulkSubmitting ? 'جاري التنفيذ...' : bulkActionDialog === 'permanentDelete' ? 'حذف نهائي' : 'تأكيد'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Snackbar Alert Toast */}
      <Snackbar
        open={!!toastMsg}
        autoHideDuration={4000}
        onClose={() => setToastMsg('')}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        <Alert onClose={() => setToastMsg('')} severity={toastSeverity} sx={{ width: '100%' }}>
          {toastMsg}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default Invoices;
