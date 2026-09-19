import React, { useState, useEffect, useCallback } from 'react';
import { formatCurrencyEGP, formatEgyptDateTime, formatEgyptDate } from '../utils/formatters';
import { useAuth } from '../app/AuthContext';
import { apiClient } from '../services/apiClient';
import LoadingState from '../components/LoadingState';
import EmptyState from '../components/EmptyState';
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
  TableFooter,
  Button,
  Grid,
  Card,
  CardContent,
  Tabs,
  Tab,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Snackbar,
  Alert,
  Stack
} from '@mui/material';
import {
  TrendingUp as TrendingUpIcon,
  Payment as PaymentIcon,
  AccountBalanceWallet as WalletIcon,
  FileDownload as DownloadIcon,
  Clear as ClearIcon,
  Print as PrintIcon
} from '@mui/icons-material';



import '../styles/Reports.css';

function TabPanel({ children, value, index, ...props }) {
  return (
    <Box role="tabpanel" hidden={value !== index} {...props}>
      {value === index && <Box sx={{ pt: 3, pb: 'var(--space-6)' }}>{children}</Box>}
    </Box>
  );
}

export const Reports = () => {
  const { hasPermission } = useAuth();
  const [tab, setTab] = useState(() => hasPermission('finance.view') ? 0 : 4);
  const [toastMsg, setToastMsg] = useState('');
  const [toastSeverity, setToastSeverity] = useState('success');
  const showToast = (msg, severity = 'success') => { setToastMsg(msg); setToastSeverity(severity); };

  // Dropdown list states
  const [outlets, setOutlets] = useState([]);
  const [outletTypes, setOutletTypes] = useState([]);

  // Filter States
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedOutlet, setSelectedOutlet] = useState('');
  const [selectedOutletType, setSelectedOutletType] = useState('');
  const [selectedGovernorate, setSelectedGovernorate] = useState('');
  
  // Stock/Author/Receipt extra search filters
  const [stockSearch, setStockSearch] = useState('');
  const [stockStatus, setStockStatus] = useState('');
  const [authorSearch, setAuthorSearch] = useState('');
  const [authorStatus, setAuthorStatus] = useState('');
  const [receiptSearch, setReceiptSearch] = useState('');
  const [productOptions, setProductOptions] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState('');
  const [productSales, setProductSales] = useState([]);
  const [productSalesLoading, setProductSalesLoading] = useState(false);

  // Report Data States
  const [summaryData, setSummaryData] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  const [balancesOutlet, setBalancesOutlet] = useState([]);
  const [balancesOutletLoading, setBalancesOutletLoading] = useState(false);

  const [balancesGov, setBalancesGov] = useState([]);
  const [balancesGovLoading, setBalancesGovLoading] = useState(false);

  const [balancesType, setBalancesType] = useState([]);
  const [balancesTypeLoading, setBalancesTypeLoading] = useState(false);

  const [stockData, setStockData] = useState([]);
  const [stockLoading, setStockLoading] = useState(false);

  const [authorData, setAuthorData] = useState([]);
  const [authorLoading, setAuthorLoading] = useState(false);

  const [receiptData, setReceiptData] = useState([]);
  const [receiptLoading, setReceiptLoading] = useState(false);

  // Fetch Dropdown data
  useEffect(() => {
    const fetchDropdowns = async () => {
      try {
        if (hasPermission('finance.view') && hasPermission('outlet_types.view')) {
          const types = await apiClient.get('/outlet-types');
          setOutletTypes(types);
        }
        if (hasPermission('finance.view') && hasPermission('outlets.view')) {
          const list = await apiClient.get('/outlets');
          setOutlets(list);
        }
        const products = await apiClient.get('/reports/product-options');
        setProductOptions(products || []);
      } catch (err) {
        console.error('Failed to load filter dropdowns', err);
      }
    };
    fetchDropdowns();
  }, []);

  const fetchProductSales = useCallback(async () => {
    if (!selectedProduct) {
      setProductSales([]);
      return;
    }
    setProductSalesLoading(true);
    try {
      let q = `/reports/product-sales?productId=${selectedProduct}&startDate=${startDate}&endDate=${endDate}`;
      if (selectedGovernorate) q += `&governorate=${encodeURIComponent(selectedGovernorate)}`;
      if (selectedOutletType) q += `&outletTypeId=${selectedOutletType}`;
      const data = await apiClient.get(q);
      setProductSales(data || []);
    } catch (err) {
      showToast(err.message || 'خطأ في تحميل تحليل مبيعات الكتاب', 'error');
    } finally {
      setProductSalesLoading(false);
    }
  }, [selectedProduct, startDate, endDate, selectedGovernorate, selectedOutletType]);

  // Fetch Summary
  const fetchSummary = useCallback(async () => {
    setSummaryLoading(true);
    try {
      let q = `/reports/financials/summary?startDate=${startDate}&endDate=${endDate}`;
      if (selectedOutlet) q += `&outletId=${selectedOutlet}`;
      if (selectedOutletType) q += `&outletTypeId=${selectedOutletType}`;
      if (selectedGovernorate) q += `&governorate=${encodeURIComponent(selectedGovernorate)}`;
      
      const data = await apiClient.get(q);
      setSummaryData(data);
    } catch (err) {
      showToast(err.message || 'خطأ في تحميل الخلاصة المالية', 'error');
    } finally {
      setSummaryLoading(false);
    }
  }, [startDate, endDate, selectedOutlet, selectedOutletType, selectedGovernorate]);

  // Fetch Balances by Outlet
  const fetchBalancesOutlet = useCallback(async () => {
    setBalancesOutletLoading(true);
    try {
      let q = `/reports/financials/by-outlet?startDate=${startDate}&endDate=${endDate}`;
      if (selectedOutletType) q += `&outletTypeId=${selectedOutletType}`;
      if (selectedGovernorate) q += `&governorate=${encodeURIComponent(selectedGovernorate)}`;
      
      const data = await apiClient.get(q);
      setBalancesOutlet(data);
    } catch (err) {
      showToast(err.message || 'خطأ في تحميل أرصدة المنافذ', 'error');
    } finally {
      setBalancesOutletLoading(false);
    }
  }, [startDate, endDate, selectedOutletType, selectedGovernorate]);

  // Fetch Balances by Governorate
  const fetchBalancesGov = useCallback(async () => {
    setBalancesGovLoading(true);
    try {
      let q = `/reports/financials/by-governorate?startDate=${startDate}&endDate=${endDate}`;
      if (selectedOutletType) q += `&outletTypeId=${selectedOutletType}`;
      const data = await apiClient.get(q);
      setBalancesGov(data);
    } catch (err) {
      showToast(err.message || 'خطأ في تحميل مبيعات المحافظات', 'error');
    } finally {
      setBalancesGovLoading(false);
    }
  }, [startDate, endDate, selectedOutletType]);

  // Fetch Balances by Outlet Type
  const fetchBalancesType = useCallback(async () => {
    setBalancesTypeLoading(true);
    try {
      const data = await apiClient.get(`/reports/financials/by-outlet-type?startDate=${startDate}&endDate=${endDate}`);
      setBalancesType(data);
    } catch (err) {
      showToast(err.message || 'خطأ في تحميل مبيعات فئات المنافذ', 'error');
    } finally {
      setBalancesTypeLoading(false);
    }
  }, [startDate, endDate]);

  // Fetch Stock Report
  const fetchStockReport = useCallback(async () => {
    setStockLoading(true);
    try {
      let q = `/reports/stock?search=${encodeURIComponent(stockSearch)}`;
      if (stockStatus) q += `&status=${stockStatus}`;
      const data = await apiClient.get(q);
      setStockData(data);
    } catch (err) {
      showToast(err.message || 'خطأ في تحميل تقرير المخزون', 'error');
    } finally {
      setStockLoading(false);
    }
  }, [stockSearch, stockStatus]);

  // Fetch Author Report
  const fetchAuthorReport = useCallback(async () => {
    setAuthorLoading(true);
    try {
      let q = `/reports/authors?search=${encodeURIComponent(authorSearch)}`;
      if (authorStatus) q += `&status=${authorStatus}`;
      const data = await apiClient.get(q);
      setAuthorData(data);
    } catch (err) {
      showToast(err.message || 'خطأ في تحميل تقرير المؤلفين', 'error');
    } finally {
      setAuthorLoading(false);
    }
  }, [authorSearch, authorStatus]);

  // Fetch Receipt Report
  const fetchReceiptReport = useCallback(async () => {
    setReceiptLoading(true);
    try {
      const q = `/reports/receipts?search=${encodeURIComponent(receiptSearch)}&startDate=${startDate}&endDate=${endDate}`;
      const data = await apiClient.get(q);
      setReceiptData(data);
    } catch (err) {
      showToast(err.message || 'خطأ في تحميل تقرير التوريدات', 'error');
    } finally {
      setReceiptLoading(false);
    }
  }, [receiptSearch, startDate, endDate]);

  // Trigger loading based on active tab
  useEffect(() => {
    if (hasPermission('finance.view') && tab === 0) fetchSummary();
    if (hasPermission('finance.view') && tab === 1) fetchBalancesOutlet();
    if (hasPermission('finance.view') && tab === 2) fetchBalancesGov();
    if (hasPermission('finance.view') && tab === 3) fetchBalancesType();
    if (tab === 4) fetchStockReport();
    if (tab === 5) fetchAuthorReport();
    if (tab === 6) fetchReceiptReport();
    if (tab === 7) fetchProductSales();
  }, [tab, fetchSummary, fetchBalancesOutlet, fetchBalancesGov, fetchBalancesType, fetchStockReport, fetchAuthorReport, fetchReceiptReport, fetchProductSales]);

  const clearFilters = () => {
    setStartDate('');
    setEndDate('');
    setSelectedOutlet('');
    setSelectedOutletType('');
    setSelectedGovernorate('');
    setStockSearch('');
    setStockStatus('');
    setAuthorSearch('');
    setAuthorStatus('');
    setReceiptSearch('');
    setSelectedProduct('');
  };

  const handlePrintReport = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      showToast('يرجى السماح بالنوافذ المنبثقة لطباعة التقرير.', 'warning');
      return;
    }

    const reportTitles = [
      'الخلاصة المالية',
      'أرصدة الفروع ومنافذ البيع',
      'مبيعات المحافظات',
      'مبيعات فئات منافذ البيع',
      'حالة المخزون التفصيلي',
      'مبيعات وأرصدة كتب المؤلفين',
      'سجل توريدات الموردين',
      'تحليل مبيعات الكتاب حسب المحافظة'
    ];

    const currentTitle = reportTitles[tab] || 'التقرير المالي';
    let contentHtml = '';

    // Apply active filters summary html
    const filtersUsed = [];
    if (startDate) filtersUsed.push(`من تاريخ: ${startDate}`);
    if (endDate) filtersUsed.push(`إلى تاريخ: ${endDate}`);
    if (tab === 0) {
      if (selectedOutlet) {
        const outlet = outlets.find(o => o.id === selectedOutlet);
        if (outlet) filtersUsed.push(`المنفذ: ${outlet.name}`);
      }
    }
    if ([0, 1, 2].includes(tab)) {
      if (selectedOutletType) {
        const type = outletTypes.find(t => t.id === selectedOutletType);
        if (type) filtersUsed.push(`الفئة: ${type.name}`);
      }
      if ([0, 1].includes(tab) && selectedGovernorate) filtersUsed.push(`المحافظة: ${selectedGovernorate}`);
    }
    if (tab === 4) {
      if (stockSearch) filtersUsed.push(`بحث المخزون: ${stockSearch}`);
      if (stockStatus) filtersUsed.push(`الحالة: ${stockStatus === 'active' ? 'نشط' : 'معطل'}`);
    }
    if (tab === 5) {
      if (authorSearch) filtersUsed.push(`اسم المؤلف: ${authorSearch}`);
      if (authorStatus) filtersUsed.push(`الحالة: ${authorStatus === 'active' ? 'نشط' : 'معطل'}`);
    }
    if (tab === 6) {
      if (receiptSearch) filtersUsed.push(`اسم المورد: ${receiptSearch}`);
    }
    if (tab === 7) {
      const product = productOptions.find(item => String(item.id) === String(selectedProduct));
      if (product) filtersUsed.push(`الكتاب: ${product.title} (${product.code || 'بدون كود'})`);
      if (selectedGovernorate) filtersUsed.push(`المحافظة: ${selectedGovernorate}`);
    }

    const filtersHtml = filtersUsed.length > 0 
      ? `<div style="margin-bottom: 20px; font-size: 13px; color: #475569; border: 1px dashed #cbd5e1; padding: 10px; border-radius: 6px;">
           <strong>الفلاتر المطبقة:</strong> ${filtersUsed.join(' | ')}
         </div>`
      : '';

    if (tab === 0) {
      // TAB 0: Summary Data Cards
      if (!summaryData) {
        contentHtml = '<p style="text-align:center;">لا توجد بيانات متاحة حالياً.</p>';
      } else {
        contentHtml = `
          <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-bottom: 30px;">
            <div style="background-color: #ebf5fb; border-right: 5px solid #1d4ed8; padding: 15px; border-radius: 6px;">
              <span style="font-size: 12px; color: #475569; display:block;">إجمالي المبيعات</span>
              <strong style="font-size: 18px; color: #1e3a8a; display:block; margin-top:5px;">${formatCurrencyEGP(summaryData.totalSales)}</strong>
            </div>
            <div style="background-color: #e8f8f5; border-right: 5px solid #047857; padding: 15px; border-radius: 6px;">
              <span style="font-size: 12px; color: #475569; display:block;">المبالغ المسددة</span>
              <strong style="font-size: 18px; color: #065f46; display:block; margin-top:5px;">${formatCurrencyEGP(summaryData.totalPaid)}</strong>
            </div>
            <div style="background-color: #fdf2e9; border-right: 5px solid #c2410c; padding: 15px; border-radius: 6px;">
              <span style="font-size: 12px; color: #475569; display:block;">المبالغ المتبقية (الديون)</span>
              <strong style="font-size: 18px; color: #9a3412; display:block; margin-top:5px;">${formatCurrencyEGP(summaryData.totalRemaining)}</strong>
            </div>
          </div>

          <h4 style="margin: 25px 0 10px 0; color: #0f172a; border-bottom: 1px solid #e2e8f0; padding-bottom: 5px;">تفاصيل التوريدات المادية واللوجستية:</h4>
          <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px; margin-bottom: 25px;">
            <div style="border: 1px solid #e2e8f0; padding: 12px; border-radius: 6px; background-color: #fafafa;">
              <span style="font-size: 12px; color: #475569; display:block;">مدفوعات موردة للخزينة الرئيسية (Supplied)</span>
              <strong style="font-size: 16px; color: #047857; display:block; margin-top:5px;">${formatCurrencyEGP(summaryData.totalSupplied)}</strong>
            </div>
            <div style="border: 1px solid #e2e8f0; padding: 12px; border-radius: 6px; background-color: #fafafa;">
              <span style="font-size: 12px; color: #475569; display:block;">مدفوعات معلقة في الخزن الفرعية (Unsupplied)</span>
              <strong style="font-size: 16px; color: #dc2626; display:block; margin-top:5px;">${formatCurrencyEGP(summaryData.totalUnsupplied)}</strong>
            </div>
          </div>

          <h4 style="margin: 20px 0 10px 0; color: #0f172a; border-bottom: 1px solid #e2e8f0; padding-bottom: 5px;">إحصائيات الشحن وتسليم الطلبيات:</h4>
          <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
            <thead>
              <tr style="background-color: #f1f5f9;">
                <th style="border: 1px solid #cbd5e1; padding: 10px; text-align: right;">الحالة اللوجستية شحن وتوصيل</th>
                <th style="border: 1px solid #cbd5e1; padding: 10px; text-align: center;">العدد الإجمالي للفواتير</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style="border: 1px solid #cbd5e1; padding: 10px;">فواتير تم شحنها وتسليمها بالكامل</td>
                <td style="border: 1px solid #cbd5e1; padding: 10px; text-align: center; font-weight: bold;">${summaryData.countShipped} فواتير</td>
              </tr>
              <tr>
                <td style="border: 1px solid #cbd5e1; padding: 10px;">فواتير شحنت بشكل جزئي</td>
                <td style="border: 1px solid #cbd5e1; padding: 10px; text-align: center; font-weight: bold; color: #ca8a04;">${summaryData.countPartiallyShipped} فواتير</td>
              </tr>
              <tr>
                <td style="border: 1px solid #cbd5e1; padding: 10px;">فواتير قيد الانتظار وغير مشحونة</td>
                <td style="border: 1px solid #cbd5e1; padding: 10px; text-align: center; font-weight: bold; color: #dc2626;">${summaryData.countNotShipped} فواتير</td>
              </tr>
            </tbody>
          </table>
        `;
      }
    } else {
      // TABLES TABS
      let headersHtml = '';
      let bodyHtml = '';

      if (tab === 1) {
        headersHtml = `
          <tr>
            <th style="border: 1px solid #cbd5e1; padding: 8px; text-align: right;">المنفذ</th>
            <th style="border: 1px solid #cbd5e1; padding: 8px; text-align: right;">فئة المنفذ</th>
            <th style="border: 1px solid #cbd5e1; padding: 8px; text-align: right;">المحافظة</th>
            <th style="border: 1px solid #cbd5e1; padding: 8px; text-align: left;">سقف الائتمان</th>
            <th style="border: 1px solid #cbd5e1; padding: 8px; text-align: left;">إجمالي المبيعات</th>
            <th style="border: 1px solid #cbd5e1; padding: 8px; text-align: left;">المسدد</th>
            <th style="border: 1px solid #cbd5e1; padding: 8px; text-align: left;">المتبقي</th>
          </tr>
        `;
        bodyHtml = balancesOutlet.map((row) => `
          <tr>
            <td style="border: 1px solid #cbd5e1; padding: 8px;">${row.outletName}</td>
            <td style="border: 1px solid #cbd5e1; padding: 8px;">${row.outletTypeName}</td>
            <td style="border: 1px solid #cbd5e1; padding: 8px;">${row.governorate}</td>
            <td style="border: 1px solid #cbd5e1; padding: 8px; text-align: left;">${row.creditLimit ? formatCurrencyEGP(row.creditLimit) : 'مفتوح'}</td>
            <td style="border: 1px solid #cbd5e1; padding: 8px; text-align: left;">${formatCurrencyEGP(row.totalSales)}</td>
            <td style="border: 1px solid #cbd5e1; padding: 8px; text-align: left;">${formatCurrencyEGP(row.totalPaid)}</td>
            <td style="border: 1px solid #cbd5e1; padding: 8px; text-align: left; font-weight: bold; color: ${row.remainingAmount > 0 ? '#b45309' : 'inherit'};">${formatCurrencyEGP(row.remainingAmount)}</td>
          </tr>
        `).join('');
      } else if (tab === 2) {
        headersHtml = `
          <tr>
            <th style="border: 1px solid #cbd5e1; padding: 8px; text-align: right;">المحافظة</th>
            <th style="border: 1px solid #cbd5e1; padding: 8px; text-align: left;">إجمالي المبيعات</th>
            <th style="border: 1px solid #cbd5e1; padding: 8px; text-align: left;">المسدد</th>
            <th style="border: 1px solid #cbd5e1; padding: 8px; text-align: left;">المتبقي (الذمم المفتوحة)</th>
          </tr>
        `;
        bodyHtml = balancesGov.map((row) => `
          <tr>
            <td style="border: 1px solid #cbd5e1; padding: 8px;">${row.governorate || 'غير مصنف'}</td>
            <td style="border: 1px solid #cbd5e1; padding: 8px; text-align: left;">${formatCurrencyEGP(row.totalSales)}</td>
            <td style="border: 1px solid #cbd5e1; padding: 8px; text-align: left;">${formatCurrencyEGP(row.totalPaid)}</td>
            <td style="border: 1px solid #cbd5e1; padding: 8px; text-align: left;">${formatCurrencyEGP(row.remainingAmount)}</td>
          </tr>
        `).join('');
      } else if (tab === 3) {
        headersHtml = `
          <tr>
            <th style="border: 1px solid #cbd5e1; padding: 8px; text-align: right;">فئة المنفذ</th>
            <th style="border: 1px solid #cbd5e1; padding: 8px; text-align: left;">إجمالي المبيعات</th>
            <th style="border: 1px solid #cbd5e1; padding: 8px; text-align: left;">المسدد</th>
            <th style="border: 1px solid #cbd5e1; padding: 8px; text-align: left;">المتبقي</th>
          </tr>
        `;
        bodyHtml = balancesType.map((row) => `
          <tr>
            <td style="border: 1px solid #cbd5e1; padding: 8px;">${row.outletTypeName}</td>
            <td style="border: 1px solid #cbd5e1; padding: 8px; text-align: left;">${formatCurrencyEGP(row.totalSales)}</td>
            <td style="border: 1px solid #cbd5e1; padding: 8px; text-align: left;">${formatCurrencyEGP(row.totalPaid)}</td>
            <td style="border: 1px solid #cbd5e1; padding: 8px; text-align: left;">${formatCurrencyEGP(row.remainingAmount)}</td>
          </tr>
        `).join('');
      } else if (tab === 4) {
        headersHtml = `
          <tr>
            <th style="border: 1px solid #cbd5e1; padding: 8px; text-align: right;">رمز الكتاب (SKU)</th>
            <th style="border: 1px solid #cbd5e1; padding: 8px; text-align: right;">العنوان</th>
            <th style="border: 1px solid #cbd5e1; padding: 8px; text-align: right;">التصنيف</th>
            <th style="border: 1px solid #cbd5e1; padding: 8px; text-align: center;">صافي الوارد</th>
            <th style="border: 1px solid #cbd5e1; padding: 8px; text-align: center;">صافي المبيعات</th>
            <th style="border: 1px solid #cbd5e1; padding: 8px; text-align: center;">المشحون</th>
            <th style="border: 1px solid #cbd5e1; padding: 8px; text-align: center;">المتبقي من المبيعات</th>
            <th style="border: 1px solid #cbd5e1; padding: 8px; text-align: center;">رصيد المخزون</th>
            <th style="border: 1px solid #cbd5e1; padding: 8px; text-align: center;">رصيد الشحن المسجل</th>
            <th style="border: 1px solid #cbd5e1; padding: 8px; text-align: center;">المتاح للشحن</th>
            <th style="border: 1px solid #cbd5e1; padding: 8px; text-align: center;">الحالة</th>
          </tr>
        `;
        bodyHtml = stockData.map((row) => `
          <tr>
            <td style="border: 1px solid #cbd5e1; padding: 8px; font-family: monospace;">${row.productCode}</td>
            <td style="border: 1px solid #cbd5e1; padding: 8px;">${row.productTitle}</td>
            <td style="border: 1px solid #cbd5e1; padding: 8px;">${row.category || 'غير محدد'}</td>
            <td style="border: 1px solid #cbd5e1; padding: 8px; text-align: center;">${row.netReceived ?? row.totalReceived}</td>
            <td style="border: 1px solid #cbd5e1; padding: 8px; text-align: center;">${row.netSales}</td>
            <td style="border: 1px solid #cbd5e1; padding: 8px; text-align: center;">${row.totalShipped || 0}</td>
            <td style="border: 1px solid #cbd5e1; padding: 8px; text-align: center;">${row.remainingToShip ?? row.remainingToFulfill ?? 0}</td>
            <td style="border: 1px solid #cbd5e1; padding: 8px; text-align: center; font-weight: bold; color: ${row.stockBalance < 0 ? '#dc2626' : '#16a34a'};">${row.stockBalance ?? row.currentStock ?? 0}</td>
            <td style="border: 1px solid #cbd5e1; padding: 8px; text-align: center; font-weight: bold; color: ${(row.shippableStockBalance ?? row.rawAvailableToShip ?? 0) < 0 ? '#dc2626' : '#16a34a'};">${row.shippableStockBalance ?? row.rawAvailableToShip ?? 0}</td>
            <td style="border: 1px solid #cbd5e1; padding: 8px; text-align: center; font-weight: bold;">${row.availableToShip || 0}</td>
            <td style="border: 1px solid #cbd5e1; padding: 8px; text-align: center;">${row.status === 'active' ? 'نشط' : 'غير نشط'}</td>
          </tr>
        `).join('');
      } else if (tab === 5) {
        headersHtml = `
          <tr>
            <th style="border: 1px solid #cbd5e1; padding: 8px; text-align: right;">المؤلف</th>
            <th style="border: 1px solid #cbd5e1; padding: 8px; text-align: center;">الحالة</th>
            <th style="border: 1px solid #cbd5e1; padding: 8px; text-align: center;">عدد العناوين</th>
            <th style="border: 1px solid #cbd5e1; padding: 8px; text-align: left;">مبيعات كلي</th>
            <th style="border: 1px solid #cbd5e1; padding: 8px; text-align: center;">إجمالي النسخ المباعة</th>
            <th style="border: 1px solid #cbd5e1; padding: 8px; text-align: center;">المخزون المتوفر</th>
          </tr>
        `;
        bodyHtml = authorData.map((row) => `
          <tr>
            <td style="border: 1px solid #cbd5e1; padding: 8px;">${row.authorName}</td>
            <td style="border: 1px solid #cbd5e1; padding: 8px; text-align: center;">${row.status === 'active' ? 'نشط' : 'معطل'}</td>
            <td style="border: 1px solid #cbd5e1; padding: 8px; text-align: center;">${row.totalBooks}</td>
            <td style="border: 1px solid #cbd5e1; padding: 8px; text-align: left;">${formatCurrencyEGP(row.totalSales)}</td>
            <td style="border: 1px solid #cbd5e1; padding: 8px; text-align: center;">${row.totalCopiesSold} نسخه</td>
            <td style="border: 1px solid #cbd5e1; padding: 8px; text-align: center;">${row.currentStock} نسخه</td>
          </tr>
        `).join('');
      } else if (tab === 6) {
        headersHtml = `
          <tr>
            <th style="border: 1px solid #cbd5e1; padding: 8px; text-align: right;">اسم المورد</th>
            <th style="border: 1px solid #cbd5e1; padding: 8px; text-align: center;">عدد حركات التوريد</th>
            <th style="border: 1px solid #cbd5e1; padding: 8px; text-align: center;">إجمالي الكمية الموردة</th>
          </tr>
        `;
        bodyHtml = receiptData.map((row) => `
          <tr>
            <td style="border: 1px solid #cbd5e1; padding: 8px;">${row.supplierName}</td>
            <td style="border: 1px solid #cbd5e1; padding: 8px; text-align: center;">${row.totalReceipts}</td>
            <td style="border: 1px solid #cbd5e1; padding: 8px; text-align: center; font-weight: bold;">${row.totalQuantity} نسخه</td>
          </tr>
        `).join('');
      } else if (tab === 7) {
        headersHtml = `
          <tr>
            <th style="border: 1px solid #cbd5e1; padding: 8px; text-align: right;">المحافظة</th>
            <th style="border: 1px solid #cbd5e1; padding: 8px; text-align: center;">عدد الفواتير</th>
            <th style="border: 1px solid #cbd5e1; padding: 8px; text-align: center;">الإجمالي</th>
            <th style="border: 1px solid #cbd5e1; padding: 8px; text-align: center;">المسعّر</th>
            <th style="border: 1px solid #cbd5e1; padding: 8px; text-align: center;">المجاني</th>
            <th style="border: 1px solid #cbd5e1; padding: 8px; text-align: center;">المرتجع</th>
            <th style="border: 1px solid #cbd5e1; padding: 8px; text-align: center;">الصافي</th>
            <th style="border: 1px solid #cbd5e1; padding: 8px; text-align: center;">المشحون</th>
            <th style="border: 1px solid #cbd5e1; padding: 8px; text-align: center;">المتبقي للشحن</th>
            <th style="border: 1px solid #cbd5e1; padding: 8px; text-align: center;">مدفوع/جزئي/غير مدفوع</th>
          </tr>
        `;
        bodyHtml = productSales.map((row) => `
          <tr>
            <td style="border: 1px solid #cbd5e1; padding: 8px;">${row.governorate || 'غير مصنف'}</td>
            <td style="border: 1px solid #cbd5e1; padding: 8px; text-align: center;">${row.invoiceCount}</td>
            <td style="border: 1px solid #cbd5e1; padding: 8px; text-align: center;">${row.totalQuantity}</td>
            <td style="border: 1px solid #cbd5e1; padding: 8px; text-align: center;">${row.billableQuantity}</td>
            <td style="border: 1px solid #cbd5e1; padding: 8px; text-align: center;">${row.freeQuantity}</td>
            <td style="border: 1px solid #cbd5e1; padding: 8px; text-align: center;">${row.returnedQuantity}</td>
            <td style="border: 1px solid #cbd5e1; padding: 8px; text-align: center; font-weight: bold;">${row.netQuantity}</td>
            <td style="border: 1px solid #cbd5e1; padding: 8px; text-align: center;">${row.shippedQuantity}</td>
            <td style="border: 1px solid #cbd5e1; padding: 8px; text-align: center;">${row.remainingToShip}</td>
            <td style="border: 1px solid #cbd5e1; padding: 8px; text-align: center;">${row.paidQuantity} / ${row.partiallyPaidQuantity} / ${row.unpaidQuantity}</td>
          </tr>
        `).join('');
      }

      contentHtml = `
        <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
          <thead>
            <tr style="background-color: #f1f5f9;">
              ${headersHtml}
            </tr>
          </thead>
          <tbody>
            ${bodyHtml}
          </tbody>
        </table>
      `;
    }

    printWindow.document.write(`
      <html dir="rtl" lang="ar">
      <head>
        <title>${currentTitle} - مطبعة حمزة</title>
        <style>
          @page { size: A4; margin: 15mm; }
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 10px; color: #1e293b; line-height: 1.5; font-size: 13px; }
          .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #0f172a; padding-bottom: 10px; margin-bottom: 20px; }
          .header h2 { margin: 0; font-size: 20px; color: #1e3a8a; }
          .header p { margin: 4px 0 0 0; font-size: 11px; color: #64748b; }
          table { width: 100%; border-collapse: collapse; margin-top: 15px; }
          th { background-color: #f8fafc; border: 1px solid #cbd5e1; padding: 8px; font-weight: bold; color: #334155; font-size: 12px; }
          td { border: 1px solid #cbd5e1; padding: 8px; font-size: 12px; }
          tr:nth-child(even) { background-color: #f8fafc; }
          .footer { margin-top: 50px; text-align: center; font-size: 10px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 10px; }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <h2>${currentTitle}</h2>
            <p>مطبعة حمزة للنشر والتوزيع - قسم الحسابات والإحصاء</p>
          </div>
          <div style="text-align: left;">
            <p><strong>تاريخ الطباعة:</strong> ${new Date().toLocaleDateString('ar-EG')}</p>
            <p>نظام الإدارة الداخلي</p>
          </div>
        </div>

        ${filtersHtml}
        ${contentHtml}

        <div class="footer">
          نظام إدارة دار الكتب ومطبعة حمزة - تم توليد وطباعة هذا التقرير تلقائياً.
        </div>
        <script>
          window.onload = function() { window.print(); window.close(); }
        </script>
      </body>
      </html>
    `);
    printWindow.document.close();
  };

  const handleExportExcel = (type) => {
    if (!hasPermission('reports.export')) {
      showToast('ليس لديك صلاحية تصدير البيانات', 'error');
      return;
    }
    // We can directly navigate to the API Excel export route
    const exportUrl = `/api/exports/reports?type=${type}`;
    window.open(exportUrl, '_blank');
    showToast('بدأ تحميل تقرير Excel...', 'info');
  };

  return (
    <Box>
      <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 'bold', color: 'primary.main', mb: 1 }}>
            التقارير والإحصائيات
          </Typography>
          <Typography variant="body1" sx={{ color: 'text.secondary' }}>
            متابعة الحركات المالية، المستودعية ومبيعات الفروع والمؤلفين.
          </Typography>
        </Box>
      </Box>

      {/* Tabs list */}
      <Paper sx={{ mb: 3 }}>
        <Tabs
          value={tab}
          onChange={(e, newTab) => setTab(newTab)}
          variant="scrollable"
          scrollButtons="auto"
          textColor="primary"
          indicatorColor="primary"
        >
          {hasPermission('finance.view') && <Tab value={0} label="الخلاصة المالية" sx={{ whiteSpace: 'nowrap' }} />}
          {hasPermission('finance.view') && <Tab value={1} label="أرصدة المنافذ" sx={{ whiteSpace: 'nowrap' }} />}
          {hasPermission('finance.view') && <Tab value={2} label="مبيعات المحافظات" sx={{ whiteSpace: 'nowrap' }} />}
          {hasPermission('finance.view') && <Tab value={3} label="مبيعات فئات المنافذ" sx={{ whiteSpace: 'nowrap' }} />}
          <Tab value={4} label="حالة المخزون" sx={{ whiteSpace: 'nowrap' }} />
          <Tab value={5} label="مبيعات المؤلفين" sx={{ whiteSpace: 'nowrap' }} />
          <Tab value={6} label="سجل التوريدات" sx={{ whiteSpace: 'nowrap' }} />
          <Tab value={7} label="تحليل مبيعات الكتاب حسب المحافظة" sx={{ whiteSpace: 'nowrap' }} />
        </Tabs>
      </Paper>

      {/* Filter Section */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Grid container spacing={2} alignItems="center">
          {/* Common Date Range Filters */}
          {[0, 1, 2, 3, 6, 7].includes(tab) && (
            <>
              <Grid item xs={12} sm={3}>
                <TextField
                  fullWidth
                  label="تاريخ البدء"
                  type="date"
                  InputLabelProps={{ shrink: true }}
                  InputProps={{ notched: true }}
                  size="small"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </Grid>
              <Grid item xs={12} sm={3}>
                <TextField
                  fullWidth
                  label="تاريخ النهاية"
                  type="date"
                  InputLabelProps={{ shrink: true }}
                  InputProps={{ notched: true }}
                  size="small"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </Grid>
            </>
          )}

          {/* Tab specific filters */}
          {tab === 0 && (
            <Grid item xs={12} sm={3}>
              <FormControl fullWidth size="small">
                <InputLabel>المنفذ</InputLabel>
                <Select
                  value={selectedOutlet}
                  onChange={(e) => setSelectedOutlet(e.target.value)}
                  label="المنفذ"
                >
                  <MenuItem value="">الكل</MenuItem>
                  {outlets.map((o) => (
                    <MenuItem key={o.id} value={o.id}>{o.name}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
          )}

          {[0, 1, 2].includes(tab) && (
            <Grid item xs={12} sm={2}>
              <FormControl fullWidth size="small">
                <InputLabel>فئة المنفذ</InputLabel>
                <Select
                  value={selectedOutletType}
                  onChange={(e) => setSelectedOutletType(e.target.value)}
                  label="فئة المنفذ"
                >
                  <MenuItem value="">الكل</MenuItem>
                  {outletTypes.map((t) => (
                    <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
          )}

          {[0, 1].includes(tab) && (
            <Grid item xs={12} sm={2}>
              <FormControl fullWidth size="small">
                <InputLabel>المحافظة</InputLabel>
                <Select
                  value={selectedGovernorate}
                  onChange={(e) => setSelectedGovernorate(e.target.value)}
                  label="المحافظة"
                >
                  <MenuItem value="">الكل</MenuItem>
                  {EGYPT_GOVERNORATES.map((g) => (
                    <MenuItem key={g} value={g}>{g}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
          )}

          {/* Stock Report Filters */}
          {tab === 4 && (
            <>
              <Grid item xs={12} sm={4}>
                <TextField
                  fullWidth
                  size="small"
                  label="بحث باسم الكتاب أو الرمز"
                  value={stockSearch}
                  onChange={(e) => setStockSearch(e.target.value)}
                />
              </Grid>
              <Grid item xs={12} sm={3}>
                <FormControl fullWidth size="small">
                  <InputLabel>الحالة</InputLabel>
                  <Select value={stockStatus} onChange={(e) => setStockStatus(e.target.value)} label="الحالة">
                    <MenuItem value="">الكل</MenuItem>
                    <MenuItem value="active">نشط</MenuItem>
                    <MenuItem value="disabled">معطل</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
            </>
          )}

          {/* Author Report Filters */}
          {tab === 5 && (
            <>
              <Grid item xs={12} sm={4}>
                <TextField
                  fullWidth
                  size="small"
                  label="بحث باسم المؤلف"
                  value={authorSearch}
                  onChange={(e) => setAuthorSearch(e.target.value)}
                />
              </Grid>
              <Grid item xs={12} sm={3}>
                <FormControl fullWidth size="small">
                  <InputLabel>الحالة</InputLabel>
                  <Select value={authorStatus} onChange={(e) => setAuthorStatus(e.target.value)} label="الحالة">
                    <MenuItem value="">الكل</MenuItem>
                    <MenuItem value="active">نشط</MenuItem>
                    <MenuItem value="disabled">معطل</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
            </>
          )}

          {/* Receipts Report Filters */}
          {tab === 6 && (
            <Grid item xs={12} sm={4}>
              <TextField
                fullWidth
                size="small"
                label="بحث باسم المورد"
                value={receiptSearch}
                onChange={(e) => setReceiptSearch(e.target.value)}
              />
            </Grid>
          )}

          {tab === 7 && (
            <>
              <Grid item xs={12} sm={4}>
                <FormControl fullWidth size="small" required>
                  <InputLabel>اختر الكتاب</InputLabel>
                  <Select value={selectedProduct} label="اختر الكتاب" onChange={(e) => setSelectedProduct(e.target.value)}>
                    <MenuItem value="">اختر كتابًا لعرض الكميات</MenuItem>
                    {productOptions.map((product) => (
                      <MenuItem key={product.id} value={product.id}>{product.title} {product.code ? `(${product.code})` : ''}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={3}>
                <FormControl fullWidth size="small">
                  <InputLabel>فئة المنفذ</InputLabel>
                  <Select value={selectedOutletType} label="فئة المنفذ" onChange={(e) => setSelectedOutletType(e.target.value)}>
                    <MenuItem value="">كل الفئات</MenuItem>
                    {outletTypes.map((type) => <MenuItem key={type.id} value={type.id}>{type.name}</MenuItem>)}
                  </Select>
                </FormControl>
              </Grid>
              <Grid item xs={12} sm={3}>
                <FormControl fullWidth size="small">
                  <InputLabel>المحافظة</InputLabel>
                  <Select value={selectedGovernorate} label="المحافظة" onChange={(e) => setSelectedGovernorate(e.target.value)}>
                    <MenuItem value="">كل المحافظات</MenuItem>
                    {EGYPT_GOVERNORATES.map((g) => <MenuItem key={g} value={g}>{g}</MenuItem>)}
                  </Select>
                </FormControl>
              </Grid>
            </>
          )}

          {/* Actions */}
          <Grid item xs={12} sm={2} sx={{ display: 'flex', gap: 1 }}>
            <Button
              variant="outlined"
              color="inherit"
              size="small"
              startIcon={<ClearIcon />}
              onClick={clearFilters}
              fullWidth
            >
              مسح
            </Button>
          </Grid>
        </Grid>
      </Paper>

      {/* ───── TAB 0: FINANCIAL SUMMARY ───── */}
      <TabPanel value={tab} index={0}>
        <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="h6" sx={{ fontWeight: 'bold' }}>الخلاصة والمركز المالي العام</Typography>
          <Button variant="contained" color="primary" size="small" startIcon={<PrintIcon />} onClick={handlePrintReport}>
            طباعة التقرير
          </Button>
        </Box>
        {summaryLoading ? <LoadingState /> : !summaryData ? <EmptyState title="لا توجد بيانات" /> : (
          <Stack spacing={3}>
            {/* Main Financial Metrics */}
            <Grid container spacing={3}>
              <Grid item xs={12} sm={4}>
                <Card sx={{ bgcolor: '#ebf5fb', borderRight: 6, borderColor: 'primary.main', display: 'flex', alignItems: 'center', p: 2 }}>
                  <TrendingUpIcon color="primary" sx={{ fontSize: 40, mr: 2 }} />
                  <CardContent sx={{ py: 0, '&:last-child': { pb: 0 } }}>
                    <Typography variant="subtitle2" color="text.secondary">إجمالي المبيعات</Typography>
                    <Typography variant="h5" sx={{ fontWeight: 'bold', mt: 0.5 }}>{formatCurrencyEGP(summaryData.totalSales)}</Typography>
                  </CardContent>
                </Card>
              </Grid>

              <Grid item xs={12} sm={4}>
                <Card sx={{ bgcolor: '#e8f8f5', borderRight: 6, borderColor: 'success.main', display: 'flex', alignItems: 'center', p: 2 }}>
                  <PaymentIcon color="success" sx={{ fontSize: 40, mr: 2 }} />
                  <CardContent sx={{ py: 0, '&:last-child': { pb: 0 } }}>
                    <Typography variant="subtitle2" color="text.secondary">المبالغ المسددة</Typography>
                    <Typography variant="h5" sx={{ fontWeight: 'bold', mt: 0.5 }} color="success.main">{formatCurrencyEGP(summaryData.totalPaid)}</Typography>
                  </CardContent>
                </Card>
              </Grid>

              <Grid item xs={12} sm={4}>
                <Card sx={{ bgcolor: '#fdf2e9', borderRight: 6, borderColor: 'warning.main', display: 'flex', alignItems: 'center', p: 2 }}>
                  <WalletIcon color="warning" sx={{ fontSize: 40, mr: 2 }} />
                  <CardContent sx={{ py: 0, '&:last-child': { pb: 0 } }}>
                    <Typography variant="subtitle2" color="text.secondary">المبالغ المتبقية (الديون)</Typography>
                    <Typography variant="h5" sx={{ fontWeight: 'bold', mt: 0.5 }} color="warning.main">{formatCurrencyEGP(summaryData.totalRemaining)}</Typography>
                  </CardContent>
                </Card>
              </Grid>
            </Grid>

            {/* Detailed Supply and Shipment Metrics */}
            <Grid container spacing={3}>
              <Grid item xs={12} sm={3}>
                <Card sx={{ p: 2, textAlign: 'center', bgcolor: '#f8f9f9' }}>
                  <Typography variant="body2" color="text.secondary">مدفوعات موردة (Supplied)</Typography>
                  <Typography variant="h6" sx={{ fontWeight: 'bold', mt: 1, color: 'success.main' }}>{formatCurrencyEGP(summaryData.totalSupplied)}</Typography>
                </Card>
              </Grid>
              <Grid item xs={12} sm={3}>
                <Card sx={{ p: 2, textAlign: 'center', bgcolor: '#f8f9f9' }}>
                  <Typography variant="body2" color="text.secondary">مدفوعات غير موردة (Unsupplied)</Typography>
                  <Typography variant="h6" sx={{ fontWeight: 'bold', mt: 1, color: 'error.main' }}>{formatCurrencyEGP(summaryData.totalUnsupplied)}</Typography>
                </Card>
              </Grid>
              <Grid item xs={12} sm={2}>
                <Card sx={{ p: 2, textAlign: 'center', bgcolor: '#f8f9f9' }}>
                  <Typography variant="body2" color="text.secondary">شحنات مكتملة</Typography>
                  <Typography variant="h6" sx={{ fontWeight: 'bold', mt: 1 }}>{summaryData.countShipped} فاتورة</Typography>
                </Card>
              </Grid>
              <Grid item xs={12} sm={2}>
                <Card sx={{ p: 2, textAlign: 'center', bgcolor: '#f8f9f9' }}>
                  <Typography variant="body2" color="text.secondary">شحنات جزئية</Typography>
                  <Typography variant="h6" sx={{ fontWeight: 'bold', mt: 1, color: 'warning.main' }}>{summaryData.countPartiallyShipped} فاتورة</Typography>
                </Card>
              </Grid>
              <Grid item xs={12} sm={2}>
                <Card sx={{ p: 2, textAlign: 'center', bgcolor: '#f8f9f9' }}>
                  <Typography variant="body2" color="text.secondary">غير مشحون</Typography>
                  <Typography variant="h6" sx={{ fontWeight: 'bold', mt: 1, color: 'error.main' }}>{summaryData.countNotShipped} فاتورة</Typography>
                </Card>
              </Grid>
            </Grid>
          </Stack>
        )}
      </TabPanel>

      {/* ───── TAB 1: OUTLET BALANCES ───── */}
      <TabPanel value={tab} index={1}>
        <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1.5 }}>
          <Typography variant="h6" sx={{ fontWeight: 'bold' }}>أرصدة وذمم الفروع ومنافذ البيع</Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button variant="contained" color="primary" size="small" startIcon={<PrintIcon />} onClick={handlePrintReport}>
              طباعة التقرير
            </Button>
            {hasPermission('reports.export') && (
              <Button variant="contained" color="secondary" size="small" startIcon={<DownloadIcon />} onClick={() => handleExportExcel('balances')}>
                تصدير كملف Excel
              </Button>
            )}
          </Box>
        </Box>
        {balancesOutletLoading ? <LoadingState /> : balancesOutlet.length === 0 ? <EmptyState title="لا توجد بيانات" /> : (
          <TableContainer className="scrollable-table-container" component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell align="right" sx={{ fontWeight: 'bold' }}>المنفذ</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 'bold' }}>فئة المنفذ</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 'bold' }}>المحافظة</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 'bold' }}>سقف الائتمان</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 'bold' }}>إجمالي المبيعات</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 'bold' }}>المسدد</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 'bold' }}>المتبقي</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {balancesOutlet.map((row) => (
                  <TableRow key={row.outletId}>
                    <TableCell align="right">{row.outletName}</TableCell>
                    <TableCell align="right">{row.outletTypeName}</TableCell>
                    <TableCell align="right">{row.governorate}</TableCell>
                    <TableCell align="right">{row.creditLimit ? formatCurrencyEGP(row.creditLimit) : 'مفتوح'}</TableCell>
                    <TableCell align="right">{formatCurrencyEGP(row.totalSales)}</TableCell>
                    <TableCell align="right">{formatCurrencyEGP(row.totalPaid)}</TableCell>
                    <TableCell align="right" sx={{ color: row.remainingAmount > 0 ? 'warning.main' : 'inherit', fontWeight: row.remainingAmount > 0 ? 'bold' : 'normal' }}>
                      {formatCurrencyEGP(row.remainingAmount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow sx={{ bgcolor: '#f1f5f9' }}>
                  <TableCell align="right" colSpan={4} sx={{ fontWeight: 'bold', fontSize: '0.875rem' }}>الإجمالي</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 'bold', fontSize: '0.875rem' }}>{formatCurrencyEGP(balancesOutlet.reduce((s, r) => s + (r.totalSales || 0), 0))}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 'bold', fontSize: '0.875rem' }}>{formatCurrencyEGP(balancesOutlet.reduce((s, r) => s + (r.totalPaid || 0), 0))}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 'bold', fontSize: '0.875rem', color: 'warning.main' }}>{formatCurrencyEGP(balancesOutlet.reduce((s, r) => s + (r.remainingAmount || 0), 0))}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </TableContainer>
        )}
      </TabPanel>

      {/* ───── TAB 2: BALANCES BY GOVERNORATE ───── */}
      <TabPanel value={tab} index={2}>
        <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="h6" sx={{ fontWeight: 'bold' }}>مبيعات المحافظات</Typography>
          <Button variant="contained" color="primary" size="small" startIcon={<PrintIcon />} onClick={handlePrintReport}>
            طباعة التقرير
          </Button>
        </Box>
        {balancesGovLoading ? <LoadingState /> : balancesGov.length === 0 ? <EmptyState title="لا توجد بيانات" /> : (
          <TableContainer className="scrollable-table-container" component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell align="right" sx={{ fontWeight: 'bold' }}>المحافظة</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 'bold' }}>إجمالي المبيعات</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 'bold' }}>المسدد</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 'bold' }}>المتبقي (الذمم المفتوحة)</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {balancesGov.map((row, idx) => (
                  <TableRow key={idx}>
                    <TableCell align="right">{row.governorate || 'غير مصنف'}</TableCell>
                    <TableCell align="right">{formatCurrencyEGP(row.totalSales)}</TableCell>
                    <TableCell align="right">{formatCurrencyEGP(row.totalPaid)}</TableCell>
                    <TableCell align="right">{formatCurrencyEGP(row.remainingAmount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow sx={{ bgcolor: '#f1f5f9' }}>
                  <TableCell align="right" sx={{ fontWeight: 'bold', fontSize: '0.875rem' }}>الإجمالي</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 'bold', fontSize: '0.875rem' }}>{formatCurrencyEGP(balancesGov.reduce((s, r) => s + (r.totalSales || 0), 0))}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 'bold', fontSize: '0.875rem' }}>{formatCurrencyEGP(balancesGov.reduce((s, r) => s + (r.totalPaid || 0), 0))}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 'bold', fontSize: '0.875rem', color: 'warning.main' }}>{formatCurrencyEGP(balancesGov.reduce((s, r) => s + (r.remainingAmount || 0), 0))}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </TableContainer>
        )}
      </TabPanel>

      {/* ───── TAB 3: BALANCES BY OUTLET TYPE ───── */}
      <TabPanel value={tab} index={3}>
        <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="h6" sx={{ fontWeight: 'bold' }}>مبيعات فئات منافذ البيع</Typography>
          <Button variant="contained" color="primary" size="small" startIcon={<PrintIcon />} onClick={handlePrintReport}>
            طباعة التقرير
          </Button>
        </Box>
        {balancesTypeLoading ? <LoadingState /> : balancesType.length === 0 ? <EmptyState title="لا توجد بيانات" /> : (
          <TableContainer className="scrollable-table-container" component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell align="right" sx={{ fontWeight: 'bold' }}>فئة المنفذ</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 'bold' }}>إجمالي المبيعات</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 'bold' }}>المسدد</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 'bold' }}>المتبقي</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {balancesType.map((row) => (
                  <TableRow key={row.outletTypeId}>
                    <TableCell align="right">{row.outletTypeName}</TableCell>
                    <TableCell align="right">{formatCurrencyEGP(row.totalSales)}</TableCell>
                    <TableCell align="right">{formatCurrencyEGP(row.totalPaid)}</TableCell>
                    <TableCell align="right">{formatCurrencyEGP(row.remainingAmount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow sx={{ bgcolor: '#f1f5f9' }}>
                  <TableCell align="right" sx={{ fontWeight: 'bold', fontSize: '0.875rem' }}>الإجمالي</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 'bold', fontSize: '0.875rem' }}>{formatCurrencyEGP(balancesType.reduce((s, r) => s + (r.totalSales || 0), 0))}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 'bold', fontSize: '0.875rem' }}>{formatCurrencyEGP(balancesType.reduce((s, r) => s + (r.totalPaid || 0), 0))}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 'bold', fontSize: '0.875rem', color: 'warning.main' }}>{formatCurrencyEGP(balancesType.reduce((s, r) => s + (r.remainingAmount || 0), 0))}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </TableContainer>
        )}
      </TabPanel>

      {/* ───── TAB 4: STOCK REPORT ───── */}
      <TabPanel value={tab} index={4}>
        <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1.5 }}>
          <Typography variant="h6" sx={{ fontWeight: 'bold' }}>تقرير المخزون التفصيلي للكتب والمنتجات</Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button variant="contained" color="primary" size="small" startIcon={<PrintIcon />} onClick={handlePrintReport}>
              طباعة التقرير
            </Button>
            {hasPermission('reports.export') && (
              <Button variant="contained" color="secondary" size="small" startIcon={<DownloadIcon />} onClick={() => handleExportExcel('stock')}>
                تصدير كملف Excel
              </Button>
            )}
          </Box>
        </Box>
        {!stockLoading && stockData.some(row => Number(row.shippingSupplyGap || 0) > 0) && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            عجز الشحن السابق المسجل يساوي{' '}
            {stockData.reduce((sum, row) => sum + Number(row.shippingSupplyGap || 0), 0).toLocaleString()}{' '}
            نسخة. هذه نسخ خرجت في شحنات سابقة فوق التوريد المسجل، وليست رصيدًا متاحًا.
          </Alert>
        )}
        {stockLoading ? <LoadingState /> : stockData.length === 0 ? <EmptyState title="لا توجد بيانات" /> : (
          <TableContainer className="scrollable-table-container" component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell align="right" sx={{ fontWeight: 'bold' }}>رمز الكتاب (SKU)</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 'bold' }}>العنوان</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 'bold' }}>التصنيف</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 'bold' }}>صافي الوارد</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 'bold' }}>صافي المبيعات</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 'bold' }}>المشحون</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 'bold' }}>المتبقي من المبيعات</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 'bold' }}>رصيد المخزون</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 'bold' }}>رصيد الشحن المسجل</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 'bold' }}>المتاح للشحن</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 'bold' }}>الحالة</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {stockData.map((row) => (
                  <TableRow key={row.productId}>
                    <TableCell align="right">{row.productCode}</TableCell>
                    <TableCell align="right">{row.productTitle}</TableCell>
                    <TableCell align="right">{row.category || 'غير محدد'}</TableCell>
                    <TableCell align="right">{Number(row.netReceived ?? row.totalReceived).toLocaleString()}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 'bold' }}>{Number(row.netSales || 0).toLocaleString()}</TableCell>
                    <TableCell align="right">{Number(row.totalShipped || 0).toLocaleString()}</TableCell>
                    <TableCell align="right">{Number(row.remainingToShip ?? row.remainingToFulfill ?? 0).toLocaleString()}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 'bold', color: row.stockBalance < 0 ? 'error.main' : 'success.main' }}>
                      {Number(row.stockBalance ?? row.currentStock ?? 0).toLocaleString()}
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 'bold', color: Number(row.shippableStockBalance ?? row.rawAvailableToShip ?? 0) < 0 ? 'error.main' : 'success.main' }}>
                      {Number(row.shippableStockBalance ?? row.rawAvailableToShip ?? 0).toLocaleString()}
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 'bold', color: row.availableToShip > 0 ? 'success.main' : 'warning.main' }}>
                      {Number(row.availableToShip || 0).toLocaleString()}
                    </TableCell>
                    <TableCell align="right">{row.status === 'active' ? 'نشط' : 'غير نشط'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </TabPanel>

      {/* ───── TAB 5: AUTHORS REPORT ───── */}
      <TabPanel value={tab} index={5}>
        <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1.5 }}>
          <Typography variant="h6" sx={{ fontWeight: 'bold' }}>تقرير مبيعات وأرصدة المؤلفين</Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button variant="contained" color="primary" size="small" startIcon={<PrintIcon />} onClick={handlePrintReport}>
              طباعة التقرير
            </Button>
            {hasPermission('reports.export') && (
              <Button variant="contained" color="secondary" size="small" startIcon={<DownloadIcon />} onClick={() => handleExportExcel('authors')}>
                تصدير كملف Excel
              </Button>
            )}
          </Box>
        </Box>
        {authorLoading ? <LoadingState /> : authorData.length === 0 ? <EmptyState title="لا توجد بيانات" /> : (
          <TableContainer className="scrollable-table-container" component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell align="right" sx={{ fontWeight: 'bold' }}>المؤلف</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 'bold' }}>حالة الحساب</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 'bold' }}>عدد العناوين</TableCell>
                  {hasPermission('finance.view') && <TableCell align="right" sx={{ fontWeight: 'bold' }}>مبيعات كلي</TableCell>}
                  <TableCell align="right" sx={{ fontWeight: 'bold' }}>إجمالي النسخ المباعة</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 'bold' }}>المخزون المتوفر للعناوين</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {authorData.map((row) => (
                  <TableRow key={row.authorId}>
                    <TableCell align="right">{row.authorName}</TableCell>
                    <TableCell align="right">
                      {row.status === 'active' ? (
                        <Alert severity="success" icon={false} sx={{ py: 0, px: 1, display: 'inline-flex' }}>نشط</Alert>
                      ) : (
                        <Alert severity="error" icon={false} sx={{ py: 0, px: 1, display: 'inline-flex' }}>معطل</Alert>
                      )}
                    </TableCell>
                    <TableCell align="right">{row.totalBooks}</TableCell>
                    {hasPermission('finance.view') && <TableCell align="right">{formatCurrencyEGP(row.totalSales)}</TableCell>}
                    <TableCell align="right">{row.totalCopiesSold.toLocaleString()} نسخة</TableCell>
                    <TableCell align="right">{row.currentStock.toLocaleString()} نسخة</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </TabPanel>

      {/* ───── TAB 6: RECEIPTS REPORT ───── */}
      <TabPanel value={tab} index={6}>
        <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1.5 }}>
          <Typography variant="h6" sx={{ fontWeight: 'bold' }}>سجل توريدات الموردين وكمياتها</Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button variant="contained" color="primary" size="small" startIcon={<PrintIcon />} onClick={handlePrintReport}>
              طباعة التقرير
            </Button>
            {hasPermission('reports.export') && (
              <Button variant="contained" color="secondary" size="small" startIcon={<DownloadIcon />} onClick={() => handleExportExcel('receipts')}>
                تصدير كملف Excel
              </Button>
            )}
          </Box>
        </Box>
        {receiptLoading ? <LoadingState /> : receiptData.length === 0 ? <EmptyState title="لا توجد بيانات" /> : (
          <TableContainer className="scrollable-table-container" component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell align="right" sx={{ fontWeight: 'bold' }}>اسم المورد</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 'bold' }}>عدد حركات التوريد</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 'bold' }}>إجمالي الكمية الموردة</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 'bold' }}>مرتجع المورد</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 'bold' }}>صافي الكمية</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {receiptData.map((row, idx) => (
                  <TableRow key={idx}>
                    <TableCell align="right">{row.supplierName}</TableCell>
                    <TableCell align="right">{row.totalReceipts}</TableCell>
                    <TableCell align="right">{row.totalQuantity.toLocaleString()} نسخة</TableCell>
                    <TableCell align="right">{Number(row.totalReturnedQuantity || 0).toLocaleString()} نسخة</TableCell>
                    <TableCell align="right">{Number(row.netQuantity ?? row.totalQuantity).toLocaleString()} نسخة</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </TabPanel>

      {/* ───── TAB 7: PRODUCT SALES BY GOVERNORATE ───── */}
      <TabPanel value={tab} index={7}>
        <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1.5 }}>
          <Typography variant="h6" sx={{ fontWeight: 'bold' }}>تحليل كميات الكتاب حسب المحافظة</Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button variant="contained" color="primary" size="small" startIcon={<PrintIcon />} onClick={handlePrintReport}>طباعة التقرير</Button>
            {hasPermission('reports.export') && selectedProduct && (
              <Button variant="contained" color="secondary" size="small" startIcon={<DownloadIcon />} onClick={() => window.open(`/api/exports/reports?type=product-sales&productId=${selectedProduct}&startDate=${startDate}&endDate=${endDate}&governorate=${encodeURIComponent(selectedGovernorate)}`, '_blank')}>تصدير Excel</Button>
            )}
          </Box>
        </Box>
        {!selectedProduct ? (
          <EmptyState title="اختر كتابًا أولًا" description="حدد كتابًا من الفلاتر لعرض إجمالي الكميات وحالة السداد والشحن حسب المحافظة." />
        ) : productSalesLoading ? <LoadingState /> : productSales.length === 0 ? <EmptyState title="لا توجد مبيعات" /> : (
          <TableContainer className="scrollable-table-container" component={Paper}>
            <Table size="small">
              <TableHead><TableRow>
                <TableCell align="right" sx={{ fontWeight: 'bold' }}>المحافظة</TableCell>
                <TableCell align="right" sx={{ fontWeight: 'bold' }}>المنافذ</TableCell>
                <TableCell align="right" sx={{ fontWeight: 'bold' }}>الفواتير</TableCell>
                <TableCell align="right" sx={{ fontWeight: 'bold' }}>الإجمالي</TableCell>
                <TableCell align="right" sx={{ fontWeight: 'bold' }}>المسعّر</TableCell>
                <TableCell align="right" sx={{ fontWeight: 'bold' }}>المجاني</TableCell>
                <TableCell align="right" sx={{ fontWeight: 'bold' }}>المرتجع</TableCell>
                <TableCell align="right" sx={{ fontWeight: 'bold' }}>الصافي</TableCell>
                <TableCell align="right" sx={{ fontWeight: 'bold' }}>المشحون</TableCell>
                <TableCell align="right" sx={{ fontWeight: 'bold' }}>المتبقي للشحن</TableCell>
                <TableCell align="right" sx={{ fontWeight: 'bold' }}>مدفوع</TableCell>
                <TableCell align="right" sx={{ fontWeight: 'bold' }}>جزئي</TableCell>
                <TableCell align="right" sx={{ fontWeight: 'bold' }}>غير مدفوع</TableCell>
              </TableRow></TableHead>
              <TableBody>{productSales.map((row) => <TableRow key={row.governorate}>
                <TableCell align="right">{row.governorate}</TableCell>
                <TableCell align="right">{row.outletCount}</TableCell>
                <TableCell align="right">{row.invoiceCount}</TableCell>
                <TableCell align="right">{Number(row.totalQuantity).toLocaleString()}</TableCell>
                <TableCell align="right">{Number(row.billableQuantity).toLocaleString()}</TableCell>
                <TableCell align="right">{Number(row.freeQuantity).toLocaleString()}</TableCell>
                <TableCell align="right">{Number(row.returnedQuantity).toLocaleString()}</TableCell>
                <TableCell align="right" sx={{ fontWeight: 'bold' }}>{Number(row.netQuantity).toLocaleString()}</TableCell>
                <TableCell align="right">{Number(row.shippedQuantity).toLocaleString()}</TableCell>
                <TableCell align="right">{Number(row.remainingToShip).toLocaleString()}</TableCell>
                <TableCell align="right" sx={{ color: 'success.main' }}>{Number(row.paidQuantity).toLocaleString()}</TableCell>
                <TableCell align="right" sx={{ color: 'warning.main' }}>{Number(row.partiallyPaidQuantity).toLocaleString()}</TableCell>
                <TableCell align="right" sx={{ color: 'error.main' }}>{Number(row.unpaidQuantity).toLocaleString()}</TableCell>
              </TableRow>)}</TableBody>
              <TableFooter>
                <TableRow sx={{ bgcolor: '#f1f5f9' }}>
                  <TableCell align="right" sx={{ fontWeight: 'bold' }}>الإجمالي</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 'bold' }}>{productSales.reduce((s, r) => s + (r.outletCount || 0), 0).toLocaleString()}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 'bold' }}>{productSales.reduce((s, r) => s + (r.invoiceCount || 0), 0).toLocaleString()}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 'bold' }}>{productSales.reduce((s, r) => s + Number(r.totalQuantity || 0), 0).toLocaleString()}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 'bold' }}>{productSales.reduce((s, r) => s + Number(r.billableQuantity || 0), 0).toLocaleString()}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 'bold' }}>{productSales.reduce((s, r) => s + Number(r.freeQuantity || 0), 0).toLocaleString()}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 'bold' }}>{productSales.reduce((s, r) => s + Number(r.returnedQuantity || 0), 0).toLocaleString()}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 'bold' }}>{productSales.reduce((s, r) => s + Number(r.netQuantity || 0), 0).toLocaleString()}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 'bold' }}>{productSales.reduce((s, r) => s + Number(r.shippedQuantity || 0), 0).toLocaleString()}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 'bold' }}>{productSales.reduce((s, r) => s + Number(r.remainingToShip || 0), 0).toLocaleString()}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 'bold', color: 'success.main' }}>{productSales.reduce((s, r) => s + Number(r.paidQuantity || 0), 0).toLocaleString()}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 'bold', color: 'warning.main' }}>{productSales.reduce((s, r) => s + Number(r.partiallyPaidQuantity || 0), 0).toLocaleString()}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 'bold', color: 'error.main' }}>{productSales.reduce((s, r) => s + Number(r.unpaidQuantity || 0), 0).toLocaleString()}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </TableContainer>
        )}
      </TabPanel>

      <Snackbar open={!!toastMsg} autoHideDuration={4000} onClose={() => setToastMsg('')} anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}>
        <Alert onClose={() => setToastMsg('')} severity={toastSeverity} sx={{ width: '100%' }}>{toastMsg}</Alert>
      </Snackbar>
    </Box>
  );
};

export default Reports;
