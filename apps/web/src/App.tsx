import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  AppBar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Container,
  Divider,
  Drawer,
  FormControl,
  IconButton,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TableContainer,
  Tabs,
  TextField,
  Toolbar,
  Tooltip,
  Typography,
} from '@mui/material';

type Locale = 'ar' | 'en';
type Direction = 'rtl' | 'ltr';
type JsonRecord = Record<string, unknown>;
type Order = JsonRecord & {
  id: string;
  orderNumber?: string;
  externalOrderId?: string;
  origin?: string;
  remoteStatus?: string;
  localStatus?: string;
  exportState?: string;
  currency?: string;
  grandTotalMinor?: string;
  billing?: JsonRecord;
  shipping?: JsonRecord;
  lines?: readonly JsonRecord[];
  refunds?: readonly JsonRecord[];
};
type QueryResponse = { items: Order[]; nextCursor: string | null; hasMore: boolean };
type OrderResponse = { order: Order };
type DocumentTemplate = {
  id: string;
  name: string;
  format: 'a4' | 'a5' | 'thermal-80mm' | 'label-100x150mm';
  locale: 'ar-EG' | 'en-US';
  direction: Direction;
  version: number;
  body: string;
  companyName: string;
  companyAddress: string | null;
  footerText: string | null;
  active: boolean;
};

const analyticsMetricKeys = [
  'grossSalesMinor',
  'discountMinor',
  'netMerchandiseMinor',
  'shippingCollectedMinor',
  'taxMinor',
  'refundsMinor',
  'collectedRevenueMinor',
  'cogsMinor',
  'actualShippingCostMinor',
  'paymentFeesMinor',
  'returnCostMinor',
  'contributionProfitMinor',
] as const;
type AnalyticsMetricKey = (typeof analyticsMetricKeys)[number];
type AnalyticsSource = 'woo' | 'manual' | 'combined';
type AnalyticsFilterState = {
  source: AnalyticsSource;
  from: string;
  to: string;
  store: string;
  status: string;
  shippingMethod: string;
  product: string;
  category: string;
  author: string;
};
type AnalyticsTotals = Record<AnalyticsMetricKey, string>;
type AnalyticsDefinition = {
  key: AnalyticsMetricKey;
  label: string;
  formula: string;
  excludedStatuses: string[];
};
type AnalyticsCurrency = {
  currency: string;
  orderCount: number;
  lineCount: number;
  totals: AnalyticsTotals;
};
type AnalyticsSummary = {
  source: AnalyticsSource;
  from: string | null;
  to: string | null;
  excludedStatuses: string[];
  metricsVersion: number;
  definitions: AnalyticsDefinition[];
  currencies: AnalyticsCurrency[];
  freshness?: { lastRebuiltAt: string | null };
  costCoverage?: {
    coveredLines: number;
    totalLines: number;
    percentage: number | null;
    scope?: 'account';
  };
};
type AnalyticsTimeseriesItem = {
  date: string;
  currency: string;
  source: Exclude<AnalyticsSource, 'combined'>;
  orderCount: number;
  lineCount: number;
  totals: AnalyticsTotals;
};
type AnalyticsBreakdownItem = {
  key: string;
  currency: string;
  orderCount: number;
  lineCount: number;
  totals: AnalyticsTotals;
};
type AnalyticsData = {
  summary: AnalyticsSummary;
  timeseries: AnalyticsTimeseriesItem[];
  breakdown: AnalyticsBreakdownItem[];
};

const copy = {
  ar: {
    app: 'Woo Ops',
    orders: 'إدارة الطلبات',
    subtitle: 'بحث وتشغيل الطلبات من كل المصادر في مكان واحد',
    search: 'ابحث برقم الطلب أو العميل أو SKU أو الهاتف',
    searchButton: 'بحث',
    status: 'الحالة',
    all: 'الكل',
    processing: 'قيد التجهيز',
    completed: 'مكتمل',
    refresh: 'تحديث',
    columns: 'الأعمدة',
    details: 'تفاصيل الطلب',
    close: 'إغلاق',
    remote: 'بيانات المنصة',
    localFacts: 'بيانات التشغيل المحلية',
    summary: 'الملخص',
    items: 'المنتجات',
    customer: 'العميل والعناوين',
    finance: 'الدفع والشحن والضرائب',
    workflow: 'التشغيل المحلي',
    history: 'المزامنة والتدقيق',
    raw: 'بيانات المصدر',
    noOrders: 'لا توجد طلبات مطابقة',
    noConnection: 'لم يتم الاتصال بالخادم بعد',
    noData: 'لا توجد بيانات متاحة',
    loading: 'جارٍ التحميل',
    loadMore: 'تحميل المزيد',
    language: 'English',
    switchToLtr: 'التبديل إلى LTR',
    switchToRtl: 'التبديل إلى RTL',
    orderNumber: 'رقم الطلب',
    source: 'المصدر',
    sourceId: 'معرّف المصدر',
    store: 'المتجر',
    remoteStatus: 'حالة المنصة',
    localStatus: 'الحالة المحلية',
    total: 'الإجمالي',
    exportState: 'حالة التصدير',
    originWoo: 'WooCommerce',
    originManual: 'يدوي',
    never: 'لم يُصدّر',
    platformOnly: 'هذه البيانات مملوكة للمنصة وتُعرض للقراءة فقط.',
    created: 'تاريخ الإنشاء',
    updated: 'آخر تحديث',
    channel: 'القناة',
    pos: 'نقطة البيع',
    externalCustomer: 'معرّف العميل الخارجي',
    billing: 'عنوان الفوترة',
    shippingAddress: 'عنوان الشحن',
    email: 'البريد الإلكتروني',
    phone: 'الهاتف',
    payment: 'الدفع',
    shippingMethod: 'الشحن',
    taxes: 'الضرائب والرسوم',
    refunds: 'المرتجعات',
    method: 'الطريقة',
    paymentStatus: 'حالة الدفع',
    collected: 'المحصّل',
    shippingCollected: 'الشحن المحصّل',
    actualShipping: 'تكلفة الشحن الفعلية',
    merchandise: 'صافي المنتجات',
    discount: 'الخصم',
    tax: 'الضريبة',
    fees: 'الرسوم',
    refund: 'المرتجع',
    quantity: 'الكمية',
    sku: 'SKU',
    subtotal: 'الإجمالي قبل الخصم',
    lineTotal: 'إجمالي السطر',
    assignee: 'المسؤول',
    tags: 'الوسوم',
    notes: 'الملاحظات',
    syncPolicy: 'سياسة المزامنة',
    inventoryPolicy: 'سياسة المخزون',
    syncEvents: 'أحداث المزامنة',
    exports: 'التصديرات',
    documents: 'المستندات',
    audit: 'سجل التدقيق',
    restricted: 'البيانات الخام محمية وتحتاج صلاحية مخصصة.',
    errors: 'تعذر تحميل الطلبات، يمكنك المحاولة مرة أخرى',
    manualOrders: '\u0625\u0646\u0634\u0627\u0621 \u0637\u0644\u0628 \u064a\u062f\u0648\u064a',
    manualTitle: '\u0637\u0644\u0628 \u064a\u062f\u0648\u064a \u0645\u062d\u0644\u064a',
    localOnly:
      '\u0645\u062d\u0644\u064a \u0641\u0642\u0637: \u0644\u0627 \u064a\u0645\u0633 WooCommerce \u0623\u0648 \u0627\u0644\u0645\u062e\u0632\u0648\u0646',
    customerName: '\u0627\u0633\u0645 \u0627\u0644\u0639\u0645\u064a\u0644',
    customerEmail: '\u0627\u0644\u0628\u0631\u064a\u062f',
    customerPhone: '\u0627\u0644\u0647\u0627\u062a\u0641',
    currency: '\u0627\u0644\u0639\u0645\u0644\u0629',
    productName: '\u0627\u0633\u0645 \u0627\u0644\u0645\u0646\u062a\u062c',
    productSku: 'SKU',
    unitPriceMinor:
      '\u0633\u0639\u0631 \u0627\u0644\u0648\u062d\u062f\u0629 \u0628\u0627\u0644\u0642\u0631\u0648\u0634',
    shippingMinor: '\u0627\u0644\u0634\u062d\u0646 \u0628\u0627\u0644\u0642\u0631\u0648\u0634',
    discountMinor: '\u0627\u0644\u062e\u0635\u0645 \u0628\u0627\u0644\u0642\u0631\u0648\u0634',
    taxMinor:
      '\u0627\u0644\u0636\u0631\u064a\u0628\u0629 \u0628\u0627\u0644\u0642\u0631\u0648\u0634',
    feesMinor: '\u0627\u0644\u0631\u0633\u0648\u0645 \u0628\u0627\u0644\u0642\u0631\u0648\u0634',
    localStatusInput:
      '\u0627\u0644\u062d\u0627\u0644\u0629 \u0627\u0644\u0645\u062d\u0644\u064a\u0629',
    tagsInput:
      '\u0627\u0644\u0648\u0633\u0648\u0645 \u0645\u0641\u0635\u0648\u0644\u0629 \u0628\u0641\u0648\u0627\u0635\u0644',
    notesInput: '\u0645\u0644\u0627\u062d\u0638\u0627\u062a',
    address: '\u0627\u0644\u0639\u0646\u0648\u0627\u0646',
    saveManual: '\u062d\u0641\u0638 \u0627\u0644\u0637\u0644\u0628',
    cancel: '\u0625\u0644\u063a\u0627\u0621',
    invalidManual:
      '\u062a\u062d\u0642\u0642 \u0645\u0646 \u062d\u0642\u0648\u0644 \u0627\u0644\u0637\u0644\u0628',
    createdManual:
      '\u062a\u0645 \u062d\u0641\u0638 \u0627\u0644\u0637\u0644\u0628 \u0627\u0644\u0645\u062d\u0644\u064a',
    documentsNav: '\u0627\u0644\u0645\u0633\u062a\u0646\u062f\u0627\u062a',
    documentsTitle:
      '\u0642\u0648\u0627\u0644\u0628 \u0627\u0644\u0645\u0633\u062a\u0646\u062f\u0627\u062a \u0648\u0627\u0644\u0637\u0628\u0627\u0639\u0629',
    documentTemplateName: '\u0627\u0633\u0645 \u0627\u0644\u0642\u0627\u0644\u0628',
    documentCompany: '\u0627\u0633\u0645 \u0627\u0644\u0634\u0631\u0643\u0629',
    documentBody:
      '\u0646\u0635 \u0627\u0644\u0642\u0627\u0644\u0628 \u0627\u0644\u0622\u0645\u0646',
    documentFormat: '\u0627\u0644\u0645\u0642\u0627\u0633',
    saveTemplate: '\u062d\u0641\u0638 \u0627\u0644\u0642\u0627\u0644\u0628',
    previewDocument:
      '\u0645\u0639\u0627\u064a\u0646\u0629 \u0627\u0644\u0645\u0633\u062a\u0646\u062f',
    printDocument: '\u0637\u0628\u0627\u0639\u0629',
    templateSafety:
      '\u064a\u0645\u0643\u0646 \u0627\u0633\u062a\u062e\u062f\u0627\u0645 tokens \u0645\u062d\u062f\u062f\u0629 \u0641\u0642\u0637\u060c \u0648\u0644\u0627 \u064a\u064f\u0633\u0645\u062d HTML \u0623\u0648 \u062c\u0644\u0628 \u0634\u0628\u0643\u064a.',
    templateTokens: 'order.number, customer.name, shipping.address, order.totalMinor',
    noTemplates:
      '\u0644\u0627 \u062a\u0648\u062c\u062f \u0642\u0648\u0627\u0644\u0628 \u0628\u0639\u062f',
    analyticsNav: '\u0627\u0644\u062a\u062d\u0644\u064a\u0644\u0627\u062a',
    analyticsTitle:
      '\u0644\u0648\u062d\u0629 \u062a\u062d\u0644\u064a\u0644 \u0627\u0644\u0645\u0628\u064a\u0639\u0627\u062a',
    analyticsSubtitle:
      '\u0642\u0631\u0627\u0621\u0629 \u0648\u0627\u0636\u062d\u0629 \u0644\u0644\u0625\u064a\u0631\u0627\u062f \u0648\u0627\u0644\u0631\u0628\u062d \u0645\u0646 \u0643\u0644 \u0627\u0644\u0645\u0635\u0627\u062f\u0631',
    analyticsSource: '\u0645\u0635\u062f\u0631 \u0627\u0644\u0628\u064a\u0627\u0646\u0627\u062a',
    allSources: '\u0643\u0644 \u0627\u0644\u0645\u0635\u0627\u062f\u0631',
    sourceWoo: 'WooCommerce',
    sourceManual: '\u064a\u062f\u0648\u064a',
    sourceCombined: '\u0645\u062c\u0645\u0639',
    fromDate: '\u0645\u0646 \u062a\u0627\u0631\u064a\u062e',
    toDate: '\u0625\u0644\u0649 \u062a\u0627\u0631\u064a\u062e',
    storeFilter:
      '\u0627\u0644\u0645\u062a\u062c\u0631 / \u0645\u0639\u0631\u0641 \u0627\u0644\u0631\u0628\u0637',
    statusFilter: '\u062d\u0627\u0644\u0629 \u0627\u0644\u0637\u0644\u0628',
    shippingFilter: '\u0637\u0631\u064a\u0642\u0629 \u0627\u0644\u0634\u062d\u0646',
    productFilter: '\u0627\u0644\u0645\u0646\u062a\u062c / SKU',
    categoryFilter: '\u0627\u0644\u062a\u0635\u0646\u064a\u0641',
    authorFilter: '\u0627\u0644\u0645\u0624\u0644\u0641',
    applyFilters: '\u062a\u0637\u0628\u064a\u0642 \u0627\u0644\u0641\u0644\u0627\u062a\u0631',
    resetFilters: '\u0625\u0639\u0627\u062f\u0629 \u0636\u0628\u0637',
    revenue: '\u0627\u0644\u0625\u064a\u0631\u0627\u062f \u0627\u0644\u0645\u062d\u0635\u0644',
    profit: '\u0631\u0628\u062d \u0627\u0644\u0645\u0633\u0627\u0647\u0645\u0629',
    ordersCount: '\u0627\u0644\u0637\u0644\u0628\u0627\u062a',
    linesCount: '\u0627\u0644\u0633\u0637\u0648\u0631',
    freshness: '\u062d\u062f\u0627\u062b\u0629 \u0627\u0644\u0628\u064a\u0627\u0646\u0627\u062a',
    lastRebuilt: '\u0622\u062e\u0631 \u0625\u0639\u0627\u062f\u0629 \u0628\u0646\u0627\u0621',
    costCoverage: '\u062a\u063a\u0637\u064a\u0629 \u0627\u0644\u062a\u0643\u0627\u0644\u064a\u0641',
    coverageUnavailable:
      '\u0644\u0645 \u062a\u062a\u0645 \u062a\u0633\u0639\u064a\u0631 \u0643\u0644 \u0627\u0644\u0633\u0637\u0648\u0631 \u0628\u0639\u062f',
    coverageScope:
      '\u0645\u0646 \u0644\u0642\u0637\u0627\u062a \u0627\u0644\u062d\u0633\u0627\u0628',
    trend: '\u0627\u0644\u0627\u062a\u062c\u0627\u0647 \u0627\u0644\u0632\u0645\u0646\u064a',
    breakdown: '\u0627\u0644\u062a\u0648\u0632\u064a\u0639',
    breakdownDimension: '\u0627\u0644\u062a\u0648\u0632\u064a\u0639 \u062d\u0633\u0628',
    dimensionSource: '\u0627\u0644\u0645\u0635\u062f\u0631',
    dimensionStore: '\u0627\u0644\u0645\u062a\u062c\u0631',
    dimensionStatus: '\u0627\u0644\u062d\u0627\u0644\u0629',
    dimensionShipping: '\u0627\u0644\u0634\u062d\u0646',
    dimensionProduct: '\u0627\u0644\u0645\u0646\u062a\u062c',
    dimensionCategory: '\u0627\u0644\u062a\u0635\u0646\u064a\u0641',
    dimensionAuthor: '\u0627\u0644\u0645\u0624\u0644\u0641',
    formulas:
      '\u0627\u0644\u0635\u064a\u063a \u0648\u0627\u0644\u0627\u0633\u062a\u0628\u0639\u0627\u062f',
    metrics: '\u0627\u0644\u0645\u0624\u0634\u0631',
    formula: '\u0627\u0644\u0635\u064a\u063a\u0629',
    excludedStatuses:
      '\u0627\u0644\u062d\u0627\u0644\u0627\u062a \u0627\u0644\u0645\u0633\u062a\u0628\u0639\u062f\u0629',
    currencySeparated:
      '\u0627\u0644\u0639\u0645\u0644\u0627\u062a \u0645\u0639\u0631\u0648\u0636\u0629 \u0643\u0644 \u0645\u0646\u0647\u0627 \u0628\u0645\u0641\u0631\u062f\u0647\u0627',
    noAnalytics:
      '\u0644\u0627 \u062a\u0648\u062c\u062f \u0628\u064a\u0627\u0646\u0627\u062a \u0645\u0637\u0627\u0628\u0642\u0629 \u0644\u0647\u0630\u0647 \u0627\u0644\u0641\u0644\u0627\u062a\u0631',
    analyticsError:
      '\u062a\u0639\u0630\u0631 \u062a\u062d\u0645\u064a\u0644 \u0627\u0644\u062a\u062d\u0644\u064a\u0644\u0627\u062a',
  },
  en: {
    app: 'Woo Ops',
    orders: 'Orders workspace',
    subtitle: 'Search and operate orders from every source in one place',
    search: 'Search order number, customer, SKU or phone',
    searchButton: 'Search',
    status: 'Status',
    all: 'All',
    processing: 'Processing',
    completed: 'Completed',
    refresh: 'Refresh',
    columns: 'Columns',
    details: 'Order details',
    close: 'Close',
    remote: 'Platform facts',
    localFacts: 'Local operations',
    summary: 'Summary',
    items: 'Items',
    customer: 'Customer & addresses',
    finance: 'Payment, shipping & tax',
    workflow: 'Local workflow',
    history: 'Sync & audit',
    raw: 'Source data',
    noOrders: 'No matching orders',
    noConnection: 'The server is not connected yet',
    noData: 'No data available',
    loading: 'Loading',
    loadMore: 'Load more',
    language: 'العربية',
    switchToLtr: 'Switch to LTR',
    switchToRtl: 'Switch to RTL',
    orderNumber: 'Order number',
    source: 'Source',
    sourceId: 'Source ID',
    store: 'Store',
    remoteStatus: 'Platform status',
    localStatus: 'Local status',
    total: 'Total',
    exportState: 'Export state',
    originWoo: 'WooCommerce',
    originManual: 'Manual',
    never: 'Not exported',
    platformOnly: 'These facts belong to the platform and are read-only.',
    created: 'Created',
    updated: 'Updated',
    channel: 'Channel',
    pos: 'POS',
    externalCustomer: 'External customer ID',
    billing: 'Billing address',
    shippingAddress: 'Shipping address',
    email: 'Email',
    phone: 'Phone',
    payment: 'Payment',
    shippingMethod: 'Shipping',
    taxes: 'Taxes & fees',
    refunds: 'Refunds',
    method: 'Method',
    paymentStatus: 'Payment status',
    collected: 'Collected',
    shippingCollected: 'Shipping collected',
    actualShipping: 'Actual shipping cost',
    merchandise: 'Net merchandise',
    discount: 'Discount',
    tax: 'Tax',
    fees: 'Fees',
    refund: 'Refund',
    quantity: 'Quantity',
    sku: 'SKU',
    subtotal: 'Subtotal',
    lineTotal: 'Line total',
    assignee: 'Assignee',
    tags: 'Tags',
    notes: 'Notes',
    syncPolicy: 'Sync policy',
    inventoryPolicy: 'Inventory policy',
    syncEvents: 'Sync events',
    exports: 'Exports',
    documents: 'Documents',
    audit: 'Audit history',
    restricted: 'Raw source data is protected and requires a dedicated permission.',
    errors: 'Could not load orders. Try again',
    manualOrders: 'Create manual order',
    manualTitle: 'New local manual order',
    localOnly: 'Local only: this order never calls WooCommerce or changes inventory',
    customerName: 'Customer name',
    customerEmail: 'Customer email',
    customerPhone: 'Customer phone',
    currency: 'Currency',
    productName: 'Product name',
    productSku: 'SKU',
    unitPriceMinor: 'Unit price in minor units',
    shippingMinor: 'Shipping in minor units',
    discountMinor: 'Discount in minor units',
    taxMinor: 'Tax in minor units',
    feesMinor: 'Fees in minor units',
    localStatusInput: 'Local status',
    tagsInput: 'Tags separated by commas',
    notesInput: 'Notes',
    address: 'Address',
    saveManual: 'Save manual order',
    cancel: 'Cancel',
    invalidManual: 'Check the manual order fields',
    createdManual: 'Manual order saved locally',
    documentsNav: 'Documents',
    documentsTitle: 'Document templates & printing',
    documentTemplateName: 'Template name',
    documentCompany: 'Company name',
    documentBody: 'Safe template text',
    documentFormat: 'Physical size',
    saveTemplate: 'Save template',
    previewDocument: 'Preview PDF',
    printDocument: 'Print',
    templateSafety:
      'Only allowlisted tokens are supported. HTML, scripts, and network loads are blocked.',
    templateTokens: 'order.number, customer.name, shipping.address, order.totalMinor',
    noTemplates: 'No templates yet',
    analyticsNav: 'Analytics',
    analyticsTitle: 'Sales analytics dashboard',
    analyticsSubtitle: 'Explainable revenue and contribution profit across every source',
    analyticsSource: 'Data source',
    allSources: 'All sources',
    sourceWoo: 'WooCommerce',
    sourceManual: 'Manual orders',
    sourceCombined: 'Combined',
    fromDate: 'From date',
    toDate: 'To date',
    storeFilter: 'Store / connection ID',
    statusFilter: 'Order status',
    shippingFilter: 'Shipping method',
    productFilter: 'Product / SKU',
    categoryFilter: 'Category',
    authorFilter: 'Author',
    applyFilters: 'Apply filters',
    resetFilters: 'Reset',
    revenue: 'Collected revenue',
    profit: 'Contribution profit',
    ordersCount: 'Orders',
    linesCount: 'Lines',
    freshness: 'Data freshness',
    lastRebuilt: 'Last rebuilt',
    costCoverage: 'Cost coverage',
    coverageUnavailable: 'Cost snapshots are not available yet',
    coverageScope: 'account-wide snapshots',
    trend: 'Trend over time',
    breakdown: 'Breakdown',
    breakdownDimension: 'Break down by',
    dimensionSource: 'Source',
    dimensionStore: 'Store',
    dimensionStatus: 'Status',
    dimensionShipping: 'Shipping',
    dimensionProduct: 'Product',
    dimensionCategory: 'Category',
    dimensionAuthor: 'Author',
    formulas: 'Formulas and exclusions',
    metrics: 'Metric',
    formula: 'Formula',
    excludedStatuses: 'Excluded statuses',
    currencySeparated: 'Currencies are shown separately and are never combined silently.',
    noAnalytics: 'No analytics facts match these filters',
    analyticsError: 'Could not load analytics. Try again',
  },
} as const;

const columns = [
  'orderNumber',
  'source',
  'remoteStatus',
  'localStatus',
  'total',
  'exportState',
] as const;

const asRecord = (value: unknown): JsonRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {};

const asList = (value: unknown): readonly JsonRecord[] =>
  Array.isArray(value) ? value.map(asRecord) : [];

const valueText = (value: unknown, fallback = '—'): string =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : fallback;

const dateText = (value: unknown, locale: Locale): string => {
  if (typeof value !== 'string' || value.length === 0) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
};

const formatMinor = (value: unknown, currency: string, locale: Locale): string => {
  try {
    const minor = BigInt(valueText(value, '0'));
    const negative = minor < 0n;
    const absolute = negative ? -minor : minor;
    const whole = absolute / 100n;
    const fraction = (absolute % 100n).toString().padStart(2, '0');
    return `${negative ? '-' : ''}${whole.toLocaleString(locale === 'ar' ? 'ar-EG' : 'en-US')}.${fraction} ${currency}`;
  } catch {
    return `— ${currency}`;
  }
};

const orderCustomerName = (order: Order): string => {
  const billing = asRecord(order.billing);
  return `${valueText(billing.first_name, '')} ${valueText(billing.last_name, '')}`.trim() || '—';
};

const addressLines = (addressValue: unknown): string[] => {
  const address = asRecord(addressValue);
  return [
    ['first_name', 'last_name']
      .map((key) => valueText(address[key], ''))
      .join(' ')
      .trim(),
    valueText(address.company, ''),
    valueText(address.address_1, ''),
    valueText(address.address_2, ''),
    [address.city, address.state, address.postcode]
      .map((value) => valueText(value, ''))
      .filter(Boolean)
      .join(', '),
    valueText(address.country, ''),
  ].filter(Boolean);
};

const emptyAnalyticsFilters = (): AnalyticsFilterState => ({
  source: 'combined',
  from: '',
  to: '',
  store: '',
  status: '',
  shippingMethod: '',
  product: '',
  category: '',
  author: '',
});

type AnalyticsDimension =
  'source' | 'store' | 'status' | 'shippingMethod' | 'product' | 'category' | 'author';

const analyticsMetricLabel = (key: AnalyticsMetricKey, t: (typeof copy)[Locale]): string =>
  ({
    grossSalesMinor: t.subtotal,
    discountMinor: t.discount,
    netMerchandiseMinor: t.merchandise,
    shippingCollectedMinor: t.shippingCollected,
    taxMinor: t.tax,
    refundsMinor: t.refund,
    collectedRevenueMinor: t.revenue,
    cogsMinor: t.costCoverage,
    actualShippingCostMinor: t.actualShipping,
    paymentFeesMinor: t.fees,
    returnCostMinor: t.refund,
    contributionProfitMinor: t.profit,
  })[key];

const analyticsSourceLabel = (source: AnalyticsSource, t: (typeof copy)[Locale]): string =>
  source === 'woo' ? t.sourceWoo : source === 'manual' ? t.sourceManual : t.sourceCombined;

function AnalyticsWorkspace({ locale, t }: { locale: Locale; t: (typeof copy)[Locale] }) {
  const [filters, setFilters] = useState<AnalyticsFilterState>(emptyAnalyticsFilters);
  const [appliedFilters, setAppliedFilters] = useState<AnalyticsFilterState>(emptyAnalyticsFilters);
  const [dimension, setDimension] = useState<AnalyticsDimension>('source');
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const loadAnalytics = async (
    nextFilters: AnalyticsFilterState,
    nextDimension: AnalyticsDimension,
  ) => {
    setLoading(true);
    setError(false);
    const payload = {
      ...(nextFilters.source === 'combined' ? {} : { source: nextFilters.source }),
      ...(nextFilters.from ? { from: nextFilters.from } : {}),
      ...(nextFilters.to ? { to: nextFilters.to } : {}),
      ...(nextFilters.store ? { store: nextFilters.store } : {}),
      ...(nextFilters.status ? { status: nextFilters.status } : {}),
      ...(nextFilters.shippingMethod ? { shippingMethod: nextFilters.shippingMethod } : {}),
      ...(nextFilters.product ? { product: nextFilters.product } : {}),
      ...(nextFilters.category ? { category: nextFilters.category } : {}),
      ...(nextFilters.author ? { author: nextFilters.author } : {}),
    };
    try {
      const requests = await Promise.all([
        fetch('/api/v1/analytics/summary', {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        }),
        fetch('/api/v1/analytics/timeseries', {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        }),
        fetch('/api/v1/analytics/breakdown', {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...payload, dimension: nextDimension }),
        }),
      ]);
      if (requests.some((response) => !response.ok)) throw new Error('ANALYTICS_LOAD_FAILED');
      const [summaryResponse, timeseriesResponse, breakdownResponse] = requests;
      const summary = (await summaryResponse.json()) as { summary: AnalyticsSummary };
      const timeseries = (await timeseriesResponse.json()) as {
        timeseries: { items: AnalyticsTimeseriesItem[] };
      };
      const breakdown = (await breakdownResponse.json()) as {
        breakdown: { items: AnalyticsBreakdownItem[] };
      };
      setData({
        summary: summary.summary,
        timeseries: timeseries.timeseries.items,
        breakdown: breakdown.breakdown.items,
      });
    } catch {
      setError(true);
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAnalytics(appliedFilters, dimension);
  }, [appliedFilters, dimension]);

  const summary = data?.summary;
  const maxRevenue =
    data?.timeseries.reduce((maximum, item) => {
      try {
        const value = BigInt(item.totals.collectedRevenueMinor);
        return value > maximum ? value : maximum;
      } catch {
        return maximum;
      }
    }, 0n) ?? 0n;
  const freshness = summary?.freshness?.lastRebuiltAt ?? null;
  const coverage = summary?.costCoverage;

  const updateFilter = <K extends keyof AnalyticsFilterState>(
    key: K,
    value: AnalyticsFilterState[K],
  ) => setFilters((current) => ({ ...current, [key]: value }));

  return (
    <Stack gap={3} data-testid="analytics-workspace">
      <Box>
        <Typography variant="h4" component="h1" fontWeight={800}>
          {t.analyticsTitle}
        </Typography>
        <Typography color="text.secondary">{t.analyticsSubtitle}</Typography>
      </Box>

      <Paper
        component="form"
        variant="outlined"
        sx={{ p: 2 }}
        data-testid="analytics-filters"
        onSubmit={(event) => {
          event.preventDefault();
          setAppliedFilters({ ...filters });
        }}
      >
        <Stack gap={2}>
          <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap">
            <Chip
              label={`${t.analyticsSource}: ${analyticsSourceLabel(appliedFilters.source, t)}`}
            />
            <Typography variant="body2" color="text.secondary">
              {t.currencySeparated}
            </Typography>
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} gap={2} flexWrap="wrap">
            <FormControl size="small" sx={{ minWidth: 180 }}>
              <InputLabel id="analytics-source-label">{t.analyticsSource}</InputLabel>
              <Select
                labelId="analytics-source-label"
                value={filters.source}
                label={t.analyticsSource}
                onChange={(event) => updateFilter('source', event.target.value as AnalyticsSource)}
              >
                <MenuItem value="combined">{t.allSources}</MenuItem>
                <MenuItem value="woo">{t.sourceWoo}</MenuItem>
                <MenuItem value="manual">{t.sourceManual}</MenuItem>
              </Select>
            </FormControl>
            <TextField
              size="small"
              type="date"
              label={t.fromDate}
              value={filters.from}
              onChange={(event) => updateFilter('from', event.target.value)}
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              size="small"
              type="date"
              label={t.toDate}
              value={filters.to}
              onChange={(event) => updateFilter('to', event.target.value)}
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              size="small"
              label={t.storeFilter}
              value={filters.store}
              onChange={(event) => updateFilter('store', event.target.value)}
            />
            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel id="analytics-status-label">{t.statusFilter}</InputLabel>
              <Select
                labelId="analytics-status-label"
                value={filters.status}
                label={t.statusFilter}
                onChange={(event) => updateFilter('status', event.target.value)}
              >
                <MenuItem value="">{t.all}</MenuItem>
                <MenuItem value="processing">{t.processing}</MenuItem>
                <MenuItem value="completed">{t.completed}</MenuItem>
                <MenuItem value="cancelled">cancelled</MenuItem>
              </Select>
            </FormControl>
          </Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} gap={2} flexWrap="wrap">
            <TextField
              size="small"
              label={t.shippingFilter}
              value={filters.shippingMethod}
              onChange={(event) => updateFilter('shippingMethod', event.target.value)}
            />
            <TextField
              size="small"
              label={t.productFilter}
              value={filters.product}
              onChange={(event) => updateFilter('product', event.target.value)}
            />
            <TextField
              size="small"
              label={t.categoryFilter}
              value={filters.category}
              onChange={(event) => updateFilter('category', event.target.value)}
            />
            <TextField
              size="small"
              label={t.authorFilter}
              value={filters.author}
              onChange={(event) => updateFilter('author', event.target.value)}
            />
            <Button type="submit" variant="contained" disabled={loading}>
              {loading ? <CircularProgress size={18} aria-label={t.loading} /> : t.applyFilters}
            </Button>
            <Button
              type="button"
              variant="text"
              onClick={() => {
                const next = emptyAnalyticsFilters();
                setFilters(next);
                setAppliedFilters(next);
              }}
              disabled={loading}
            >
              {t.resetFilters}
            </Button>
          </Stack>
        </Stack>
      </Paper>

      {error && <Alert severity="error">{t.analyticsError}</Alert>}
      {loading && <LinearProgress aria-label={t.loading} />}
      {!loading && data && data.summary.currencies.length === 0 && (
        <Alert severity="info" data-testid="analytics-empty">
          {t.noAnalytics}
        </Alert>
      )}

      {summary && summary.currencies.length > 0 && (
        <>
          <Stack direction={{ xs: 'column', md: 'row' }} gap={2} flexWrap="wrap">
            {summary.currencies.map((currency) => (
              <Card
                key={currency.currency}
                variant="outlined"
                sx={{ flex: '1 1 300px', minWidth: 260 }}
                data-testid={`analytics-currency-${currency.currency}`}
              >
                <CardContent>
                  <Stack gap={1.5}>
                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                      <Typography variant="h6" component="h2" fontWeight={800}>
                        {currency.currency}
                      </Typography>
                      <Chip size="small" label={analyticsSourceLabel(summary.source, t)} />
                    </Stack>
                    <Stack direction={{ xs: 'column', sm: 'row' }} gap={2}>
                      <Box flex={1} data-testid="analytics-revenue">
                        <Typography variant="caption" color="text.secondary">
                          {t.revenue}
                        </Typography>
                        <Typography variant="h5" component="div" fontWeight={800}>
                          {formatMinor(
                            currency.totals.collectedRevenueMinor,
                            currency.currency,
                            locale,
                          )}
                        </Typography>
                      </Box>
                      <Box flex={1} data-testid="analytics-profit">
                        <Typography variant="caption" color="text.secondary">
                          {t.profit}
                        </Typography>
                        <Typography
                          variant="h5"
                          component="div"
                          fontWeight={800}
                          color="success.main"
                        >
                          {formatMinor(
                            currency.totals.contributionProfitMinor,
                            currency.currency,
                            locale,
                          )}
                        </Typography>
                      </Box>
                    </Stack>
                    <Divider />
                    <Stack direction="row" gap={3}>
                      <Typography variant="body2">
                        {t.ordersCount}: <strong>{currency.orderCount}</strong>
                      </Typography>
                      <Typography variant="body2">
                        {t.linesCount}: <strong>{currency.lineCount}</strong>
                      </Typography>
                    </Stack>
                  </Stack>
                </CardContent>
              </Card>
            ))}
          </Stack>

          <Stack direction={{ xs: 'column', md: 'row' }} gap={2}>
            <Paper variant="outlined" sx={{ p: 2, flex: 1 }}>
              <Typography variant="h6" component="h2" fontWeight={800} gutterBottom>
                {t.freshness}
              </Typography>
              <Typography variant="body2">
                {t.lastRebuilt}: {freshness ? dateText(freshness, locale) : t.coverageUnavailable}
              </Typography>
              <Typography variant="body2" sx={{ mt: 1 }}>
                {t.costCoverage} ({t.coverageScope}):{' '}
                {coverage?.percentage === null || coverage === undefined
                  ? t.coverageUnavailable
                  : `${coverage.percentage}% (${coverage.coveredLines}/${coverage.totalLines})`}
              </Typography>
            </Paper>
            <Paper variant="outlined" sx={{ p: 2, flex: 2 }}>
              <Typography variant="h6" component="h2" fontWeight={800} gutterBottom>
                {t.trend}
              </Typography>
              <TableContainer data-testid="analytics-trend">
                <Table size="small" aria-label={t.trend}>
                  <caption
                    style={{
                      position: 'absolute',
                      width: 1,
                      height: 1,
                      overflow: 'hidden',
                      clip: 'rect(0 0 0 0)',
                    }}
                  >
                    {t.trend}
                  </caption>
                  <TableHead>
                    <TableRow>
                      <TableCell>{t.created}</TableCell>
                      <TableCell>{t.revenue}</TableCell>
                      <TableCell>{t.profit}</TableCell>
                      <TableCell>{t.ordersCount}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.timeseries.map((item) => {
                      let revenueMinor = 0n;
                      try {
                        revenueMinor = BigInt(item.totals.collectedRevenueMinor);
                      } catch {
                        revenueMinor = 0n;
                      }
                      const width =
                        maxRevenue > 0n ? Number((revenueMinor * 100n) / maxRevenue) : 0;
                      return (
                        <TableRow key={`${item.date}-${item.currency}-${item.source}`}>
                          <TableCell dir="ltr">{item.date}</TableCell>
                          <TableCell>
                            <Stack gap={0.5}>
                              <span>
                                {formatMinor(
                                  item.totals.collectedRevenueMinor,
                                  item.currency,
                                  locale,
                                )}
                              </span>
                              <LinearProgress
                                variant="determinate"
                                value={Math.min(width, 100)}
                                aria-label={t.revenue}
                              />
                            </Stack>
                          </TableCell>
                          <TableCell>
                            {formatMinor(
                              item.totals.contributionProfitMinor,
                              item.currency,
                              locale,
                            )}
                          </TableCell>
                          <TableCell>{item.orderCount}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          </Stack>

          <Paper variant="outlined" sx={{ p: 2 }} data-testid="analytics-breakdown">
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              justifyContent="space-between"
              alignItems={{ sm: 'center' }}
              gap={2}
              mb={2}
            >
              <Typography variant="h6" component="h2" fontWeight={800}>
                {t.breakdown}
              </Typography>
              <FormControl size="small" sx={{ minWidth: 180 }}>
                <InputLabel id="analytics-dimension-label">{t.breakdownDimension}</InputLabel>
                <Select
                  labelId="analytics-dimension-label"
                  value={dimension}
                  label={t.breakdownDimension}
                  onChange={(event) => setDimension(event.target.value as AnalyticsDimension)}
                >
                  <MenuItem value="source">{t.dimensionSource}</MenuItem>
                  <MenuItem value="store">{t.dimensionStore}</MenuItem>
                  <MenuItem value="status">{t.dimensionStatus}</MenuItem>
                  <MenuItem value="shippingMethod">{t.dimensionShipping}</MenuItem>
                  <MenuItem value="product">{t.dimensionProduct}</MenuItem>
                  <MenuItem value="category">{t.dimensionCategory}</MenuItem>
                  <MenuItem value="author">{t.dimensionAuthor}</MenuItem>
                </Select>
              </FormControl>
            </Stack>
            <Table size="small" aria-label={t.breakdown}>
              <TableHead>
                <TableRow>
                  <TableCell>{t.breakdownDimension}</TableCell>
                  <TableCell>{t.currency}</TableCell>
                  <TableCell>{t.revenue}</TableCell>
                  <TableCell>{t.profit}</TableCell>
                  <TableCell>{t.ordersCount}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.breakdown.map((item) => (
                  <TableRow key={`${item.key}-${item.currency}`}>
                    <TableCell>{item.key}</TableCell>
                    <TableCell>{item.currency}</TableCell>
                    <TableCell>
                      {formatMinor(item.totals.collectedRevenueMinor, item.currency, locale)}
                    </TableCell>
                    <TableCell>
                      {formatMinor(item.totals.contributionProfitMinor, item.currency, locale)}
                    </TableCell>
                    <TableCell>{item.orderCount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>

          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="h6" component="h2" fontWeight={800} gutterBottom>
              {t.formulas}
            </Typography>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              {t.excludedStatuses}: {summary.excludedStatuses.join(', ')} · v
              {summary.metricsVersion}
            </Typography>
            <Table size="small" aria-label={t.formulas}>
              <TableHead>
                <TableRow>
                  <TableCell>{t.metrics}</TableCell>
                  <TableCell>{t.formula}</TableCell>
                  <TableCell>{t.excludedStatuses}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {summary.definitions.map((definition) => (
                  <TableRow key={definition.key}>
                    <TableCell>{analyticsMetricLabel(definition.key, t)}</TableCell>
                    <TableCell>{definition.formula}</TableCell>
                    <TableCell>{definition.excludedStatuses.join(', ')}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>
        </>
      )}
    </Stack>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <Stack direction="row" justifyContent="space-between" gap={2} sx={{ py: 0.5 }}>
      <Typography color="text.secondary" variant="body2">
        {label}
      </Typography>
      <Typography fontWeight={700} textAlign="end" variant="body2" dir="auto">
        {value}
      </Typography>
    </Stack>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box>
      <Typography variant="subtitle1" fontWeight={800} gutterBottom>
        {title}
      </Typography>
      {children}
    </Box>
  );
}

function EmptyValue({ label }: { label: string }) {
  return <Typography color="text.secondary">{label}</Typography>;
}

function Address({ title, value, empty }: { title: string; value: unknown; empty: string }) {
  const lines = addressLines(value);
  return (
    <Section title={title}>
      {lines.length === 0 ? (
        <EmptyValue label={empty} />
      ) : (
        lines.map((line, index) => (
          <Typography key={`${line}-${index}`} dir="auto">
            {line}
          </Typography>
        ))
      )}
    </Section>
  );
}

function HistoryList({
  title,
  entries,
  empty,
}: {
  title: string;
  entries: readonly JsonRecord[];
  empty: string;
}) {
  return (
    <Section title={title}>
      {entries.length === 0 ? (
        <EmptyValue label={empty} />
      ) : (
        entries.map((entry, index) => (
          <Paper key={String(entry.id ?? index)} variant="outlined" sx={{ p: 1, mb: 1 }}>
            <Typography variant="body2">
              {valueText(entry.action ?? entry.type ?? entry.status)}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {valueText(entry.createdAt ?? entry.created_at)}
            </Typography>
          </Paper>
        ))
      )}
    </Section>
  );
}

function OrderDetail({
  order,
  locale,
  t,
  onClose,
}: {
  order: Order;
  locale: Locale;
  t: (typeof copy)[Locale];
  onClose: () => void;
}) {
  const [tab, setTab] = useState(0);
  const currency = valueText(order.currency, '');
  const amounts = asRecord(order.amounts);
  const payment = asRecord(order.payment);
  const shippingMethod = asRecord(order.shippingMethod);
  const workflow = asRecord(order.local);
  const tags = Array.isArray(order.tags) ? order.tags : [];
  const syncEvents = asList(order.syncEvents ?? order.syncTimeline);
  const auditEvents = asList(order.auditHistory ?? order.auditEvents);
  const exports = asList(order.exports ?? order.exportHistory);
  const documents = asList(order.documents ?? order.documentHistory);
  const tabLabels = [t.summary, t.items, t.customer, t.finance, t.workflow, t.history, t.raw];

  return (
    <Stack gap={2} role="document" aria-labelledby="order-detail-title">
      <Stack direction="row" alignItems="center" gap={1}>
        <Typography id="order-detail-title" variant="h5" fontWeight={800} sx={{ flexGrow: 1 }}>
          {t.details} <span dir="ltr">#{valueText(order.orderNumber)}</span>
        </Typography>
        <Tooltip title={t.close}>
          <IconButton onClick={onClose} aria-label={t.close}>
            ×
          </IconButton>
        </Tooltip>
      </Stack>
      <Stack direction="row" gap={1} flexWrap="wrap">
        <Chip label={order.origin === 'manual' ? t.originManual : t.originWoo} />
        <Chip label={valueText(order.remoteStatus)} variant="outlined" />
        <Chip
          label={
            valueText(order.exportState) === 'never-exported'
              ? t.never
              : valueText(order.exportState)
          }
          variant="outlined"
        />
      </Stack>
      <Tabs
        value={tab}
        onChange={(_event, nextTab: number) => setTab(nextTab)}
        variant="scrollable"
        scrollButtons="auto"
        aria-label={t.details}
      >
        {tabLabels.map((label, index) => (
          <Tab
            key={label}
            label={label}
            id={`order-tab-${index}`}
            aria-controls={`order-tabpanel-${index}`}
          />
        ))}
      </Tabs>
      <Box role="tabpanel" id={`order-tabpanel-${tab}`} aria-labelledby={`order-tab-${tab}`}>
        {tab === 0 && (
          <Stack gap={2}>
            <Section title={t.remote}>
              <Fact label={t.orderNumber} value={valueText(order.orderNumber)} />
              <Fact label={t.sourceId} value={valueText(order.externalOrderId)} />
              <Fact label={t.store} value={valueText(order.connectionId)} />
              <Fact label={t.remoteStatus} value={valueText(order.remoteStatus)} />
              <Fact label={t.total} value={formatMinor(order.grandTotalMinor, currency, locale)} />
              <Fact label={t.channel} value={valueText(order.channel ?? order.createdVia)} />
              <Fact label={t.pos} value={valueText(order.posLocation ?? order.pos)} />
              <Fact
                label={t.created}
                value={dateText(order.createdAt ?? order.remoteCreatedAt, locale)}
              />
              <Fact
                label={t.updated}
                value={dateText(order.modifiedAt ?? order.updatedAt, locale)}
              />
            </Section>
            <Divider />
            <Section title={t.localFacts}>
              <Fact label={t.localStatus} value={valueText(order.localStatus)} />
              <Fact
                label={t.exportState}
                value={
                  valueText(order.exportState) === 'never-exported'
                    ? t.never
                    : valueText(order.exportState)
                }
              />
              <Fact label={t.assignee} value={valueText(order.assigneeId ?? workflow.assigneeId)} />
              <Fact
                label={t.syncPolicy}
                value={valueText(order.syncPolicy ?? workflow.syncPolicy)}
              />
              <Fact
                label={t.inventoryPolicy}
                value={valueText(order.inventoryPolicy ?? workflow.inventoryPolicy)}
              />
              {typeof order.staleExportAt === 'string' && (
                <Fact label={t.updated} value={dateText(order.staleExportAt, locale)} />
              )}
            </Section>
            <Alert severity="info">{t.platformOnly}</Alert>
            <Section title={t.items}>
              {asList(order.lines).length === 0 ? (
                <EmptyValue label={t.noData} />
              ) : (
                asList(order.lines).map((line, index) => (
                  <Typography key={valueText(line.externalLineId, String(index))} dir="auto">
                    {valueText(line.name)}
                  </Typography>
                ))
              )}
            </Section>
          </Stack>
        )}
        {tab === 1 && (
          <Section title={t.items}>
            {asList(order.lines).length === 0 ? (
              <EmptyValue label={t.noData} />
            ) : (
              <Table size="small" aria-label={t.items}>
                <TableHead>
                  <TableRow>
                    <TableCell>{t.items}</TableCell>
                    <TableCell>{t.sku}</TableCell>
                    <TableCell>{t.quantity}</TableCell>
                    <TableCell>{t.subtotal}</TableCell>
                    <TableCell>{t.lineTotal}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {asList(order.lines).map((line, index) => (
                    <TableRow key={valueText(line.externalLineId, String(index))}>
                      <TableCell>{valueText(line.name)}</TableCell>
                      <TableCell dir="ltr">{valueText(line.sku)}</TableCell>
                      <TableCell>{valueText(line.quantity)}</TableCell>
                      <TableCell>{formatMinor(line.subtotalMinor, currency, locale)}</TableCell>
                      <TableCell>{formatMinor(line.totalMinor, currency, locale)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Section>
        )}
        {tab === 2 && (
          <Stack gap={2}>
            <Section title={t.customer}>
              <Fact label={t.externalCustomer} value={valueText(order.externalCustomerId)} />
              <Fact label={t.customer} value={orderCustomerName(order)} />
              <Fact label={t.email} value={valueText(asRecord(order.billing).email)} />
              <Fact label={t.phone} value={valueText(asRecord(order.billing).phone)} />
            </Section>
            <Address title={t.billing} value={order.billing} empty={t.noData} />
            <Address title={t.shippingAddress} value={order.shipping} empty={t.noData} />
          </Stack>
        )}
        {tab === 3 && (
          <Stack gap={2}>
            <Section title={t.payment}>
              <Fact
                label={t.method}
                value={valueText(
                  payment.title ??
                    payment.methodTitle ??
                    order.paymentMethodTitle ??
                    order.paymentMethod,
                )}
              />
              <Fact
                label={t.paymentStatus}
                value={valueText(payment.status ?? order.paymentStatus)}
              />
              <Fact
                label={t.collected}
                value={formatMinor(
                  amounts.collectedMinor ?? order.collectedMinor,
                  currency,
                  locale,
                )}
              />
            </Section>
            <Section title={t.shippingMethod}>
              <Fact
                label={t.method}
                value={valueText(shippingMethod.title ?? order.shippingMethodTitle)}
              />
              <Fact
                label={t.shippingCollected}
                value={formatMinor(
                  amounts.shippingCollectedMinor ?? order.shippingCollectedMinor,
                  currency,
                  locale,
                )}
              />
              <Fact
                label={t.actualShipping}
                value={formatMinor(
                  shippingMethod.actualCostMinor ?? order.actualShippingCostMinor,
                  currency,
                  locale,
                )}
              />
            </Section>
            <Section title={t.taxes}>
              <Fact
                label={t.merchandise}
                value={formatMinor(
                  amounts.merchandiseNetMinor ?? order.merchandiseNetMinor,
                  currency,
                  locale,
                )}
              />
              <Fact
                label={t.discount}
                value={formatMinor(amounts.discountMinor ?? order.discountMinor, currency, locale)}
              />
              <Fact
                label={t.tax}
                value={formatMinor(amounts.taxMinor ?? order.taxMinor, currency, locale)}
              />
              <Fact
                label={t.fees}
                value={formatMinor(amounts.feesMinor ?? order.feesMinor, currency, locale)}
              />
              <Fact
                label={t.refund}
                value={formatMinor(amounts.refundMinor ?? order.refundMinor, currency, locale)}
              />
            </Section>
            <Section title={t.refunds}>
              {asList(order.refunds).length === 0 ? (
                <EmptyValue label={t.noData} />
              ) : (
                asList(order.refunds).map((refund, index) => (
                  <Fact
                    key={valueText(refund.externalRefundId, String(index))}
                    label={valueText(refund.reason, t.refunds)}
                    value={formatMinor(refund.amountMinor, currency, locale)}
                  />
                ))
              )}
            </Section>
          </Stack>
        )}
        {tab === 4 && (
          <Stack gap={2}>
            <Section title={t.workflow}>
              <Fact label={t.localStatus} value={valueText(order.localStatus)} />
              <Fact label={t.assignee} value={valueText(order.assigneeId ?? workflow.assigneeId)} />
              <Fact
                label={t.syncPolicy}
                value={valueText(order.syncPolicy ?? workflow.syncPolicy)}
              />
              <Fact
                label={t.inventoryPolicy}
                value={valueText(order.inventoryPolicy ?? workflow.inventoryPolicy)}
              />
              <Fact label={t.notes} value={valueText(order.notesSummary ?? order.notes)} />
            </Section>
            <Stack direction="row" gap={1} flexWrap="wrap" aria-label={t.tags}>
              <Typography color="text.secondary" variant="body2">
                {t.tags}
              </Typography>
              {tags.length === 0 ? (
                <EmptyValue label={t.noData} />
              ) : (
                tags.map((tag) => <Chip key={String(tag)} label={String(tag)} size="small" />)
              )}
            </Stack>
          </Stack>
        )}
        {tab === 5 && (
          <Stack gap={2}>
            <HistoryList title={t.syncEvents} entries={syncEvents} empty={t.noData} />
            <HistoryList title={t.exports} entries={exports} empty={t.noData} />
            <HistoryList title={t.documents} entries={documents} empty={t.noData} />
            <HistoryList title={t.audit} entries={auditEvents} empty={t.noData} />
          </Stack>
        )}
        {tab === 6 && <Alert severity="warning">{t.restricted}</Alert>}
      </Box>
    </Stack>
  );
}

function csrfToken(): string {
  return (
    document.cookie
      .split(';')
      .map((item) => item.trim())
      .find((item) => item.startsWith('woo_ops_csrf='))
      ?.slice('woo_ops_csrf='.length) ?? ''
  );
}

function ManualOrderForm({
  locale,
  t,
  onSaved,
  onCancel,
}: {
  locale: Locale;
  t: (typeof copy)[Locale];
  onSaved: (order: Order) => void;
  onCancel: () => void;
}) {
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [address, setAddress] = useState('');
  const [currency, setCurrency] = useState('EGP');
  const [productName, setProductName] = useState('');
  const [productSku, setProductSku] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unitPriceMinor, setUnitPriceMinor] = useState('0');
  const [shippingMinor, setShippingMinor] = useState('0');
  const [discountMinor, setDiscountMinor] = useState('0');
  const [taxMinor, setTaxMinor] = useState('0');
  const [feesMinor, setFeesMinor] = useState('0');
  const [localStatus, setLocalStatus] = useState('new');
  const [tags, setTags] = useState('manual');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [saved, setSaved] = useState(false);
  const total = useMemo(() => {
    try {
      const subtotal = BigInt(unitPriceMinor || '0') * BigInt(quantity || '0');
      const value =
        subtotal -
        BigInt(discountMinor || '0') +
        BigInt(taxMinor || '0') +
        BigInt(shippingMinor || '0') +
        BigInt(feesMinor || '0');
      return formatMinor(value.toString(), currency.toUpperCase(), locale);
    } catch {
      return '—';
    }
  }, [
    currency,
    discountMinor,
    feesMinor,
    locale,
    quantity,
    shippingMinor,
    taxMinor,
    unitPriceMinor,
  ]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(false);
    try {
      const response = await fetch('/api/v1/manual-orders', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken() },
        credentials: 'include',
        body: JSON.stringify({
          currency: currency.trim().toUpperCase(),
          customer: { name: customerName, email: customerEmail, phone: customerPhone },
          billing: { first_name: customerName, email: customerEmail, phone: customerPhone },
          shipping: { first_name: customerName, address_1: address },
          payment: { method: 'manual', title: 'Manual payment' },
          shippingMethod: { methodId: 'manual', title: 'Manual shipping' },
          lines: [
            {
              name: productName,
              sku: productSku || undefined,
              quantity: Number(quantity),
              unitPriceMinor,
            },
          ],
          shippingCollectedMinor: shippingMinor,
          discountMinor,
          taxMinor,
          feesMinor,
          localStatus,
          tags: tags
            .split(',')
            .map((tag) => tag.trim())
            .filter(Boolean),
          notes,
        }),
      });
      if (!response.ok) throw new Error('MANUAL_ORDER_CREATE_FAILED');
      const body = (await response.json()) as OrderResponse;
      setSaved(true);
      onSaved(body.order);
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Paper component="form" onSubmit={submit} variant="outlined" sx={{ p: { xs: 2, md: 4 } }}>
      <Stack gap={3}>
        <Box>
          <Typography variant="h4" component="h1" fontWeight={800}>
            {t.manualTitle}
          </Typography>
          <Typography color="text.secondary">{t.localOnly}</Typography>
        </Box>
        <Alert severity="info">{t.localOnly}</Alert>
        {error && <Alert severity="error">{t.invalidManual}</Alert>}
        {saved && <Alert severity="success">{t.createdManual}</Alert>}
        <Section title={t.customer}>
          <Stack direction={{ xs: 'column', md: 'row' }} gap={2}>
            <TextField
              required
              fullWidth
              label={t.customerName}
              value={customerName}
              onChange={(event) => setCustomerName(event.target.value)}
            />
            <TextField
              fullWidth
              label={t.customerEmail}
              type="email"
              value={customerEmail}
              onChange={(event) => setCustomerEmail(event.target.value)}
            />
            <TextField
              fullWidth
              label={t.customerPhone}
              value={customerPhone}
              onChange={(event) => setCustomerPhone(event.target.value)}
            />
          </Stack>
          <TextField
            fullWidth
            sx={{ mt: 2 }}
            label={t.address}
            value={address}
            onChange={(event) => setAddress(event.target.value)}
          />
        </Section>
        <Section title={t.items}>
          <Stack direction={{ xs: 'column', md: 'row' }} gap={2}>
            <TextField
              required
              fullWidth
              label={t.productName}
              value={productName}
              onChange={(event) => setProductName(event.target.value)}
            />
            <TextField
              fullWidth
              label={t.productSku}
              value={productSku}
              onChange={(event) => setProductSku(event.target.value)}
            />
            <TextField
              required
              label={t.quantity}
              type="number"
              inputProps={{ min: 1, step: 1 }}
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
            />
            <TextField
              required
              label={t.unitPriceMinor}
              type="number"
              inputProps={{ min: 0, step: 1 }}
              value={unitPriceMinor}
              onChange={(event) => setUnitPriceMinor(event.target.value)}
            />
          </Stack>
        </Section>
        <Section title={t.finance}>
          <Stack direction={{ xs: 'column', md: 'row' }} gap={2}>
            <TextField
              label={t.currency}
              value={currency}
              onChange={(event) => setCurrency(event.target.value)}
            />
            <TextField
              label={t.shippingMinor}
              type="number"
              inputProps={{ min: 0, step: 1 }}
              value={shippingMinor}
              onChange={(event) => setShippingMinor(event.target.value)}
            />
            <TextField
              label={t.discountMinor}
              type="number"
              inputProps={{ min: 0, step: 1 }}
              value={discountMinor}
              onChange={(event) => setDiscountMinor(event.target.value)}
            />
            <TextField
              label={t.taxMinor}
              type="number"
              inputProps={{ min: 0, step: 1 }}
              value={taxMinor}
              onChange={(event) => setTaxMinor(event.target.value)}
            />
            <TextField
              label={t.feesMinor}
              type="number"
              inputProps={{ min: 0, step: 1 }}
              value={feesMinor}
              onChange={(event) => setFeesMinor(event.target.value)}
            />
          </Stack>
          <Typography sx={{ mt: 2 }} fontWeight={800}>
            {t.total}: {total}
          </Typography>
        </Section>
        <Section title={t.workflow}>
          <Stack direction={{ xs: 'column', md: 'row' }} gap={2}>
            <TextField
              label={t.localStatusInput}
              value={localStatus}
              onChange={(event) => setLocalStatus(event.target.value)}
            />
            <TextField
              fullWidth
              label={t.tagsInput}
              value={tags}
              onChange={(event) => setTags(event.target.value)}
            />
            <TextField
              fullWidth
              label={t.notesInput}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </Stack>
        </Section>
        <Stack direction="row" gap={2} justifyContent="flex-end">
          <Button type="button" onClick={onCancel} disabled={saving}>
            {t.cancel}
          </Button>
          <Button type="submit" variant="contained" disabled={saving}>
            {saving ? <CircularProgress size={18} aria-label={t.loading} /> : t.saveManual}
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}

function DocumentsWorkspace({ direction, t }: { direction: Direction; t: (typeof copy)[Locale] }) {
  const defaultBody =
    '{{order.number}}\n{{customer.name}}\n{{shipping.address}}\n{{order.totalMinor}}';
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [name, setName] = useState('Default invoice');
  const [companyName, setCompanyName] = useState('Woo Ops');
  const [body, setBody] = useState(defaultBody);
  const [format, setFormat] = useState<DocumentTemplate['format']>('a4');
  const [previewUrl, setPreviewUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void fetch('/api/v1/document-templates', { credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) throw new Error('DOCUMENT_TEMPLATES_LOAD_FAILED');
        return (await response.json()) as { items: DocumentTemplate[] };
      })
      .then((result) => {
        if (!active) return;
        setTemplates(result.items);
        const first = result.items[0];
        if (first) {
          setTemplateId(first.id);
          setName(first.name);
          setCompanyName(first.companyName);
          setBody(first.body);
          setFormat(first.format);
        }
      })
      .catch(() => {
        if (active) setError('DOCUMENT_TEMPLATES_LOAD_FAILED');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  const csrfToken = () => document.cookie.match(/(?:^|;\s*)woo_ops_csrf=([^;]+)/u)?.[1] ?? '';
  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const payload = {
        name,
        format,
        direction,
        locale: direction === 'rtl' ? 'ar-EG' : 'en-US',
        body,
        companyName,
      };
      const response = await fetch(
        templateId
          ? `/api/v1/document-templates/${encodeURIComponent(templateId)}`
          : '/api/v1/document-templates',
        {
          method: templateId ? 'PATCH' : 'POST',
          credentials: 'include',
          headers: {
            'content-type': 'application/json',
            ...(csrfToken() ? { 'x-csrf-token': csrfToken() } : {}),
          },
          body: JSON.stringify(payload),
        },
      );
      if (!response.ok) throw new Error('DOCUMENT_TEMPLATE_SAVE_FAILED');
      const result = (await response.json()) as { template: DocumentTemplate };
      setTemplates((current) =>
        templateId
          ? current.map((item) => (item.id === result.template.id ? result.template : item))
          : [result.template, ...current],
      );
      setTemplateId(result.template.id);
    } catch {
      setError('DOCUMENT_TEMPLATE_SAVE_FAILED');
    } finally {
      setSaving(false);
    }
  };
  const preview = async () => {
    if (!templateId) {
      setError('DOCUMENT_TEMPLATE_SAVE_FIRST');
      return;
    }
    setError('');
    try {
      const response = await fetch(
        `/api/v1/document-templates/${encodeURIComponent(templateId)}/preview`,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'content-type': 'application/json',
            ...(csrfToken() ? { 'x-csrf-token': csrfToken() } : {}),
          },
          body: JSON.stringify({
            format,
            order: {
              id: 'preview-order',
              orderNumber: 'PREVIEW-001',
              currency: 'EGP',
              grandTotalMinor: '12500',
              billing: { first_name: 'Preview customer', phone: '01000000000' },
              shipping: { address_1: 'Preview street', city: 'Cairo' },
            },
          }),
        },
      );
      if (!response.ok) throw new Error('DOCUMENT_PREVIEW_FAILED');
      const nextUrl = URL.createObjectURL(await response.blob());
      setPreviewUrl((current) => {
        if (current) URL.revokeObjectURL(current);
        return nextUrl;
      });
    } catch {
      setError('DOCUMENT_PREVIEW_FAILED');
    }
  };

  return (
    <Stack gap={3} data-testid="documents-workspace">
      <Box>
        <Typography variant="h4" component="h1" fontWeight={800}>
          {t.documentsTitle}
        </Typography>
        <Typography color="text.secondary">{t.templateSafety}</Typography>
        <Typography variant="caption" color="text.secondary" dir="ltr">
          {t.templateTokens}
        </Typography>
      </Box>
      {error && <Alert severity="error">{error}</Alert>}
      {loading ? (
        <CircularProgress aria-label={t.loading} />
      ) : (
        <Stack direction={{ xs: 'column', lg: 'row' }} gap={3} alignItems="stretch">
          <Paper variant="outlined" sx={{ p: 3, flex: 1, minWidth: 0 }}>
            <Stack gap={2}>
              {templates.length > 0 && (
                <FormControl size="small">
                  <InputLabel id="document-template-label">{t.documentTemplateName}</InputLabel>
                  <Select
                    labelId="document-template-label"
                    value={templateId}
                    label={t.documentTemplateName}
                    onChange={(event) => {
                      const selectedTemplate = templates.find(
                        (item) => item.id === event.target.value,
                      );
                      setTemplateId(event.target.value);
                      if (selectedTemplate) {
                        setName(selectedTemplate.name);
                        setCompanyName(selectedTemplate.companyName);
                        setBody(selectedTemplate.body);
                        setFormat(selectedTemplate.format);
                      }
                    }}
                  >
                    {templates.map((item) => (
                      <MenuItem key={item.id} value={item.id}>
                        {item.name} v{item.version}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}
              <TextField
                label={t.documentTemplateName}
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
              <TextField
                label={t.documentCompany}
                value={companyName}
                onChange={(event) => setCompanyName(event.target.value)}
                required
              />
              <FormControl size="small">
                <InputLabel id="document-format-label">{t.documentFormat}</InputLabel>
                <Select
                  labelId="document-format-label"
                  value={format}
                  label={t.documentFormat}
                  onChange={(event) => setFormat(event.target.value as DocumentTemplate['format'])}
                >
                  <MenuItem value="a4">A4</MenuItem>
                  <MenuItem value="a5">A5</MenuItem>
                  <MenuItem value="thermal-80mm">80mm</MenuItem>
                  <MenuItem value="label-100x150mm">100x150mm</MenuItem>
                </Select>
              </FormControl>
              <TextField
                label={t.documentBody}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                multiline
                minRows={8}
                inputProps={{ 'aria-label': t.documentBody }}
                helperText={t.templateTokens}
              />
              <Stack direction="row" gap={1} flexWrap="wrap">
                <Button variant="contained" onClick={() => void save()} disabled={saving}>
                  {saving ? <CircularProgress size={18} aria-label={t.loading} /> : t.saveTemplate}
                </Button>
                <Button
                  variant="outlined"
                  onClick={() => void preview()}
                  disabled={!templateId || saving}
                >
                  {t.previewDocument}
                </Button>
                <Button variant="text" onClick={() => window.print()} disabled={!previewUrl}>
                  {t.printDocument}
                </Button>
              </Stack>
            </Stack>
          </Paper>
          <Paper variant="outlined" sx={{ p: 2, flex: 1, minHeight: 620 }}>
            {previewUrl ? (
              <Box
                component="iframe"
                title={t.previewDocument}
                src={previewUrl}
                width="100%"
                height="600px"
                sx={{ border: 0 }}
              />
            ) : (
              <Box display="grid" minHeight={580} sx={{ placeItems: 'center' }}>
                <Typography color="text.secondary">{t.noTemplates}</Typography>
              </Box>
            )}
          </Paper>
        </Stack>
      )}
    </Stack>
  );
}

export function App({
  locale,
  direction,
  onToggleLocale,
  onToggleDirection,
}: {
  locale: Locale;
  direction: Direction;
  onToggleLocale: () => void;
  onToggleDirection: () => void;
}) {
  const t = copy[locale];
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [orders, setOrders] = useState<Order[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [selected, setSelected] = useState<Order | null>(null);
  const [visibleColumns, setVisibleColumns] = useState<string[]>([...columns]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [view, setView] = useState<'orders' | 'manual' | 'documents' | 'analytics'>('orders');

  const loadOrders = async (append = false) => {
    setLoading(true);
    setError(false);
    try {
      const filter = status
        ? { field: 'remoteStatus', operator: 'equals', value: status }
        : undefined;
      const response = await fetch('/api/v1/orders/query', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          search: search || undefined,
          filter,
          cursor: append ? cursor : null,
          limit: 50,
          sort: { field: 'remoteCreatedAt', direction: 'desc' },
        }),
      });
      if (!response.ok) throw new Error('ORDER_QUERY_FAILED');
      const body = (await response.json()) as QueryResponse;
      setOrders((previous) => (append ? [...previous, ...body.items] : body.items));
      setCursor(body.nextCursor);
      setHasMore(body.hasMore);
    } catch {
      setError(true);
      if (!append) setOrders([]);
    } finally {
      setLoading(false);
    }
  };

  const openOrder = async (order: Order) => {
    setSelected(order);
    try {
      const response = await fetch(`/api/v1/orders/${encodeURIComponent(order.id)}`, {
        credentials: 'include',
      });
      if (response.ok) {
        const body = (await response.json()) as OrderResponse;
        setSelected(body.order);
      }
    } catch {
      // The list response remains a usable preview when detail loading fails.
    }
  };

  useEffect(() => {
    void loadOrders();
  }, [status]);

  const renderedColumns = useMemo(
    () => columns.filter((column) => visibleColumns.includes(column)),
    [visibleColumns],
  );
  const labelFor = (column: string) =>
    ({
      orderNumber: t.orderNumber,
      source: t.source,
      remoteStatus: t.remoteStatus,
      localStatus: t.localStatus,
      total: t.total,
      exportState: t.exportState,
    })[column] ?? column;
  const display = (order: Order, column: string): string =>
    column === 'source'
      ? order.origin === 'manual'
        ? t.originManual
        : t.originWoo
      : column === 'total'
        ? formatMinor(order.grandTotalMinor, valueText(order.currency, ''), locale)
        : column === 'exportState' && order.exportState === 'never-exported'
          ? t.never
          : valueText(order[column]);

  return (
    <Box minHeight="100vh" bgcolor="#f6f8fb" dir={direction}>
      <AppBar
        position="sticky"
        elevation={0}
        color="inherit"
        sx={{ borderBottom: '1px solid #e5e7eb' }}
      >
        <Toolbar sx={{ gap: 1 }}>
          <Typography variant="h6" color="primary" sx={{ flexGrow: 1, fontWeight: 800 }}>
            {t.app}
          </Typography>
          <Button variant="contained" size="small" onClick={() => setView('manual')}>
            {t.manualOrders}
          </Button>
          <Button variant="outlined" size="small" onClick={() => setView('documents')}>
            {t.documentsNav}
          </Button>
          <Button variant="outlined" size="small" onClick={() => setView('analytics')}>
            {t.analyticsNav}
          </Button>
          <Button
            onClick={onToggleDirection}
            color="inherit"
            size="small"
            aria-label={direction === 'rtl' ? t.switchToLtr : t.switchToRtl}
          >
            {direction.toUpperCase()}
          </Button>
          <Button onClick={onToggleLocale} color="primary" size="small">
            {t.language}
          </Button>
        </Toolbar>
      </AppBar>
      <Container component="main" maxWidth="xl" sx={{ py: 4 }}>
        {view === 'documents' ? (
          <DocumentsWorkspace direction={direction} t={t} />
        ) : view === 'analytics' ? (
          <AnalyticsWorkspace locale={locale} t={t} />
        ) : view === 'manual' ? (
          <ManualOrderForm
            locale={locale}
            t={t}
            onCancel={() => setView('orders')}
            onSaved={(order) => {
              setOrders((previous) => [order, ...previous]);
            }}
          />
        ) : (
          <>
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              alignItems={{ md: 'center' }}
              justifyContent="space-between"
              gap={2}
              mb={3}
            >
              <Box>
                <Typography variant="h4" fontWeight={800} component="h1">
                  {t.orders}
                </Typography>
                <Typography color="text.secondary">{t.subtitle}</Typography>
              </Box>
              <Stack direction="row" gap={1}>
                <Button variant="outlined" onClick={() => void loadOrders()} disabled={loading}>
                  {loading ? <CircularProgress size={18} aria-label={t.loading} /> : t.refresh}
                </Button>
                <FormControl size="small" sx={{ minWidth: 150 }}>
                  <InputLabel id="orders-columns-label">{t.columns}</InputLabel>
                  <Select
                    multiple
                    value={visibleColumns}
                    labelId="orders-columns-label"
                    label={t.columns}
                    onChange={(event) => setVisibleColumns(event.target.value as string[])}
                    renderValue={(value) => `${(value as string[]).length}/${columns.length}`}
                  >
                    {columns.map((column) => (
                      <MenuItem key={column} value={column}>
                        {labelFor(column)}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Stack>
            </Stack>
            <Paper
              variant="outlined"
              sx={{ p: 2, mb: 2 }}
              component="form"
              onSubmit={(event) => {
                event.preventDefault();
                void loadOrders();
              }}
            >
              <Stack direction={{ xs: 'column', md: 'row' }} gap={2}>
                <TextField
                  fullWidth
                  size="small"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t.search}
                  inputProps={{ 'aria-label': t.search }}
                />
                <FormControl size="small" sx={{ minWidth: 170 }}>
                  <InputLabel id="orders-status-label">{t.status}</InputLabel>
                  <Select
                    value={status}
                    labelId="orders-status-label"
                    label={t.status}
                    onChange={(event) => setStatus(event.target.value)}
                  >
                    <MenuItem value="">{t.all}</MenuItem>
                    <MenuItem value="processing">{t.processing}</MenuItem>
                    <MenuItem value="completed">{t.completed}</MenuItem>
                  </Select>
                </FormControl>
                <Button type="submit" variant="contained">
                  {t.searchButton}
                </Button>
              </Stack>
            </Paper>
            {error && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                {t.errors}
              </Alert>
            )}
            <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
              <Table size="small" aria-label={t.orders} data-testid="orders-table">
                <caption
                  style={{
                    position: 'absolute',
                    width: 1,
                    height: 1,
                    overflow: 'hidden',
                    clip: 'rect(0 0 0 0)',
                  }}
                >
                  {t.orders}
                </caption>
                <TableHead>
                  <TableRow>
                    {renderedColumns.map((column) => (
                      <TableCell key={column} sx={{ fontWeight: 800, whiteSpace: 'nowrap' }}>
                        {labelFor(column)}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {orders.map((order) => (
                    <TableRow
                      key={order.id}
                      hover
                      tabIndex={0}
                      data-testid={`order-row-${order.id}`}
                      onClick={() => void openOrder(order)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          void openOrder(order);
                        }
                      }}
                      sx={{ cursor: 'pointer' }}
                    >
                      {renderedColumns.map((column) => (
                        <TableCell key={column}>
                          {column === 'remoteStatus' ? (
                            <Chip
                              size="small"
                              label={display(order, column)}
                              variant="outlined"
                              sx={
                                order.remoteStatus === 'completed'
                                  ? { color: '#1b5e20', borderColor: '#1b5e20' }
                                  : { color: '#8a4b00', borderColor: '#8a4b00' }
                              }
                            />
                          ) : (
                            <span dir={column === 'orderNumber' ? 'ltr' : undefined}>
                              {display(order, column)}
                            </span>
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {!loading && orders.length === 0 && (
                <Box textAlign="center" py={8}>
                  <Typography color="text.secondary">
                    {error ? t.noConnection : t.noOrders}
                  </Typography>
                </Box>
              )}
              {loading && orders.length === 0 && (
                <Box textAlign="center" py={6}>
                  <CircularProgress aria-label={t.loading} />
                </Box>
              )}
              {hasMore && (
                <Box textAlign="center" p={2}>
                  <Button onClick={() => void loadOrders(true)} disabled={loading}>
                    {t.loadMore}
                  </Button>
                </Box>
              )}
            </Paper>
          </>
        )}
      </Container>
      <Drawer
        anchor={direction === 'rtl' ? 'left' : 'right'}
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        aria-labelledby="order-detail-title"
        PaperProps={{ sx: { width: { xs: '100%', sm: 560 }, p: 3 } }}
      >
        {selected && (
          <OrderDetail order={selected} locale={locale} t={t} onClose={() => setSelected(null)} />
        )}
      </Drawer>
    </Box>
  );
}
