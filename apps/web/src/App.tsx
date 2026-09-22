import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  Divider,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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
  Tooltip,
  Typography,
} from '@mui/material';
import {
  AdminWorkspace,
  adminLabel,
  LoginScreen,
  sessionExpiredLabel,
  type AdminSection,
  type AuthenticatedUser,
} from './AdminWorkspaces';
import { WorkspaceShell } from './WorkspaceShell';
import { OrderOutputDialog } from './OrderOutputDialog';
import { getAppCopy, translate as tr, type TranslationKey } from './i18n';
import { wooOrderExportColumns, wooShippingExportColumns } from './wooExportColumns';
import {
  EGYPTIAN_GOVERNORATES,
  egyptianGovernorate,
  egyptianGovernorateName,
} from '@woo-ops/domain';

type Locale = 'ar' | 'en';
type Direction = 'rtl' | 'ltr';
type JsonRecord = Record<string, unknown>;
type CachedJson = { expiresAt: number; value: unknown };
const readCache = new Map<string, CachedJson>();
const inflightReads = new Map<string, Promise<unknown>>();

async function cachedGetJson<T>(url: string, ttlMs = 30_000, force = false): Promise<T> {
  const now = Date.now();
  const cached = readCache.get(url);
  if (!force && cached && cached.expiresAt > now) return cached.value as T;
  const inflight = inflightReads.get(url);
  if (!force && inflight) return inflight as Promise<T>;
  const request = fetch(url, { credentials: 'include' })
    .then(async (response) => {
      if (!response.ok) throw new Error(`READ_FAILED:${response.status}`);
      const value = (await response.json()) as T;
      readCache.set(url, { value, expiresAt: Date.now() + ttlMs });
      return value;
    })
    .finally(() => inflightReads.delete(url));
  inflightReads.set(url, request);
  return request;
}
type Order = JsonRecord & {
  id: string;
  orderNumber?: string;
  externalOrderId?: string;
  origin?: string;
  remoteStatus?: string;
  localStatus?: string;
  exportState?: string;
  remoteExportStatus?: string;
  currency?: string;
  grandTotalMinor?: string;
  billing?: JsonRecord;
  shipping?: JsonRecord;
  lines?: readonly JsonRecord[];
  refunds?: readonly JsonRecord[];
};
type QueryResponse = {
  items: Order[];
  nextCursor: string | null;
  hasMore: boolean;
  totalCount?: number;
  facets?: readonly { field: string; values: readonly { value: string; count: number }[] }[];
};
type OrderResponse = { order: Order };
type CatalogItemView = {
  id: string;
  kind: 'product' | 'variation' | 'category';
  externalId: string;
  parentExternalId: string | null;
  name: string;
  sku: string | null;
  price: string | null;
  regularPrice: string | null;
  salePrice: string | null;
  stockStatus: string | null;
  stockQuantity: number | null;
  manageStock: boolean;
  backorders: string | null;
  backordersAllowed: boolean;
  backordered: boolean;
  catalogVisibility: string | null;
  productStatus: string | null;
  productType: string | null;
  categories: readonly { id: string; name: string }[];
};
type ManualOrderConfig = {
  currency: string;
  rates: readonly {
    governorate: string;
    amountMinor: string;
    title: string;
    methodId: string;
    source: 'woocommerce' | 'environment';
  }[];
  ratesSource: 'woocommerce' | 'environment' | 'none';
  proofTypes: readonly string[];
  proofMaxBytes: number;
};
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
type DocumentBatchSummary = {
  id: string;
  action: 'generate-invoice' | 'generate-thermal' | 'generate-label' | 'print-documents';
  format: DocumentTemplate['format'];
  status: 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled';
  totalCount: number;
  processedCount: number;
  succeededCount: number;
  failedCount: number;
  attemptCount: number;
  jobId: string | null;
  error?: string | null;
  createdAt: string;
  completedAt: string | null;
};
type ExportHistoryTab = 'spreadsheets' | 'documents';

const exportHistoryTabFromLocation = (): ExportHistoryTab => {
  if (typeof window === 'undefined') return 'spreadsheets';
  return new URLSearchParams(window.location.search).get('history') === 'documents'
    ? 'documents'
    : 'spreadsheets';
};
type DocumentArtifactSummary = {
  id: string;
  kind: 'order-pdf' | 'merged-pdf' | 'zip' | 'manifest';
  filename: string;
  mimeType: string;
  byteSize: number;
  checksum: string;
};
type DocumentBatchDetails = {
  batch: DocumentBatchSummary;
  artifacts: DocumentArtifactSummary[];
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
  currency: string;
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
  freshness?: {
    lastRebuiltAt: string | null;
    jobId?: string;
    status?: AnalyticsRebuildJob['status'];
    progress?: number;
    error?: string | null;
    updatedAt?: string;
  };
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
  label?: string;
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
type AnalyticsRebuildJob = {
  id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'dead-lettered';
  progress: number;
  lastError: string | null;
};

const copy = { ar: getAppCopy('ar'), en: getAppCopy('en') } as const;

const columns = [
  'orderNumber',
  'source',
  'remoteStatus',
  'total',
  'exportState',
  'remoteExportStatus',
  'customerName',
  'customerEmail',
  'customerPhone',
  'paymentMethod',
  'shippingMethod',
  'posLocation',
  'quantityTotal',
  'createdAt',
  'updatedAt',
] as const;
const standardWooOrderStatuses = [
  'pending',
  'processing',
  'on-hold',
  'completed',
  'cancelled',
  'refunded',
  'failed',
  'checkout-draft',
] as const;
const defaultOrderColumns: readonly (typeof columns)[number][] = [
  'orderNumber',
  'remoteStatus',
  'remoteExportStatus',
  'exportState',
  'customerName',
  'total',
  'paymentMethod',
  'shippingMethod',
  'createdAt',
];

type OrderFilters = {
  source: string;
  exportState: string;
  paymentMethod: string;
  shippingMethod: string;
  governorate: string;
  posLocation: string;
  product: string;
  category: string;
  author: string;
  from: string;
  to: string;
};

const emptyOrderFilters = (): OrderFilters => ({
  source: '',
  exportState: '',
  paymentMethod: '',
  shippingMethod: '',
  governorate: '',
  posLocation: '',
  product: '',
  category: '',
  author: '',
  from: '',
  to: '',
});

const wooSourceFilter: JsonRecord = { field: 'source', operator: 'equals', value: 'woo' };

const scopeQueryToWooOrders = (query: JsonRecord): JsonRecord => {
  const filter = query.filter;
  return {
    ...query,
    filter:
      filter === undefined ? wooSourceFilter : { op: 'and', children: [wooSourceFilter, filter] },
  };
};

type SavedOrderView = {
  id: string;
  name: string;
  query: JsonRecord;
  sort: { field: string; direction: 'asc' | 'desc' } | null;
  columns: string[];
};

const asRecord = (value: unknown): JsonRecord =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : {};

const asList = (value: unknown): readonly JsonRecord[] =>
  Array.isArray(value) ? value.map(asRecord) : [];

const latinDigits = (value: string): string =>
  value
    .replace(/[٠-٩]/gu, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/gu, (digit) => String(digit.charCodeAt(0) - 0x06f0));

const valueText = (value: unknown, fallback = '—'): string =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? latinDigits(String(value))
    : fallback;

const dateText = (value: unknown, locale: Locale): string => {
  if (typeof value !== 'string' || value.length === 0) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-US-u-nu-latn', {
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
    return `${negative ? '-' : ''}${whole.toLocaleString('en-US-u-nu-latn')}.${fraction} ${currency}`;
  } catch {
    return `— ${currency}`;
  }
};

function MoneyValue({
  value,
  currency,
  locale,
  fontWeight,
}: {
  value: unknown;
  currency: string;
  locale: Locale;
  fontWeight?: number;
}) {
  return (
    <Box
      component="span"
      dir="ltr"
      sx={{ display: 'inline-block', unicodeBidi: 'isolate', fontWeight }}
    >
      {formatMinor(value, currency, locale)}
    </Box>
  );
}

const orderCustomerName = (order: Order): string => {
  const billing = asRecord(order.billing);
  return `${valueText(billing.first_name, '')} ${valueText(billing.last_name, '')}`.trim() || '—';
};

const paymentMethodLabel = (value: unknown, locale: Locale): string => {
  const raw = valueText(value, '').trim();
  const normalized = raw.toLowerCase().replace(/[\s_-]+/gu, ' ');
  const labels: Record<string, TranslationKey> = {
    'mobile wallets': 'labels.paymentMethod.mobileWallets',
    'paymob wallet': 'labels.paymentMethod.paymobWallet',
    'pay with paymob': 'labels.paymentMethod.paymob',
    bacs: 'labels.paymentMethod.bankTransfer',
    'bank transfer': 'labels.paymentMethod.bankTransfer',
    cod: 'labels.paymentMethod.cashOnDelivery',
    cheque: 'labels.paymentMethod.cheque',
  };
  const matched = labels[normalized];
  return matched ? tr(locale, matched) : raw || '—';
};

const shippingMethodLabel = (value: unknown, locale: Locale): string => {
  const raw = valueText(value, '').trim();
  const normalized = raw.toLowerCase().replace(/[\s_-]+/gu, ' ');
  if (!raw) return '—';
  if (normalized === 'flat rate') return tr(locale, 'inline.app.flatRate');
  if (normalized === 'free shipping') return tr(locale, 'inline.app.freeShipping');
  if (normalized === 'local pickup') return tr(locale, 'inline.app.localPickup');
  if (/فاتورتك/u.test(raw)) return tr(locale, 'inline.app.fatortakShipping');
  return raw;
};

const addressLines = (addressValue: unknown, locale: Locale = 'ar'): string[] => {
  const address = asRecord(addressValue);
  return [
    ['first_name', 'last_name']
      .map((key) => valueText(address[key], ''))
      .join(' ')
      .trim(),
    valueText(address.company, ''),
    valueText(address.address_1, ''),
    valueText(address.address_2, ''),
    [
      address.city,
      address.governorateNameAr ??
        address.governorateNameEn ??
        egyptianGovernorateName(address.stateCode ?? address.state, locale),
      address.postcode,
    ]
      .map((value) => valueText(value, ''))
      .filter(Boolean)
      .join(', '),
    valueText(address.country, ''),
  ].filter(Boolean);
};

const emptyAnalyticsFilters = (): AnalyticsFilterState => ({
  source: 'woo',
  currency: '',
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
  | 'remoteStatus'
  | 'governorate'
  | 'customer'
  | 'shippingMethod'
  | 'paymentMethod'
  | 'product'
  | 'category';

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
  const [dimension, setDimension] = useState<AnalyticsDimension>('product');
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [rebuildJob, setRebuildJob] = useState<AnalyticsRebuildJob | null>(null);

  const loadAnalytics = async (
    nextFilters: AnalyticsFilterState,
    nextDimension: AnalyticsDimension,
  ) => {
    setLoading(true);
    setError(false);
    const payload = {
      ...(nextFilters.source === 'combined' ? {} : { source: nextFilters.source }),
      ...(nextFilters.currency ? { currency: nextFilters.currency } : {}),
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

  const rebuildAnalytics = async () => {
    const payload = {
      ...(appliedFilters.source === 'combined' ? {} : { source: appliedFilters.source }),
      ...(appliedFilters.currency ? { currency: appliedFilters.currency } : {}),
      ...(appliedFilters.from ? { from: appliedFilters.from } : {}),
      ...(appliedFilters.to ? { to: appliedFilters.to } : {}),
      ...(appliedFilters.store ? { store: appliedFilters.store } : {}),
      ...(appliedFilters.status ? { status: appliedFilters.status } : {}),
      ...(appliedFilters.shippingMethod ? { shippingMethod: appliedFilters.shippingMethod } : {}),
      ...(appliedFilters.product ? { product: appliedFilters.product } : {}),
      ...(appliedFilters.category ? { category: appliedFilters.category } : {}),
      ...(appliedFilters.author ? { author: appliedFilters.author } : {}),
      idempotencyKey: crypto.randomUUID(),
    };
    try {
      const response = await fetch('/api/v1/analytics/rebuilds', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken() },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error('ANALYTICS_REBUILD_FAILED');
      const body = (await response.json()) as {
        job: {
          id: string;
          status: AnalyticsRebuildJob['status'];
          progress: number;
          lastError: string | null;
        };
      };
      setRebuildJob(body.job);
      for (let attempt = 0; attempt < 60; attempt += 1) {
        if (body.job.status === 'succeeded' || body.job.status === 'failed') break;
        await new Promise((resolve) => setTimeout(resolve, 500));
        const statusResponse = await fetch(
          `/api/v1/operations/jobs/${encodeURIComponent(body.job.id)}`,
          { credentials: 'include' },
        );
        if (!statusResponse.ok) break;
        const statusBody = (await statusResponse.json()) as { job: AnalyticsRebuildJob };
        setRebuildJob(statusBody.job);
        if (['succeeded', 'failed', 'dead-lettered'].includes(statusBody.job.status)) {
          if (statusBody.job.status === 'succeeded') await loadAnalytics(appliedFilters, dimension);
          break;
        }
      }
    } catch {
      setRebuildJob({
        id: 'local-error',
        status: 'failed',
        progress: 0,
        lastError: 'ANALYTICS_REBUILD_FAILED',
      });
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
  const freshnessInfo = summary?.freshness;
  const freshness = freshnessInfo?.lastRebuiltAt ?? null;
  const coverage = summary?.costCoverage;

  const updateFilter = <K extends keyof AnalyticsFilterState>(
    key: K,
    value: AnalyticsFilterState[K],
  ) => setFilters((current) => ({ ...current, [key]: value }));

  return (
    <Stack gap={3} data-testid="analytics-workspace">
      <Box>
        <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={2}>
          <Box>
            <Typography variant="h4" component="h1" fontWeight={800}>
              {t.analyticsTitle}
            </Typography>
            <Typography color="text.secondary">{t.analyticsSubtitle}</Typography>
          </Box>
          <Button
            variant="outlined"
            onClick={() => void rebuildAnalytics()}
            disabled={
              loading || rebuildJob?.status === 'queued' || rebuildJob?.status === 'running'
            }
          >
            {rebuildJob?.status === 'queued' || rebuildJob?.status === 'running'
              ? `${t.rebuildQueued} (${rebuildJob.progress}%)`
              : t.rebuildAnalytics}
          </Button>
        </Stack>
      </Box>

      {rebuildJob?.status === 'failed' || rebuildJob?.status === 'dead-lettered' ? (
        <Alert severity="error" data-testid="analytics-rebuild-error">
          {t.rebuildFailed}: {rebuildJob.lastError ?? 'unknown'}
        </Alert>
      ) : rebuildJob ? (
        <Alert severity="info" data-testid="analytics-rebuild-status">
          {t.rebuildQueued} · {rebuildJob.progress}%
        </Alert>
      ) : null}

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
            <Chip label={tr(locale, 'inline.app.woocommerceData')} />
            <Typography variant="body2" color="text.secondary">
              {t.currencySeparated}
            </Typography>
          </Stack>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: {
                xs: '1fr',
                sm: 'repeat(2, minmax(0, 1fr))',
                lg: 'repeat(4, minmax(180px, 1fr))',
              },
              gap: 2,
              '& .MuiFormControl-root': { width: '100%', minWidth: 0 },
            }}
          >
            <TextField
              size="small"
              label={t.currencyFilter}
              value={filters.currency}
              onChange={(event) => updateFilter('currency', event.target.value.toUpperCase())}
              inputProps={{ maxLength: 3 }}
            />
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
            <FormControl size="small">
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
          </Box>
          <Stack direction="row" gap={1.5} justifyContent="flex-end" flexWrap="wrap">
            <Button type="submit" variant="contained" disabled={loading} sx={{ minWidth: 140 }}>
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
                    <Box
                      sx={{
                        display: 'grid',
                        gridTemplateColumns: { xs: '1fr 1fr', lg: 'repeat(4, 1fr)' },
                        gap: 2,
                      }}
                    >
                      <Box data-testid="analytics-revenue">
                        <Typography variant="caption" color="text.secondary">
                          {t.revenue}
                        </Typography>
                        <Typography variant="h5" component="div" fontWeight={800}>
                          <MoneyValue
                            value={currency.totals.collectedRevenueMinor}
                            currency={currency.currency}
                            locale={locale}
                          />
                        </Typography>
                      </Box>
                      <Box>
                        <Typography variant="caption" color="text.secondary">
                          {tr(locale, 'inline.app.netSales')}
                        </Typography>
                        <Typography variant="h6" component="div" fontWeight={800}>
                          <MoneyValue
                            value={(
                              BigInt(currency.totals.netMerchandiseMinor) -
                              BigInt(currency.totals.refundsMinor)
                            ).toString()}
                            currency={currency.currency}
                            locale={locale}
                          />
                        </Typography>
                      </Box>
                      <Box>
                        <Typography variant="caption" color="text.secondary">
                          {tr(locale, 'inline.app.totalSales')}
                        </Typography>
                        <Typography variant="h6" component="div" fontWeight={800}>
                          <MoneyValue
                            value={(
                              BigInt(currency.totals.netMerchandiseMinor) -
                              BigInt(currency.totals.refundsMinor) +
                              BigInt(currency.totals.shippingCollectedMinor) +
                              BigInt(currency.totals.taxMinor)
                            ).toString()}
                            currency={currency.currency}
                            locale={locale}
                          />
                        </Typography>
                      </Box>
                      <Box>
                        <Typography variant="caption" color="text.secondary">
                          {t.ordersCount}
                        </Typography>
                        <Typography variant="h6" component="div" fontWeight={800}>
                          {currency.orderCount}
                        </Typography>
                      </Box>
                      <Box>
                        <Typography variant="caption" color="text.secondary">
                          {tr(locale, 'inline.app.averageOrderValue')}
                        </Typography>
                        <Typography variant="h6" component="div" fontWeight={800}>
                          <MoneyValue
                            value={
                              currency.orderCount > 0
                                ? (
                                    (BigInt(currency.totals.netMerchandiseMinor) -
                                      BigInt(currency.totals.refundsMinor)) /
                                    BigInt(currency.orderCount)
                                  ).toString()
                                : '0'
                            }
                            currency={currency.currency}
                            locale={locale}
                          />
                        </Typography>
                      </Box>
                      {(
                        [
                          ['grossSalesMinor', tr(locale, 'inline.app.grossSales')],
                          ['discountMinor', t.discount],
                          ['refundsMinor', t.refund],
                          ['shippingCollectedMinor', t.shippingCollected],
                          ['taxMinor', t.tax],
                          ['contributionProfitMinor', t.profit],
                        ] as const
                      ).map(([key, label]) => (
                        <Box
                          key={key}
                          data-testid={
                            key === 'contributionProfitMinor' ? 'analytics-profit' : undefined
                          }
                        >
                          <Typography variant="caption" color="text.secondary">
                            {label}
                          </Typography>
                          <Typography fontWeight={700}>
                            <MoneyValue
                              value={currency.totals[key]}
                              currency={currency.currency}
                              locale={locale}
                            />
                          </Typography>
                        </Box>
                      ))}
                    </Box>
                  </Stack>
                </CardContent>
              </Card>
            ))}
          </Stack>

          <Typography variant="caption" color="text.secondary">
            {tr(
              locale,
              'inline.app.calculatedFromReadOnlyWoocommerceOrderSnapshotsRefundsAreAttribu',
            )}
          </Typography>

          <Stack direction={{ xs: 'column', md: 'row' }} gap={2}>
            <Paper variant="outlined" sx={{ p: 2, flex: 1 }}>
              <Typography variant="h6" component="h2" fontWeight={800} gutterBottom>
                {t.freshness}
              </Typography>
              <Typography variant="body2">
                {t.lastRebuilt}: {freshness ? dateText(freshness, locale) : t.coverageUnavailable}
              </Typography>
              {freshnessInfo?.status && (
                <Typography variant="body2" sx={{ mt: 1 }} data-testid="analytics-freshness-job">
                  {t.rebuildState}: {freshnessInfo.status} · {freshnessInfo.progress ?? 0}%
                </Typography>
              )}
              {freshnessInfo?.error && (
                <Typography variant="body2" color="error" sx={{ mt: 1 }}>
                  {t.rebuildError}: {freshnessInfo.error}
                </Typography>
              )}
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
                              <MoneyValue
                                value={item.totals.collectedRevenueMinor}
                                currency={item.currency}
                                locale={locale}
                              />
                              <LinearProgress
                                variant="determinate"
                                value={Math.min(width, 100)}
                                aria-label={t.revenue}
                              />
                            </Stack>
                          </TableCell>
                          <TableCell>
                            <MoneyValue
                              value={item.totals.contributionProfitMinor}
                              currency={item.currency}
                              locale={locale}
                            />
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
            </Stack>
            <Tabs
              value={dimension}
              onChange={(_event, value: AnalyticsDimension) => setDimension(value)}
              variant="scrollable"
              scrollButtons="auto"
              allowScrollButtonsMobile
              aria-label={t.breakdownDimension}
              sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
            >
              <Tab value="product" label={t.dimensionProduct} />
              <Tab value="category" label={t.dimensionCategory} />
              <Tab value="customer" label={t.dimensionCustomer} />
              <Tab value="remoteStatus" label={t.dimensionRemoteStatus} />
              <Tab value="governorate" label={t.dimensionGovernorate} />
              <Tab value="shippingMethod" label={t.dimensionShipping} />
              <Tab value="paymentMethod" label={t.payment} />
            </Tabs>
            <Table size="small" aria-label={t.breakdown}>
              <TableHead>
                <TableRow>
                  <TableCell>{t.breakdownDimension}</TableCell>
                  <TableCell>{t.currency}</TableCell>
                  <TableCell>
                    {dimension === 'product' || dimension === 'category'
                      ? tr(locale, 'inline.app.itemSalesAfterDiscountsBeforeReturns')
                      : t.revenue}
                  </TableCell>
                  <TableCell>
                    {dimension === 'product' || dimension === 'category'
                      ? tr(locale, 'inline.app.itemsSold')
                      : t.profit}
                  </TableCell>
                  <TableCell>{t.ordersCount}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.breakdown.map((item) => (
                  <TableRow key={`${item.key}-${item.currency}`}>
                    <TableCell>
                      {dimension === 'governorate'
                        ? `${egyptianGovernorateName(item.key, locale)} (${item.key})`
                        : (item.label ?? item.key)}
                    </TableCell>
                    <TableCell>{item.currency}</TableCell>
                    <TableCell>
                      <MoneyValue
                        value={
                          dimension === 'product' || dimension === 'category'
                            ? item.totals.netMerchandiseMinor
                            : item.totals.collectedRevenueMinor
                        }
                        currency={item.currency}
                        locale={locale}
                      />
                    </TableCell>
                    <TableCell>
                      {dimension === 'product' || dimension === 'category' ? (
                        item.lineCount
                      ) : (
                        <MoneyValue
                          value={item.totals.contributionProfitMinor}
                          currency={item.currency}
                          locale={locale}
                        />
                      )}
                    </TableCell>
                    <TableCell>{item.orderCount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>

          <Paper
            component="details"
            variant="outlined"
            sx={{ p: 2, '& summary': { cursor: 'pointer' } }}
          >
            <Typography variant="h6" component="summary" fontWeight={800} gutterBottom>
              {t.formulas}
            </Typography>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              {t.excludedStatuses}: {summary.excludedStatuses.join(', ')} · v
              {summary.metricsVersion}
            </Typography>
            <Alert severity="info" sx={{ mb: 2 }} data-testid="analytics-metric-sources">
              {t.metricScopeNote}
            </Alert>
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

function Address({
  title,
  value,
  empty,
  locale,
}: {
  title: string;
  value: unknown;
  empty: string;
  locale: Locale;
}) {
  const lines = addressLines(value, locale);
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
  onUpdated,
}: {
  order: Order;
  locale: Locale;
  t: (typeof copy)[Locale];
  onClose: () => void;
  onUpdated?: (order: Order) => void;
}) {
  const [tab, setTab] = useState(0);
  const [workflowMessage, setWorkflowMessage] = useState('');
  const [timeline, setTimeline] = useState<JsonRecord[]>([]);
  const currency = valueText(order.currency, '');
  const amounts = asRecord(order.amounts);
  const payment = asRecord(order.payment);
  const shippingMethod = asRecord(order.shippingMethod);
  const syncEvents = asList(order.syncEvents ?? order.syncTimeline);
  const auditEvents = asList(order.auditHistory ?? order.auditEvents);
  const exports = asList(order.exports ?? order.exportHistory);
  const documents = asList(order.documents ?? order.documentHistory);
  const tabLabels = [t.summary, t.items, t.customer, t.finance, t.history, t.raw];

  useEffect(() => {
    setWorkflowMessage('');
    let active = true;
    void fetch(`/api/v1/orders/${encodeURIComponent(order.id)}/timeline`, {
      credentials: 'include',
    })
      .then(async (response) =>
        response.ok
          ? (((await response.json()) as { timeline?: { items?: JsonRecord[] } }).timeline?.items ??
            [])
          : [],
      )
      .then((items) => {
        if (active) setTimeline(items);
      })
      .catch(() => {
        if (active) setTimeline([]);
      });
    return () => {
      active = false;
    };
  }, [order.id]);

  const requestResync = async () => {
    try {
      const response = await fetch(`/api/v1/orders/${encodeURIComponent(order.id)}/resync`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken() },
        body: '{}',
      });
      if (!response.ok) throw new Error('ORDER_RESYNC_FAILED');
      setWorkflowMessage(t.resyncQueued);
    } catch {
      setWorkflowMessage(t.errors);
    }
  };

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
            <Address title={t.billing} value={order.billing} empty={t.noData} locale={locale} />
            <Address
              title={t.shippingAddress}
              value={order.shipping}
              empty={t.noData}
              locale={locale}
            />
          </Stack>
        )}
        {tab === 3 && (
          <Stack gap={2}>
            <Section title={t.payment}>
              <Fact
                label={t.method}
                value={valueText(
                  paymentMethodLabel(
                    payment.title ??
                      payment.methodTitle ??
                      order.paymentMethodTitle ??
                      order.paymentMethod,
                    locale,
                  ),
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
                value={shippingMethodLabel(
                  shippingMethod.title ?? order.shippingMethodTitle,
                  locale,
                )}
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
            {workflowMessage && <Alert severity="success">{workflowMessage}</Alert>}
            {order.origin === 'woo' && (
              <Button
                variant="outlined"
                onClick={() => void requestResync()}
                sx={{ alignSelf: 'flex-start' }}
              >
                {t.resync}
              </Button>
            )}
            <HistoryList title={t.syncEvents} entries={syncEvents} empty={t.noData} />
            <HistoryList title={t.exports} entries={exports} empty={t.noData} />
            <HistoryList title={t.documents} entries={documents} empty={t.noData} />
            <HistoryList title={t.audit} entries={auditEvents} empty={t.noData} />
            <HistoryList title={t.timeline} entries={timeline} empty={t.noData} />
          </Stack>
        )}
        {tab === 5 && <Alert severity="warning">{t.restricted}</Alert>}
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

function CatalogWorkspace({ locale, onSync }: { locale: Locale; onSync: () => void }) {
  const [items, setItems] = useState<CatalogItemView[]>([]);
  const [categories, setCategories] = useState<CatalogItemView[]>([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [stockStatus, setStockStatus] = useState('');
  const [backorders, setBackorders] = useState('');
  const [visibility, setVisibility] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const fetchCatalogPages = async (initial: URLSearchParams): Promise<CatalogItemView[]> => {
    const result: CatalogItemView[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 100; page += 1) {
      const query = new URLSearchParams(initial);
      if (cursor) query.set('cursor', cursor);
      const response = await fetch(`/api/v1/catalog?${query}`, { credentials: 'include' });
      if (!response.ok) throw new Error('CATALOG_FAILED');
      const body = (await response.json()) as {
        items: CatalogItemView[];
        nextCursor: string | null;
        hasMore: boolean;
      };
      result.push(...body.items);
      if (!body.hasMore || !body.nextCursor) break;
      cursor = body.nextCursor;
    }
    return result;
  };
  const load = async () => {
    setLoading(true);
    setError(false);
    try {
      const query = new URLSearchParams({ limit: '100', kind: 'product' });
      if (search.trim()) query.set('search', search.trim());
      if (category.trim()) query.set('category', category.trim());
      if (stockStatus) query.set('stockStatus', stockStatus);
      if (backorders) query.set('backorders', backorders);
      if (visibility) query.set('visibility', visibility);
      const variationQuery = new URLSearchParams(query);
      variationQuery.set('kind', 'variation');
      const [products, variations, categoryItems] = await Promise.all([
        fetchCatalogPages(query),
        fetchCatalogPages(variationQuery),
        fetchCatalogPages(new URLSearchParams({ limit: '100', kind: 'category' })),
      ]);
      setItems([
        ...products.filter((item) => item.kind === 'product'),
        ...variations.filter((item) => item.kind === 'variation'),
      ]);
      setCategories(categoryItems);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  return (
    <Stack gap={2} data-testid="catalog-workspace">
      <Box>
        <Typography variant="h4" component="h1" fontWeight={800}>
          {tr(locale, 'inline.app.productsStockCatalog')}
        </Typography>
        <Typography color="text.secondary">
          {tr(locale, 'inline.app.aReadOnlyWoocommerceSnapshotPricesAndStockCannotBeEditedHere')}
        </Typography>
      </Box>
      <Paper
        component="form"
        variant="outlined"
        sx={{ p: 2 }}
        onSubmit={(event) => {
          event.preventDefault();
          void load();
        }}
      >
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: '1fr',
              md: 'repeat(2, minmax(0, 1fr))',
              lg: 'repeat(3, minmax(0, 1fr))',
            },
            gap: 2,
            '& .MuiFormControl-root': { minWidth: 0 },
          }}
        >
          <TextField
            fullWidth
            size="small"
            label={tr(locale, 'inline.app.searchProductName')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <Autocomplete
            fullWidth
            size="small"
            options={categories.map((item) => item.name)}
            value={category || null}
            onChange={(_event, value) => setCategory(value ?? '')}
            renderInput={(params) => (
              <TextField {...params} label={tr(locale, 'inline.app.category')} />
            )}
          />
          <TextField
            select
            fullWidth
            size="small"
            label={tr(locale, 'inline.app.stockStatus')}
            value={stockStatus}
            onChange={(event) => setStockStatus(event.target.value)}
          >
            <MenuItem value="">{tr(locale, 'inline.app.allStatuses')}</MenuItem>
            <MenuItem value="instock">{tr(locale, 'inline.app.inStock')}</MenuItem>
            <MenuItem value="outofstock">{tr(locale, 'inline.app.outOfStock')}</MenuItem>
            <MenuItem value="onbackorder">{tr(locale, 'inline.app.onBackorder')}</MenuItem>
          </TextField>
          <TextField
            select
            fullWidth
            size="small"
            label={tr(locale, 'inline.app.backorders')}
            value={backorders}
            onChange={(event) => setBackorders(event.target.value)}
          >
            <MenuItem value="">{tr(locale, 'inline.app.all')}</MenuItem>
            <MenuItem value="no">{tr(locale, 'inline.app.notAllowed')}</MenuItem>
            <MenuItem value="notify">{tr(locale, 'inline.app.allowedWithNotice')}</MenuItem>
            <MenuItem value="yes">{tr(locale, 'inline.app.allowed')}</MenuItem>
          </TextField>
          <TextField
            select
            fullWidth
            size="small"
            label={tr(locale, 'inline.app.catalogVisibility')}
            value={visibility}
            onChange={(event) => setVisibility(event.target.value)}
          >
            <MenuItem value="">{tr(locale, 'inline.app.all')}</MenuItem>
            <MenuItem value="visible">{tr(locale, 'inline.app.shopAndSearch')}</MenuItem>
            <MenuItem value="catalog">{tr(locale, 'inline.app.shopOnly')}</MenuItem>
            <MenuItem value="search">{tr(locale, 'inline.app.searchOnly')}</MenuItem>
            <MenuItem value="hidden">{tr(locale, 'inline.app.hidden')}</MenuItem>
          </TextField>
          <Button type="submit" variant="contained">
            {tr(locale, 'inline.app.apply')}
          </Button>
        </Box>
      </Paper>
      {error && <Alert severity="error">{tr(locale, 'inline.app.catalogCouldNotBeLoaded')}</Alert>}
      <Paper variant="outlined">
        <TableContainer>
          <Table size="small" aria-label={tr(locale, 'inline.app.productCatalog')}>
            <TableHead>
              <TableRow>
                <TableCell>{tr(locale, 'inline.app.product')}</TableCell>
                <TableCell>{tr(locale, 'inline.app.categories')}</TableCell>
                <TableCell>{tr(locale, 'inline.app.price')}</TableCell>
                <TableCell>{tr(locale, 'inline.app.stock')}</TableCell>
                <TableCell>{tr(locale, 'inline.app.backorders')}</TableCell>
                <TableCell>{tr(locale, 'inline.app.visibility')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>{item.name}</TableCell>
                  <TableCell>
                    {item.categories.map((entry) => entry.name).join(', ') || '—'}
                  </TableCell>
                  <TableCell>
                    <Box component="bdi" dir="ltr">
                      {item.price ?? '—'}
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      color={item.stockStatus === 'instock' ? 'success' : 'default'}
                      label={
                        <Box
                          component="span"
                          dir="ltr"
                          sx={{ unicodeBidi: 'isolate' }}
                        >{`${item.stockStatus ?? 'unknown'}${item.stockQuantity === null ? '' : ` · ${item.stockQuantity}`}`}</Box>
                      }
                    />
                  </TableCell>
                  <TableCell>
                    {item.backorders === 'notify'
                      ? tr(locale, 'inline.app.allowedWithNotice')
                      : item.backorders === 'yes'
                        ? tr(locale, 'inline.app.allowed')
                        : tr(locale, 'inline.app.notAllowed')}
                  </TableCell>
                  <TableCell>{item.catalogVisibility ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        {loading && <LinearProgress />}
        {!loading && items.length === 0 && (
          <Stack p={5} gap={2} alignItems="center" textAlign="center">
            <Typography fontWeight={700}>
              {tr(locale, 'inline.app.noWoocommerceProductsHaveBeenSynchronizedYet')}
            </Typography>
            <Typography color="text.secondary">
              {tr(locale, 'inline.app.openTheWoocommerceConnectionVerifyItThenRunTheInitialSync')}
            </Typography>
            <Button variant="contained" onClick={onSync}>
              {tr(locale, 'inline.app.openConnectionSync')}
            </Button>
          </Stack>
        )}
      </Paper>
    </Stack>
  );
}

function ManualOrdersWorkspace({ locale, onCreate }: { locale: Locale; onCreate: () => void }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const load = async () => {
    setLoading(true);
    setError(false);
    try {
      const response = await fetch('/api/v1/orders/query', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          filter: { field: 'origin', operator: 'equals', value: 'manual' },
          limit: 50,
          sort: { field: 'createdAt', direction: 'desc' },
        }),
      });
      if (!response.ok) throw new Error('MANUAL_QUEUE_FAILED');
      const body = (await response.json()) as QueryResponse;
      setOrders(body.items);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  return (
    <Stack gap={2} data-testid="manual-orders-workspace">
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={2}>
        <Box>
          <Typography variant="h4" component="h1" fontWeight={800}>
            {tr(locale, 'inline.app.manualOrderOperations')}
          </Typography>
          <Typography color="text.secondary">
            {tr(locale, 'inline.app.aSeparateLocalQueueThatNeverWritesToWoocommerceOrInventory')}
          </Typography>
        </Box>
        <Button variant="contained" onClick={onCreate}>
          {tr(locale, 'inline.app.newManualOrder')}
        </Button>
      </Stack>
      {error && (
        <Alert severity="error">{tr(locale, 'inline.app.manualOrdersCouldNotBeLoaded')}</Alert>
      )}
      <Paper variant="outlined">
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{tr(locale, 'inline.app.order')}</TableCell>
                <TableCell>{tr(locale, 'inline.app.customer')}</TableCell>
                <TableCell>{tr(locale, 'inline.app.total')}</TableCell>
                <TableCell>{tr(locale, 'inline.app.export')}</TableCell>
                <TableCell>{tr(locale, 'inline.app.transferProof')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {orders.map((order) => (
                <TableRow key={order.id}>
                  <TableCell>{order.orderNumber}</TableCell>
                  <TableCell>{valueText(order.customerName ?? orderCustomerName(order))}</TableCell>
                  <TableCell>
                    {formatMinor(order.grandTotalMinor, order.currency ?? 'EGP', locale)}
                  </TableCell>
                  <TableCell>{order.exportState}</TableCell>
                  <TableCell>
                    {order.localStatus === 'confirmed' ? (
                      <Button
                        size="small"
                        href={`/api/v1/manual-orders/${encodeURIComponent(order.id)}/payment-proof`}
                      >
                        {tr(locale, 'inline.app.download')}
                      </Button>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        {loading && <LinearProgress />}
        {!loading && orders.length === 0 && (
          <Box p={4} textAlign="center">
            —
          </Box>
        )}
      </Paper>
    </Stack>
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
  const [governorate, setGovernorate] = useState('');
  const [shippingRateKey, setShippingRateKey] = useState('');
  const [currency, setCurrency] = useState('EGP');
  const [catalog, setCatalog] = useState<CatalogItemView[]>([]);
  const [selectedCatalogId, setSelectedCatalogId] = useState('');
  const [manualLines, setManualLines] = useState<
    Array<{
      catalogId: string;
      name: string;
      sku?: string;
      productId: string;
      variationId?: string;
      quantity: number;
      unitPriceMinor: string;
    }>
  >([]);
  const [config, setConfig] = useState<ManualOrderConfig | null>(null);
  const [paymentProof, setPaymentProof] = useState<File | null>(null);
  const [productName, setProductName] = useState('');
  const [productSku, setProductSku] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unitPriceMinor, setUnitPriceMinor] = useState('0');
  const [shippingMinor, setShippingMinor] = useState('0');
  const [discountMinor, setDiscountMinor] = useState('0');
  const [taxMinor, setTaxMinor] = useState('0');
  const [feesMinor, setFeesMinor] = useState('0');
  const localStatus = 'awaiting-payment-proof';
  const [tags, setTags] = useState('manual');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    const loadAllProducts = async (): Promise<{ items: CatalogItemView[] }> => {
      const items: CatalogItemView[] = [];
      let cursor: string | null = null;
      for (const kind of ['product', 'variation']) {
        cursor = null;
        for (let page = 0; page < 100; page += 1) {
          const query = new URLSearchParams({ limit: '100', kind });
          if (cursor) query.set('cursor', cursor);
          const response = await fetch(`/api/v1/catalog?${query}`, { credentials: 'include' });
          if (!response.ok) throw new Error('CATALOG_FAILED');
          const body = (await response.json()) as {
            items: CatalogItemView[];
            nextCursor: string | null;
            hasMore: boolean;
          };
          items.push(...body.items.filter((item) => item.kind === kind));
          if (!body.hasMore || !body.nextCursor) break;
          cursor = body.nextCursor;
        }
      }
      return { items };
    };
    void Promise.all([
      loadAllProducts(),
      fetch('/api/v1/manual-orders/config', { credentials: 'include' }).then(async (response) => {
        if (!response.ok) throw new Error('CONFIG_FAILED');
        return (await response.json()) as ManualOrderConfig;
      }),
    ])
      .then(([catalogResponse, configResponse]) => {
        setCatalog(
          catalogResponse.items.filter(
            (item) => (item.kind === 'product' || item.kind === 'variation') && item.price !== null,
          ),
        );
        setConfig(configResponse);
        setCurrency(configResponse.currency);
      })
      .catch(() => setError(true));
  }, []);
  const selectCatalogProduct = (id: string) => {
    setSelectedCatalogId(id);
    const item = catalog.find((candidate) => candidate.id === id);
    if (!item) {
      setProductName('');
      setProductSku('');
      setUnitPriceMinor('0');
      return;
    }
    setProductName(item.name);
    setProductSku(item.sku ?? '');
    const match = /^(\d+)(?:\.(\d{1,2}))?$/u.exec(item.price ?? '');
    if (match)
      setUnitPriceMinor(`${match[1]}${(match[2] ?? '').padEnd(2, '0')}`.replace(/^0+(?=\d)/u, ''));
  };
  const selectGovernorate = (value: string) => {
    setGovernorate(value);
    const rate = config?.rates.find(
      (candidate) => egyptianGovernorate(candidate.governorate)?.code === value,
    );
    setShippingRateKey(rate ? `${rate.governorate}:${rate.methodId}:${rate.amountMinor}` : '');
    setShippingMinor(rate?.amountMinor ?? '0');
  };
  const selectedShippingRate =
    config?.rates.find(
      (rate) => `${rate.governorate}:${rate.methodId}:${rate.amountMinor}` === shippingRateKey,
    ) ?? null;
  const governorateRates = EGYPTIAN_GOVERNORATES.map((governorate) => ({
    ...governorate,
    rate: config?.rates.find(
      (candidate) => egyptianGovernorate(candidate.governorate)?.code === governorate.code,
    ),
  }));
  const currentManualLine = () => {
    const item = catalog.find((candidate) => candidate.id === selectedCatalogId);
    const parsedQuantity = Number(quantity);
    if (!item || !Number.isInteger(parsedQuantity) || parsedQuantity < 1) return null;
    return {
      catalogId: item.id,
      name: productName,
      ...(productSku ? { sku: productSku } : {}),
      productId: item.parentExternalId ?? item.externalId,
      ...(item.kind === 'variation' ? { variationId: item.externalId } : {}),
      quantity: parsedQuantity,
      unitPriceMinor,
    };
  };
  const addCurrentLine = () => {
    const line = currentManualLine();
    if (!line) return;
    setManualLines((current) => [...current, line]);
    selectCatalogProduct('');
    setQuantity('1');
  };
  const totalMinor = useMemo(() => {
    try {
      const savedSubtotal = manualLines.reduce(
        (sum, line) => sum + BigInt(line.unitPriceMinor) * BigInt(line.quantity),
        0n,
      );
      const currentSubtotal = selectedCatalogId
        ? BigInt(unitPriceMinor || '0') * BigInt(quantity || '0')
        : 0n;
      const subtotal = savedSubtotal + currentSubtotal;
      const value =
        subtotal -
        BigInt(discountMinor || '0') +
        BigInt(taxMinor || '0') +
        BigInt(shippingMinor || '0') +
        BigInt(feesMinor || '0');
      return value.toString();
    } catch {
      return '0';
    }
  }, [
    discountMinor,
    feesMinor,
    manualLines,
    quantity,
    selectedCatalogId,
    shippingMinor,
    taxMinor,
    unitPriceMinor,
  ]);
  const shippingRatesConfigured = (config?.rates.length ?? 0) > 0;
  const selectedCatalogItem =
    catalog.find((candidate) => candidate.id === selectedCatalogId) ?? null;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const pendingLine = currentManualLine();
    const lines = [...manualLines, ...(pendingLine ? [pendingLine] : [])];
    if (lines.length === 0 || !governorate || !paymentProof || !config) {
      setError(true);
      return;
    }
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
          shipping: { first_name: customerName, address_1: address, state: governorate },
          payment: { method: 'bank-transfer', title: 'Bank transfer' },
          shippingMethod: {
            methodId: selectedShippingRate?.methodId ?? 'configured-rate',
            title: selectedShippingRate?.title ?? governorate,
          },
          lines: lines.map((line) => ({
            name: line.name,
            ...(line.sku ? { sku: line.sku } : {}),
            productId: line.productId,
            ...(line.variationId ? { variationId: line.variationId } : {}),
            quantity: line.quantity,
            unitPriceMinor: line.unitPriceMinor,
          })),
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
      let savedOrder = body.order;
      if (paymentProof) {
        const proofResponse = await fetch(
          `/api/v1/manual-orders/${encodeURIComponent(body.order.id)}/payment-proof`,
          {
            method: 'POST',
            credentials: 'include',
            headers: {
              'content-type': paymentProof.type,
              'x-file-name': paymentProof.name,
              'x-csrf-token': csrfToken(),
            },
            body: paymentProof,
          },
        );
        if (!proofResponse.ok) throw new Error('PAYMENT_PROOF_UPLOAD_FAILED');
        const confirmResponse = await fetch(
          `/api/v1/manual-orders/${encodeURIComponent(body.order.id)}`,
          {
            method: 'PATCH',
            credentials: 'include',
            headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken() },
            body: JSON.stringify({ version: 1, localStatus: 'confirmed' }),
          },
        );
        if (!confirmResponse.ok) throw new Error('MANUAL_ORDER_CONFIRM_FAILED');
        savedOrder = ((await confirmResponse.json()) as OrderResponse).order;
      }
      setSaved(true);
      onSaved(savedOrder);
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
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' },
              gap: 2,
            }}
          >
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
              required
              fullWidth
              label={t.customerPhone}
              value={customerPhone}
              onChange={(event) => setCustomerPhone(event.target.value)}
            />
          </Box>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 2fr) minmax(260px, 1fr)' },
              gap: 2,
              mt: 2,
              alignItems: 'start',
            }}
          >
            <TextField
              required
              fullWidth
              label={t.address}
              value={address}
              onChange={(event) => setAddress(event.target.value)}
            />
            <FormControl required fullWidth disabled={!shippingRatesConfigured}>
              <InputLabel id="manual-governorate-label">
                {tr(locale, 'inline.app.governorate')}
              </InputLabel>
              <Select
                labelId="manual-governorate-label"
                label={tr(locale, 'inline.app.governorate')}
                value={governorate}
                onChange={(event) => selectGovernorate(event.target.value)}
              >
                {governorateRates.map(({ code, rate }) => (
                  <MenuItem key={code} value={code} disabled={!rate}>
                    <Stack
                      direction="row"
                      justifyContent="space-between"
                      alignItems="center"
                      gap={2}
                      width="100%"
                    >
                      <span>{egyptianGovernorateName(code, locale)}</span>
                      {rate ? (
                        <MoneyValue value={rate.amountMinor} currency={currency} locale={locale} />
                      ) : (
                        <span>{tr(locale, 'inline.app.shippingUnavailable')}</span>
                      )}
                    </Stack>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>
          {config && !shippingRatesConfigured && (
            <Alert severity="warning" sx={{ mt: 2 }} data-testid="shipping-rates-empty">
              {tr(
                locale,
                'inline.app.noWoocommerceShippingRatesMappedToEgyptianGovernoratesWereFoundR',
              )}
            </Alert>
          )}
        </Section>
        <Section title={t.items}>
          {catalog.length === 0 && config && (
            <Alert severity="warning" sx={{ mb: 2 }} data-testid="manual-catalog-empty">
              {tr(
                locale,
                'inline.app.noPricedProductsAreAvailableRunWoocommerceSyncThenReopenTheManua',
              )}
            </Alert>
          )}
          <Autocomplete
            fullWidth
            options={catalog}
            value={selectedCatalogItem}
            getOptionLabel={(item) => item.name}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            getOptionDisabled={(item) => item.stockStatus === 'outofstock'}
            onChange={(_event, item) => selectCatalogProduct(item?.id ?? '')}
            noOptionsText={tr(locale, 'inline.app.noMatchingProducts')}
            renderOption={(props, item) => (
              <Box component="li" {...props} key={item.id}>
                <Stack width="100%" gap={0.25}>
                  <Typography fontWeight={700}>{item.name}</Typography>
                  <Stack direction="row" justifyContent="space-between" gap={2}>
                    <Typography variant="caption" color="text.secondary">
                      {item.stockStatus || 'unknown'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {item.price} {currency}
                    </Typography>
                  </Stack>
                </Stack>
              </Box>
            )}
            renderInput={(params) => (
              <TextField {...params} required={manualLines.length === 0} label={t.productName} />
            )}
          />
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(140px, 1fr))' },
              gap: 2,
              mt: 2,
            }}
          >
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
              InputProps={{ readOnly: true }}
            />
          </Box>
          <Stack direction="row" justifyContent="flex-end" mt={2}>
            <Button
              type="button"
              variant="outlined"
              disabled={!selectedCatalogId}
              onClick={addCurrentLine}
            >
              {tr(locale, 'inline.app.addAnotherProduct')}
            </Button>
          </Stack>
          {manualLines.length > 0 && (
            <TableContainer component={Paper} variant="outlined" sx={{ mt: 2 }}>
              <Table size="small" aria-label={tr(locale, 'inline.app.orderProducts')}>
                <TableHead>
                  <TableRow>
                    <TableCell>{t.productName}</TableCell>
                    <TableCell>{t.quantity}</TableCell>
                    <TableCell>{t.total}</TableCell>
                    <TableCell />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {manualLines.map((line, index) => (
                    <TableRow key={`${line.catalogId}:${index}`}>
                      <TableCell>{line.name}</TableCell>
                      <TableCell dir="ltr">{line.quantity}</TableCell>
                      <TableCell>
                        <MoneyValue
                          value={(BigInt(line.unitPriceMinor) * BigInt(line.quantity)).toString()}
                          currency={currency}
                          locale={locale}
                        />
                      </TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          color="error"
                          onClick={() =>
                            setManualLines((current) =>
                              current.filter((_item, itemIndex) => itemIndex !== index),
                            )
                          }
                        >
                          {tr(locale, 'inline.app.remove')}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Section>
        <Section title={t.finance}>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: {
                xs: '1fr',
                sm: 'repeat(2, minmax(0, 1fr))',
                lg: 'repeat(5, minmax(140px, 1fr))',
              },
              gap: 2,
            }}
          >
            <TextField label={t.currency} value={currency} InputProps={{ readOnly: true }} />
            <TextField
              label={t.shippingMinor}
              type="number"
              inputProps={{ min: 0, step: 1 }}
              value={shippingMinor}
              InputProps={{ readOnly: true }}
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
          </Box>
          <Paper
            variant="outlined"
            sx={{ mt: 2, p: 2, display: 'flex', justifyContent: 'space-between', gap: 2 }}
          >
            <Typography fontWeight={800}>{t.total}</Typography>
            <MoneyValue
              value={totalMinor}
              currency={currency.toUpperCase()}
              locale={locale}
              fontWeight={800}
            />
          </Paper>
          <Button component="label" variant="outlined" sx={{ mt: 2, minWidth: 220 }}>
            {paymentProof ? paymentProof.name : tr(locale, 'inline.app.uploadTransferProof')}
            <input
              hidden
              type="file"
              accept="image/jpeg,image/png,application/pdf"
              onChange={(event) => setPaymentProof(event.target.files?.[0] ?? null)}
            />
          </Button>
          {paymentProof && (
            <Alert severity="success" sx={{ mt: 1 }} data-testid="payment-proof-selected">
              {tr(locale, 'inline.app.transferProofSelected')}{' '}
              <Box component="span" dir="ltr" sx={{ unicodeBidi: 'isolate' }}>
                {paymentProof.name}
              </Box>
            </Alert>
          )}
          <Typography display="block" variant="caption" color="text.secondary">
            {tr(locale, 'inline.app.jpgPngOrPdfUpTo5Mb')}
          </Typography>
        </Section>
        <Section title={t.workflow}>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: 'minmax(180px, .7fr) 1fr 1.3fr' },
              gap: 2,
              alignItems: 'start',
            }}
          >
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
          </Box>
        </Section>
        <Stack direction="row" gap={2} justifyContent="flex-end">
          <Button type="button" onClick={onCancel} disabled={saving}>
            {t.cancel}
          </Button>
          <Button
            type="submit"
            variant="contained"
            disabled={saving || !shippingRatesConfigured || catalog.length === 0}
          >
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
  const [batches, setBatches] = useState<DocumentBatchSummary[]>([]);
  const [batchDetails, setBatchDetails] = useState<Record<string, DocumentBatchDetails>>({});
  const [expandedBatchId, setExpandedBatchId] = useState('');
  const [batchesLoading, setBatchesLoading] = useState(true);
  const [batchActionId, setBatchActionId] = useState('');
  const [batchError, setBatchError] = useState('');

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

  const loadBatches = async () => {
    const response = await fetch('/api/v1/document-jobs?limit=20', { credentials: 'include' });
    if (!response.ok) throw new Error('DOCUMENT_BATCHES_LOAD_FAILED');
    const result = (await response.json()) as { items?: DocumentBatchSummary[] };
    setBatches(result.items ?? []);
  };

  const loadBatchDetails = async (batchId: string) => {
    setBatchActionId(batchId);
    setBatchError('');
    try {
      const response = await fetch(`/api/v1/document-jobs/${encodeURIComponent(batchId)}`, {
        credentials: 'include',
      });
      if (!response.ok) throw new Error('DOCUMENT_BATCH_DETAILS_LOAD_FAILED');
      const result = (await response.json()) as DocumentBatchDetails & { items?: unknown[] };
      setBatchDetails((current) => ({ ...current, [batchId]: result }));
      setExpandedBatchId(batchId);
    } catch {
      setBatchError('DOCUMENT_BATCH_DETAILS_LOAD_FAILED');
    } finally {
      setBatchActionId('');
    }
  };

  const retryBatch = async (batchId: string) => {
    setBatchActionId(batchId);
    setBatchError('');
    try {
      const response = await fetch(
        `/api/v1/document-jobs/${encodeURIComponent(batchId)}/retry-failures`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken() },
        },
      );
      if (!response.ok) throw new Error('DOCUMENT_BATCH_RETRY_FAILED');
      await loadBatches();
      await loadBatchDetails(batchId);
    } catch {
      setBatchError('DOCUMENT_BATCH_RETRY_FAILED');
    } finally {
      setBatchActionId('');
    }
  };

  useEffect(() => {
    void loadBatches()
      .catch(() => setBatchError('DOCUMENT_BATCHES_LOAD_FAILED'))
      .finally(() => setBatchesLoading(false));
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
                  <MenuItem value="label-100x150mm">80mm shipping roll</MenuItem>
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
      <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 } }} data-testid="document-batches">
        <Stack gap={2}>
          <Typography variant="h5" component="h2" fontWeight={800}>
            {t.documentBatches}
          </Typography>
          {batchError && <Alert severity="error">{t.documentBatchesLoadFailed}</Alert>}
          {batchesLoading ? (
            <CircularProgress aria-label={t.loading} />
          ) : batches.length === 0 ? (
            <Typography color="text.secondary">{t.noDocumentBatches}</Typography>
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t.documentBatchStatus}</TableCell>
                    <TableCell>{t.documentBatchProgress}</TableCell>
                    <TableCell>{t.documentBatchFormat}</TableCell>
                    <TableCell>{t.actions}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {batches.map((batch) => (
                    <TableRow key={batch.id}>
                      <TableCell>
                        <Stack gap={0.5}>
                          <Chip label={batch.status} size="small" />
                          <Typography variant="caption" dir="ltr">
                            {batch.id}
                          </Typography>
                        </Stack>
                      </TableCell>
                      <TableCell dir="ltr">
                        {batch.processedCount}/{batch.totalCount} ({batch.succeededCount}{' '}
                        {batch.failedCount > 0 ? `+ ${batch.failedCount}` : ''})
                      </TableCell>
                      <TableCell dir="ltr">{batch.format}</TableCell>
                      <TableCell>
                        <Stack direction="row" gap={1} flexWrap="wrap">
                          <Button
                            size="small"
                            onClick={() => void loadBatchDetails(batch.id)}
                            disabled={batchActionId === batch.id}
                          >
                            {t.documentBatchDetails}
                          </Button>
                          {(batch.status === 'partial' || batch.status === 'failed') && (
                            <Button
                              size="small"
                              color="warning"
                              onClick={() => void retryBatch(batch.id)}
                              disabled={batchActionId === batch.id}
                            >
                              {t.retryDocumentBatch}
                            </Button>
                          )}
                        </Stack>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
          {expandedBatchId && batchDetails[expandedBatchId] && (
            <Box>
              <Typography variant="subtitle1" fontWeight={700}>
                {t.documentBatchDetails}: {expandedBatchId}
              </Typography>
              <Stack direction="row" gap={1} flexWrap="wrap" sx={{ mt: 1 }}>
                {batchDetails[expandedBatchId].artifacts.map((artifact) => (
                  <Button
                    key={artifact.id}
                    size="small"
                    variant="outlined"
                    component="a"
                    href={`/api/v1/document-artifacts/${encodeURIComponent(artifact.id)}?download=1`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t.documentArtifactDownload}: {artifact.filename}
                  </Button>
                ))}
              </Stack>
            </Box>
          )}
        </Stack>
      </Paper>
    </Stack>
  );
}

type ExportProfileSummary = {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
};
type ExportVersionSummary = {
  id: string;
  profileId: string;
  version: number;
  format: 'csv' | 'xlsx';
  rowMode: 'order' | 'line' | 'package' | 'carrier';
  columns: { key: string; label: string; type?: string }[];
  filenameTemplate: string;
};
type ExportBatchSummary = {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  format: 'csv' | 'xlsx';
  rowMode: string;
  orderCount: number;
  rowCount: number;
  filename: string | null;
  error: string | null;
  jobId: string | null;
  job?: { progress: number; status: string } | null;
};

const exportJobStatusLabel = (status: string, direction: Direction): string => {
  const labels: Record<string, TranslationKey> = {
    queued: 'labels.exportStatus.queued',
    running: 'labels.exportStatus.running',
    completed: 'labels.exportStatus.completed',
    partial: 'labels.exportStatus.partial',
    failed: 'labels.exportStatus.failed',
    cancelled: 'labels.exportStatus.cancelled',
  };
  const key = labels[status];
  return key ? tr(direction === 'rtl' ? 'ar' : 'en', key) : status;
};

const documentFormatLabel = (format: DocumentTemplate['format'], direction: Direction): string => {
  const labels: Record<DocumentTemplate['format'], TranslationKey> = {
    a4: 'labels.documentFormat.a4',
    a5: 'labels.documentFormat.a5',
    'thermal-80mm': 'labels.documentFormat.thermal80mm',
    'label-100x150mm': 'labels.documentFormat.shippingLabel80mm',
  };
  return tr(direction === 'rtl' ? 'ar' : 'en', labels[format]);
};

const documentArtifactLabel = (artifact: DocumentArtifactSummary, direction: Direction): string => {
  const labels: Record<DocumentArtifactSummary['kind'], TranslationKey> = {
    'merged-pdf': 'labels.documentArtifact.mergedPdf',
    zip: 'labels.documentArtifact.zip',
    'order-pdf': 'labels.documentArtifact.orderPdf',
    manifest: 'labels.documentArtifact.manifest',
  };
  return tr(direction === 'rtl' ? 'ar' : 'en', labels[artifact.kind]);
};

const documentBatchErrorLabel = (error: string, direction: Direction): string => {
  if (error === 'DOCUMENT_RENDERER_UNAVAILABLE')
    return tr(direction === 'rtl' ? 'ar' : 'en', 'inline.app.documentRendererUnavailable');
  if (error === 'DOCUMENT_BATCH_ALL_ITEMS_FAILED')
    return tr(direction === 'rtl' ? 'ar' : 'en', 'inline.app.documentBatchAllItemsFailed');
  return error;
};

const exportRowModeLabel = (rowMode: string, direction: Direction): string => {
  const labels: Record<string, TranslationKey> = {
    order: 'labels.exportRowMode.order',
    line: 'labels.exportRowMode.line',
  };
  const key = labels[rowMode];
  return key ? tr(direction === 'rtl' ? 'ar' : 'en', key) : rowMode;
};

function ExportsWorkspace({
  direction,
  t,
  savedViews,
  currentOrderQuery,
  historyOnly = false,
}: {
  direction: Direction;
  t: (typeof copy)[Locale];
  savedViews: SavedOrderView[];
  currentOrderQuery: JsonRecord;
  historyOnly?: boolean;
}) {
  const [batches, setBatches] = useState<ExportBatchSummary[]>([]);
  const [profileId, setProfileId] = useState('');
  const [versionId, setVersionId] = useState('');
  const [selectionSource, setSelectionSource] = useState('current');
  const [documentBatches, setDocumentBatches] = useState<DocumentBatchSummary[]>([]);
  const [documentArtifacts, setDocumentArtifacts] = useState<
    Record<string, DocumentArtifactSummary[]>
  >({});
  const [documentFilesBatchId, setDocumentFilesBatchId] = useState<string | null>(null);
  const [documentFileSearch, setDocumentFileSearch] = useState('');
  const [documentFilePage, setDocumentFilePage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [historyTab, setHistoryTab] = useState<ExportHistoryTab>(exportHistoryTabFromLocation);
  const visibleDocumentArtifacts = documentFilesBatchId
    ? (documentArtifacts[documentFilesBatchId] ?? [])
    : [];
  const individualDocumentArtifacts = visibleDocumentArtifacts.filter(
    (artifact) =>
      artifact.kind === 'order-pdf' &&
      artifact.filename.toLocaleLowerCase().includes(documentFileSearch.trim().toLocaleLowerCase()),
  );
  const documentFilePageSize = 20;
  const documentFilePageCount = Math.max(
    1,
    Math.ceil(individualDocumentArtifacts.length / documentFilePageSize),
  );
  const pagedDocumentArtifacts = individualDocumentArtifacts.slice(
    documentFilePage * documentFilePageSize,
    (documentFilePage + 1) * documentFilePageSize,
  );

  const selectHistoryTab = (value: ExportHistoryTab) => {
    setHistoryTab(value);
    const url = new URL(window.location.href);
    if (value === 'documents') url.searchParams.set('history', 'documents');
    else url.searchParams.delete('history');
    window.history.replaceState(
      window.history.state,
      '',
      `${url.pathname}${url.search}${url.hash}`,
    );
  };

  const loadBatches = async (force = false) => {
    const body = await cachedGetJson<{ items?: ExportBatchSummary[] }>(
      '/api/v1/export-batches',
      10_000,
      force,
    );
    setBatches(body.items ?? []);
  };

  const loadDocumentBatches = async (force = false) => {
    const body = await cachedGetJson<{ items?: DocumentBatchSummary[] }>(
      '/api/v1/document-jobs?limit=30',
      15_000,
      force,
    );
    setDocumentBatches(body.items ?? []);
  };

  const loadProfiles = async () => {
    const body = await cachedGetJson<{ items?: ExportProfileSummary[] }>(
      '/api/v1/export-profiles',
      60_000,
    );
    const items = body.items ?? [];
    let nextProfile =
      items.find((item) => item.name === 'Woo Ops Orders') ??
      items.find((item) => item.active) ??
      items[0];
    if (!nextProfile) {
      const response = await fetch('/api/v1/export-profiles', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken() },
        body: JSON.stringify({
          name: 'Woo Ops Orders',
          description: 'Ready-made operational order spreadsheet',
        }),
      });
      if (!response.ok) throw new Error('EXPORT_PROFILE_CREATE_FAILED');
      nextProfile = ((await response.json()) as { profile: ExportProfileSummary }).profile;
    }
    setProfileId(nextProfile.id);
  };

  const loadVersions = async (nextProfileId: string) => {
    if (!nextProfileId) {
      setVersionId('');
      return;
    }
    const body = await cachedGetJson<{ items?: ExportVersionSummary[] }>(
      `/api/v1/export-profiles/${encodeURIComponent(nextProfileId)}/versions`,
      60_000,
    );
    const items = body.items ?? [];
    let version = items.find((item) => item.format === 'xlsx' && item.rowMode === 'order');
    if (!version) {
      const response = await fetch(
        `/api/v1/export-profiles/${encodeURIComponent(nextProfileId)}/versions`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken() },
          body: JSON.stringify({
            format: 'xlsx',
            rowMode: 'order',
            columns: [
              { key: 'orderNumber', label: t.orderNumber, type: 'text' },
              { key: 'customerName', label: t.customer, type: 'text' },
              { key: 'customerPhone', label: t.phone, type: 'text' },
              { key: 'shipping.address_1', label: t.address, type: 'text' },
              { key: 'shipping.state', label: t.governorateFilter, type: 'text' },
              { key: 'shippingMethodTitle', label: t.shippingMethod, type: 'text' },
              { key: 'paymentMethodTitle', label: t.payment, type: 'text' },
              { key: 'remoteStatus', label: t.remoteStatus, type: 'text' },
              {
                key: 'remoteExportStatus',
                label: tr(direction === 'rtl' ? 'ar' : 'en', 'inline.app.wooExportStatus'),
                type: 'text',
              },
              { key: 'exportState', label: t.exportState, type: 'text' },
              { key: 'grandTotalMinor', label: t.total, type: 'money' },
              { key: 'createdAt', label: t.created, type: 'date' },
            ],
            filenameTemplate: 'woo-orders-{date}-{format}',
            config: { required: ['orderNumber', 'customerName', 'customerPhone'] },
          }),
        },
      );
      if (!response.ok) throw new Error('EXPORT_VERSION_CREATE_FAILED');
      version = ((await response.json()) as { version: ExportVersionSummary }).version;
    }
    setVersionId(version.id);
  };

  useEffect(() => {
    setLoading(true);
    void Promise.all([
      ...(historyOnly ? [] : [loadProfiles()]),
      loadBatches(true),
      loadDocumentBatches(true),
    ])
      .catch(() => setMessage('EXPORT_LOAD_FAILED'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    void loadVersions(profileId).catch(() => setMessage('EXPORT_VERSIONS_LOAD_FAILED'));
  }, [profileId]);

  useEffect(() => {
    if (!batches.some((batch) => batch.status === 'queued' || batch.status === 'running')) return;
    const timer = window.setInterval(() => {
      void loadBatches(true).catch(() => setMessage('EXPORT_BATCHES_LOAD_FAILED'));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [batches]);

  const createSelectionFromSource = async (): Promise<string> => {
    const saved = savedViews.find((item) => item.id === selectionSource.replace(/^saved:/u, ''));
    const query =
      selectionSource === 'all'
        ? { sort: { field: 'remoteCreatedAt', direction: 'desc' } }
        : saved
          ? { ...saved.query, ...(saved.sort ? { sort: saved.sort } : {}) }
          : currentOrderQuery;
    const response = await fetch('/api/v1/selections', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken() },
      body: JSON.stringify({ mode: 'query', query }),
    });
    if (!response.ok) throw new Error('SELECTION_CREATE_FAILED');
    const body = (await response.json()) as { selection: { id: string } };
    return body.selection.id;
  };

  const createBatch = async () => {
    if (!versionId) return;
    setLoading(true);
    try {
      const nextSelectionId = await createSelectionFromSource();
      const response = await fetch('/api/v1/export-batches', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken() },
        body: JSON.stringify({
          selectionId: nextSelectionId,
          profileVersionId: versionId,
          idempotencyKey: `web-export-${Date.now()}`,
        }),
      });
      if (!response.ok) throw new Error('EXPORT_CREATE_FAILED');
      const body = (await response.json()) as { batch: ExportBatchSummary };
      setBatches((current) => [body.batch, ...current.filter((item) => item.id !== body.batch.id)]);
      setMessage('EXPORT_QUEUED');
      await loadBatches(true);
    } catch {
      setMessage('EXPORT_CREATE_FAILED');
    } finally {
      setLoading(false);
    }
  };

  const retryBatch = async (batchId: string) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/v1/export-batches/${encodeURIComponent(batchId)}/retry`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken() },
      });
      if (!response.ok) throw new Error('EXPORT_RETRY_FAILED');
      await loadBatches(true);
      setMessage('EXPORT_RETRY_QUEUED');
    } catch {
      setMessage('EXPORT_RETRY_FAILED');
    } finally {
      setLoading(false);
    }
  };

  const retryDocumentBatch = async (batchId: string) => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/v1/document-jobs/${encodeURIComponent(batchId)}/retry-failures`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken() },
        },
      );
      if (!response.ok) throw new Error('DOCUMENT_RETRY_FAILED');
      await loadDocumentBatches(true);
      setMessage(tr(direction === 'rtl' ? 'ar' : 'en', 'inline.app.failedFilesQueuedAgain'));
    } catch {
      setMessage('DOCUMENT_RETRY_FAILED');
    } finally {
      setLoading(false);
    }
  };

  const statusLabel = (status: ExportBatchSummary['status']): string =>
    exportJobStatusLabel(status, direction);

  return (
    <Stack gap={3} data-testid="exports-workspace" dir={direction}>
      <Box>
        <Typography
          variant={historyOnly ? 'h6' : 'h4'}
          component={historyOnly ? 'h2' : 'h1'}
          fontWeight={800}
        >
          {historyOnly
            ? tr(direction === 'rtl' ? 'ar' : 'en', 'inline.app.exportAndPrintCommands')
            : t.exportsTitle}
        </Typography>
        <Typography color="text.secondary">
          {historyOnly
            ? tr(
                direction === 'rtl' ? 'ar' : 'en',
                'inline.app.trackJobsAndDownloadExcelPdfInvoicesThermalReceiptsOrShippingLab',
              )
            : t.exportsSubtitle}
        </Typography>
      </Box>
      {message && <Alert severity={message.endsWith('FAILED') ? 'error' : 'info'}>{message}</Alert>}
      <Paper variant="outlined" sx={{ px: 2, pt: 1 }}>
        <Tabs
          value={historyTab}
          onChange={(_event, value: ExportHistoryTab) => selectHistoryTab(value)}
          variant="scrollable"
          scrollButtons="auto"
          aria-label={tr(direction === 'rtl' ? 'ar' : 'en', 'inline.app.exportCommandTypes')}
        >
          <Tab value="spreadsheets" label="Excel" />
          <Tab
            value="documents"
            label={tr(direction === 'rtl' ? 'ar' : 'en', 'inline.app.invoicesPrint')}
          />
        </Tabs>
      </Paper>
      {!historyOnly && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack gap={2}>
            <Typography variant="h6" component="h2" fontWeight={800}>
              {t.createExport}
            </Typography>
            <Stack direction={{ xs: 'column', md: 'row' }} gap={2} flexWrap="wrap">
              <FormControl size="small" sx={{ minWidth: 260 }}>
                <InputLabel id="export-source-label">
                  {tr(direction === 'rtl' ? 'ar' : 'en', 'inline.app.ordersToExport')}
                </InputLabel>
                <Select
                  labelId="export-source-label"
                  label={tr(direction === 'rtl' ? 'ar' : 'en', 'inline.app.ordersToExport')}
                  value={selectionSource}
                  onChange={(event) => setSelectionSource(event.target.value)}
                >
                  <MenuItem value="current">
                    {tr(direction === 'rtl' ? 'ar' : 'en', 'inline.app.currentOrdersFilter')}
                  </MenuItem>
                  <MenuItem value="all">
                    {tr(direction === 'rtl' ? 'ar' : 'en', 'inline.app.allOrders')}
                  </MenuItem>
                  {savedViews.map((saved) => (
                    <MenuItem key={saved.id} value={`saved:${saved.id}`}>
                      {tr(direction === 'rtl' ? 'ar' : 'en', 'inline.app.savedFilter')}
                      {saved.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Button
                variant="contained"
                onClick={() => void createBatch()}
                disabled={loading || !versionId}
              >
                {loading ? (
                  <CircularProgress size={18} aria-label={t.loading} />
                ) : (
                  tr(direction === 'rtl' ? 'ar' : 'en', 'inline.app.exportExcel')
                )}
              </Button>
            </Stack>
          </Stack>
        </Paper>
      )}
      <Paper
        variant="outlined"
        sx={{ p: 2, display: historyTab !== 'spreadsheets' ? 'none' : 'block' }}
      >
        <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
          <Typography variant="h6" component="h2" fontWeight={800}>
            {t.exportBatches}
          </Typography>
          <Button size="small" onClick={() => void loadBatches(true)} disabled={loading}>
            {t.refresh}
          </Button>
        </Stack>
        <TableContainer>
          <Table size="small" aria-label={t.exportBatches}>
            <TableHead>
              <TableRow>
                <TableCell>{t.status}</TableCell>
                <TableCell>{t.format}</TableCell>
                <TableCell>{t.total}</TableCell>
                <TableCell>{t.actions}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {batches.map((batch) => (
                <TableRow key={batch.id}>
                  <TableCell>
                    <Stack gap={0.5} alignItems="flex-start">
                      <Chip size="small" label={statusLabel(batch.status)} />
                      {batch.status === 'failed' && batch.error && (
                        <Typography variant="caption" color="error">
                          {batch.error}
                        </Typography>
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Stack gap={0.25}>
                      <Typography fontWeight={700}>{batch.format.toUpperCase()}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {exportRowModeLabel(batch.rowMode, direction)}
                      </Typography>
                    </Stack>
                  </TableCell>
                  <TableCell>
                    {batch.orderCount} / {batch.rowCount}
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" gap={1} alignItems="center">
                      {batch.job && (
                        <LinearProgress
                          variant="determinate"
                          value={Math.min(batch.job.progress, 100)}
                          sx={{ width: 80 }}
                          aria-label={t.loading}
                        />
                      )}
                      {batch.status === 'completed' && (
                        <Button
                          size="small"
                          href={`/api/v1/export-batches/${encodeURIComponent(batch.id)}/download`}
                        >
                          {t.downloadExport}
                        </Button>
                      )}
                      {batch.status === 'failed' && (
                        <Button size="small" onClick={() => void retryBatch(batch.id)}>
                          {t.retryExport}
                        </Button>
                      )}
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        {batches.length === 0 && (
          <Typography color="text.secondary" sx={{ py: 2 }}>
            {t.noData}
          </Typography>
        )}
      </Paper>
      <Paper
        variant="outlined"
        sx={{ p: 2, display: historyTab !== 'documents' ? 'none' : 'block' }}
        data-testid="export-document-jobs"
      >
        <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
          <Box>
            <Typography variant="h6" component="h2" fontWeight={800}>
              {tr(direction === 'rtl' ? 'ar' : 'en', 'inline.app.invoiceAndPrintCommands')}
            </Typography>
            <Typography color="text.secondary" variant="body2">
              {tr(
                direction === 'rtl' ? 'ar' : 'en',
                'inline.app.thermalReceiptsShippingLabelsAndPdfJobsCreatedFromOrders',
              )}
            </Typography>
          </Box>
          <Button size="small" onClick={() => void loadDocumentBatches(true)} disabled={loading}>
            {t.refresh}
          </Button>
        </Stack>
        <TableContainer>
          <Table
            size="small"
            aria-label={tr(direction === 'rtl' ? 'ar' : 'en', 'inline.app.documentJobs')}
          >
            <TableHead>
              <TableRow>
                <TableCell>{t.status}</TableCell>
                <TableCell>{t.format}</TableCell>
                <TableCell>{t.total}</TableCell>
                <TableCell>{t.actions}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {documentBatches.map((batch) => (
                <TableRow key={batch.id}>
                  <TableCell>
                    <Stack gap={0.5} alignItems="flex-start">
                      <Chip
                        size="small"
                        label={exportJobStatusLabel(batch.status, direction)}
                        color={
                          batch.status === 'completed'
                            ? 'success'
                            : batch.status === 'failed'
                              ? 'error'
                              : batch.status === 'partial'
                                ? 'warning'
                                : 'default'
                        }
                      />
                      {batch.status === 'failed' && batch.error && (
                        <Typography variant="caption" color="error">
                          {documentBatchErrorLabel(batch.error, direction)}
                        </Typography>
                      )}
                    </Stack>
                  </TableCell>
                  <TableCell>{documentFormatLabel(batch.format, direction)}</TableCell>
                  <TableCell dir="ltr">
                    {batch.succeededCount}/{batch.totalCount}
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" gap={1} flexWrap="wrap">
                      <Button
                        size="small"
                        onClick={() =>
                          void fetch(`/api/v1/document-jobs/${encodeURIComponent(batch.id)}`, {
                            credentials: 'include',
                          })
                            .then(async (response) => {
                              if (!response.ok) throw new Error('DOCUMENT_JOB_LOAD_FAILED');
                              const body = (await response.json()) as DocumentBatchDetails;
                              setDocumentArtifacts((current) => ({
                                ...current,
                                [batch.id]: body.artifacts ?? [],
                              }));
                              setDocumentFileSearch('');
                              setDocumentFilePage(0);
                              setDocumentFilesBatchId(batch.id);
                            })
                            .catch(() => setMessage('DOCUMENT_JOB_LOAD_FAILED'))
                        }
                      >
                        {tr(direction === 'rtl' ? 'ar' : 'en', 'inline.app.showFiles')}
                      </Button>
                      {(batch.status === 'partial' || batch.status === 'failed') && (
                        <Button
                          size="small"
                          color="warning"
                          onClick={() => void retryDocumentBatch(batch.id)}
                          disabled={loading}
                        >
                          {t.retryDocumentBatch}
                        </Button>
                      )}
                    </Stack>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        {documentBatches.length === 0 && (
          <Typography color="text.secondary" sx={{ py: 2 }}>
            {t.noData}
          </Typography>
        )}
      </Paper>
      <Dialog
        open={documentFilesBatchId !== null}
        onClose={() => setDocumentFilesBatchId(null)}
        fullWidth
        maxWidth="md"
        PaperProps={{
          dir: direction,
          sx: { borderRadius: '12px', maxHeight: '85vh' },
        }}
      >
        <DialogTitle>
          {tr(direction === 'rtl' ? 'ar' : 'en', 'inline.app.documentFiles')}
        </DialogTitle>
        <DialogContent>
          <Stack direction={{ xs: 'column', sm: 'row' }} gap={1} sx={{ mb: 2 }}>
            {visibleDocumentArtifacts
              .filter((artifact) => artifact.kind === 'zip' || artifact.kind === 'merged-pdf')
              .sort((left, right) => (left.kind === 'zip' ? -1 : right.kind === 'zip' ? 1 : 0))
              .map((artifact) => (
                <Button
                  key={artifact.id}
                  variant={artifact.kind === 'zip' ? 'contained' : 'outlined'}
                  component="a"
                  href={`/api/v1/document-artifacts/${encodeURIComponent(artifact.id)}?download=1`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {documentArtifactLabel(artifact, direction)}
                </Button>
              ))}
          </Stack>
          <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 1 }}>
            {tr(direction === 'rtl' ? 'ar' : 'en', 'inline.app.individualFiles', {
              count: individualDocumentArtifacts.length,
            })}
          </Typography>
          <TextField
            fullWidth
            size="small"
            value={documentFileSearch}
            onChange={(event) => {
              setDocumentFileSearch(event.target.value);
              setDocumentFilePage(0);
            }}
            placeholder={tr(direction === 'rtl' ? 'ar' : 'en', 'inline.app.searchDocumentFiles')}
            sx={{ mb: 1.5 }}
          />
          <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: '12px' }}>
            <Table size="small">
              <TableBody>
                {pagedDocumentArtifacts.map((artifact) => (
                  <TableRow key={artifact.id}>
                    <TableCell sx={{ wordBreak: 'break-word' }} dir="ltr">
                      {artifact.filename}
                    </TableCell>
                    <TableCell width={120}>
                      <Button
                        size="small"
                        component="a"
                        href={`/api/v1/document-artifacts/${encodeURIComponent(artifact.id)}?download=1`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {tr(direction === 'rtl' ? 'ar' : 'en', 'inline.app.download')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          {pagedDocumentArtifacts.length === 0 && (
            <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
              {tr(direction === 'rtl' ? 'ar' : 'en', 'inline.app.noMatchingDocumentFiles')}
            </Typography>
          )}
          {documentFilePageCount > 1 && (
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
              sx={{ mt: 2 }}
            >
              <Button
                size="small"
                disabled={documentFilePage === 0}
                onClick={() => setDocumentFilePage((page) => Math.max(0, page - 1))}
              >
                {tr(direction === 'rtl' ? 'ar' : 'en', 'inline.app.previousPage')}
              </Button>
              <Typography variant="body2" dir="ltr">
                {documentFilePage + 1} / {documentFilePageCount}
              </Typography>
              <Button
                size="small"
                disabled={documentFilePage + 1 >= documentFilePageCount}
                onClick={() =>
                  setDocumentFilePage((page) => Math.min(documentFilePageCount - 1, page + 1))
                }
              >
                {tr(direction === 'rtl' ? 'ar' : 'en', 'inline.app.nextPage')}
              </Button>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDocumentFilesBatchId(null)}>{t.close}</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

type AppView =
  'orders' | 'catalog' | 'manual' | 'manual-create' | 'analytics' | 'exports' | AdminSection;
type AuthStatus = 'checking' | 'authenticated' | 'unauthenticated';

const viewFromPath = (path: string): AppView => {
  if (path.startsWith('/connections/woocommerce/callback')) return 'connections';
  const value = path.replace(/^\//u, '').split('/')[0];
  const supported: AppView[] = [
    'orders',
    'catalog',
    'manual',
    'manual-create',
    'analytics',
    'exports',
    'overview',
    'connections',
    'field-mappings',
    'settings',
    'members',
    'operations',
  ];
  return supported.includes(value as AppView) ? (value as AppView) : 'orders';
};

const pathForView = (view: AppView): string => (view === 'orders' ? '/' : `/${view}`);

export function App({
  locale,
  direction,
  onToggleLocale,
  onLocaleChange,
}: {
  locale: Locale;
  direction: Direction;
  onToggleLocale: () => void;
  onLocaleChange: (locale: Locale) => void;
}) {
  const t = copy[locale];
  const [authStatus, setAuthStatus] = useState<AuthStatus>('checking');
  const [authUser, setAuthUser] = useState<AuthenticatedUser | null>(null);
  const [sessionMessage, setSessionMessage] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('processing');
  const [filters, setFilters] = useState<OrderFilters>(emptyOrderFilters);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [savedFiltersOpen, setSavedFiltersOpen] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const [orderFacets, setOrderFacets] = useState<NonNullable<QueryResponse['facets']>>([]);
  const [catalogOptions, setCatalogOptions] = useState<CatalogItemView[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [selected, setSelected] = useState<Order | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [selectAllMatching, setSelectAllMatching] = useState(false);
  const [selectionMessage, setSelectionMessage] = useState('');
  const [outputDialogOpen, setOutputDialogOpen] = useState(false);
  const [selectionError, setSelectionError] = useState(false);
  const [exportHistoryRevision, setExportHistoryRevision] = useState(0);
  const [viewName, setViewName] = useState('');
  const [savedViews, setSavedViews] = useState<SavedOrderView[]>([]);
  const [selectedSavedViewId, setSelectedSavedViewId] = useState('');
  const [activeSavedQuery, setActiveSavedQuery] = useState<JsonRecord | null>(null);
  const [visibleColumns, setVisibleColumns] = useState<string[]>([...defaultOrderColumns]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [view, setViewState] = useState<AppView>(() => viewFromPath(window.location.pathname));
  const [connectionNotice, setConnectionNotice] = useState(() => {
    if (!window.location.pathname.startsWith('/connections/woocommerce/callback')) return '';
    return new URLSearchParams(window.location.search).get('success') === '1'
      ? 'success'
      : 'denied';
  });
  useEffect(() => {
    if (window.location.pathname.startsWith('/connections/woocommerce/callback'))
      window.history.replaceState({}, '', '/connections');
  }, []);

  const setView = (next: AppView) => {
    setViewState(next);
    const nextPath = pathForView(next);
    if (window.location.pathname !== nextPath) window.history.pushState({}, '', nextPath);
  };

  useEffect(() => {
    const onPopState = () => setViewState(viewFromPath(window.location.pathname));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    let active = true;
    void fetch('/api/v1/auth/session', { credentials: 'include' })
      .then(async (response) => {
        if (!active) return;
        if (!response.ok) {
          setAuthStatus('unauthenticated');
          return;
        }
        const body = (await response.json()) as { user: AuthenticatedUser };
        setAuthUser(body.user);
        setAuthStatus('authenticated');
      })
      .catch(() => {
        if (active) setAuthStatus('unauthenticated');
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (authStatus !== 'authenticated') return;
    const timer = window.setInterval(
      () => {
        void fetch('/api/v1/auth/session', { credentials: 'include' })
          .then((response) => {
            if (response.status === 401) expireSession();
          })
          .catch(() => undefined);
      },
      5 * 60 * 1000,
    );
    return () => window.clearInterval(timer);
  }, [authStatus, locale]);

  const expireSession = () => {
    readCache.clear();
    inflightReads.clear();
    setAuthUser(null);
    setAuthStatus('unauthenticated');
    setSessionMessage(sessionExpiredLabel(locale));
  };

  const logout = async () => {
    try {
      await fetch('/api/v1/auth/logout', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken() },
        body: '{}',
      });
    } finally {
      readCache.clear();
      inflightReads.clear();
      setAuthUser(null);
      setAuthStatus('unauthenticated');
    }
  };

  const orderFilter = useMemo(() => {
    const leaves: JsonRecord[] = [];
    if (status) leaves.push({ field: 'remoteStatus', operator: 'equals', value: status });
    if (filters.source) leaves.push({ field: 'source', operator: 'equals', value: filters.source });
    if (filters.exportState)
      leaves.push({ field: 'exportState', operator: 'equals', value: filters.exportState });
    if (filters.paymentMethod)
      leaves.push({ field: 'paymentMethod', operator: 'contains', value: filters.paymentMethod });
    if (filters.shippingMethod)
      leaves.push({ field: 'shippingMethod', operator: 'contains', value: filters.shippingMethod });
    if (filters.governorate)
      leaves.push({ field: 'governorate', operator: 'contains', value: filters.governorate });
    if (filters.posLocation)
      leaves.push({ field: 'posLocation', operator: 'contains', value: filters.posLocation });
    if (filters.product)
      leaves.push({ field: 'product', operator: 'contains', value: filters.product });
    if (filters.category)
      leaves.push({ field: 'category', operator: 'contains-any', value: [filters.category] });
    if (filters.author)
      leaves.push({ field: 'author', operator: 'contains-any', value: [filters.author] });
    if (filters.from || filters.to) {
      const from = filters.from ? `${filters.from}T00:00:00.000Z` : '1970-01-01T00:00:00.000Z';
      const to = filters.to ? `${filters.to}T23:59:59.999Z` : '9999-12-31T23:59:59.999Z';
      leaves.push({ field: 'remoteCreatedAt', operator: 'between', value: [from, to] });
    }
    if (leaves.length === 0) return undefined;
    return leaves.length === 1 ? leaves[0] : { op: 'and', children: leaves };
  }, [filters, status]);
  const currentOrderQuery = useMemo<JsonRecord>(
    () =>
      scopeQueryToWooOrders(
        activeSavedQuery ?? {
          search: search || undefined,
          filter: orderFilter,
          sort: { field: 'remoteCreatedAt', direction: 'desc' },
        },
      ),
    [activeSavedQuery, orderFilter, search],
  );

  const loadOrders = async (append = false, queryOverride?: JsonRecord) => {
    const query = scopeQueryToWooOrders(
      queryOverride ?? activeSavedQuery ?? { search: search || undefined, filter: orderFilter },
    );
    setLoading(true);
    setError(false);
    setAuthRequired(false);
    try {
      const response = await fetch('/api/v1/orders/query', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          search: query.search,
          filter: query.filter,
          includeFacets: true,
          cursor: append ? cursor : null,
          limit: 50,
          sort: { field: 'remoteCreatedAt', direction: 'desc' },
        }),
      });
      if (!response.ok) {
        if (response.status === 401) setAuthRequired(true);
        throw new Error('ORDER_QUERY_FAILED');
      }
      const body = (await response.json()) as QueryResponse;
      setOrders((previous) => (append ? [...previous, ...body.items] : body.items));
      setCursor(body.nextCursor);
      setHasMore(body.hasMore);
      setTotalCount(body.totalCount ?? body.items.length);
      if (!append) {
        setOrderFacets(body.facets ?? []);
        setSelectedIds(new Set());
        setSelectAllMatching(false);
        setSelectionMessage('');
      }
    } catch {
      setError(true);
      if (!append) setOrders([]);
    } finally {
      setLoading(false);
    }
  };

  const loadSavedViews = async () => {
    try {
      const response = await fetch('/api/v1/saved-views', { credentials: 'include' });
      if (!response.ok) return;
      const body = (await response.json()) as { items: SavedOrderView[] };
      setSavedViews(body.items ?? []);
    } catch {
      // Saved views are optional and never prevent the order workspace from loading.
    }
  };

  const facetValues = (field: string): string[] =>
    orderFacets.find((facet) => facet.field === field)?.values.map((item) => item.value) ?? [];

  useEffect(() => {
    if (authStatus !== 'authenticated') return;
    void fetch('/api/v1/catalog?limit=100&kind=product', { credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) return;
        const body = (await response.json()) as { items: CatalogItemView[] };
        setCatalogOptions(body.items ?? []);
      })
      .catch(() => undefined);
  }, [authStatus]);

  const saveCurrentView = async () => {
    if (!viewName.trim()) return;
    try {
      const response = await fetch('/api/v1/saved-views', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken() },
        body: JSON.stringify({
          name: viewName.trim(),
          query: scopeQueryToWooOrders({ search: search || undefined, filter: orderFilter }),
          sort: { field: 'remoteCreatedAt', direction: 'desc' },
          columns: visibleColumns,
          pageSize: 50,
          visibility: 'private',
        }),
      });
      if (!response.ok) throw new Error('SAVED_VIEW_FAILED');
      const body = (await response.json()) as { view: SavedOrderView };
      setSavedViews((current) => [
        body.view,
        ...current.filter((item) => item.id !== body.view.id),
      ]);
      setViewName('');
      setSelectedSavedViewId(body.view.id);
      setActiveSavedQuery(body.view.query);
      setSelectionMessage(body.view.name);
    } catch {
      setSelectionMessage('SAVED_VIEW_FAILED');
    }
  };

  const applySavedView = (viewId: string) => {
    setSelectedSavedViewId(viewId);
    const saved = savedViews.find((item) => item.id === viewId);
    if (!saved) {
      setActiveSavedQuery(null);
      void loadOrders(false, { search: search || undefined, filter: orderFilter });
      return;
    }
    setActiveSavedQuery(saved.query);
    setSearch(typeof saved.query.search === 'string' ? saved.query.search : '');
    setVisibleColumns(saved.columns.length > 0 ? saved.columns : [...columns]);
    void loadOrders(false, saved.query);
  };

  const deleteSavedView = async () => {
    if (!selectedSavedViewId) return;
    try {
      const response = await fetch(
        `/api/v1/saved-views/${encodeURIComponent(selectedSavedViewId)}`,
        {
          method: 'DELETE',
          credentials: 'include',
          headers: { 'x-csrf-token': csrfToken() },
        },
      );
      if (!response.ok) throw new Error('SAVED_VIEW_DELETE_FAILED');
      setSavedViews((current) => current.filter((item) => item.id !== selectedSavedViewId));
      setSelectedSavedViewId('');
      setActiveSavedQuery(null);
      setSelectionMessage(tr(locale, 'inline.app.savedFilterDeleted'));
    } catch {
      setSelectionMessage('SAVED_VIEW_DELETE_FAILED');
    }
  };

  const toggleOrderSelection = (orderId: string) => {
    setSelectAllMatching(false);
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  };

  const toggleVisibleSelection = () => {
    const allVisibleSelected =
      orders.length > 0 && orders.every((order) => selectedIds.has(order.id));
    setSelectAllMatching(false);
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const order of orders) {
        if (allVisibleSelected) next.delete(order.id);
        else next.add(order.id);
      }
      return next;
    });
  };

  const clearOrderSelection = () => {
    setSelectedIds(new Set());
    setSelectAllMatching(false);
    setSelectionMessage('');
  };

  const createSelectionSnapshot = async (): Promise<string | null> => {
    const body = selectAllMatching
      ? {
          mode: 'query',
          query: currentOrderQuery,
        }
      : { mode: 'explicit', orderIds: [...selectedIds] };
    try {
      const response = await fetch('/api/v1/selections', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken() },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error('SELECTION_FAILED');
      const result = (await response.json()) as {
        selection: { id: string; estimatedCount: number };
      };
      setSelectionMessage(String(result.selection.estimatedCount));
      return result.selection.id;
    } catch {
      setSelectionMessage('SELECTION_FAILED');
      return null;
    }
  };

  const ensureOrderExportVersion = async (
    format: 'xlsx',
    preset: 'orders' | 'shipping' = 'orders',
  ): Promise<ExportVersionSummary> => {
    const failed = async (response: Response, fallback: string): Promise<never> => {
      const body = (await response.json().catch(() => null)) as {
        error?: { code?: string };
      } | null;
      throw new Error(body?.error?.code ?? `${fallback} (${response.status})`);
    };
    const profilesResponse = await fetch('/api/v1/export-profiles', { credentials: 'include' });
    if (!profilesResponse.ok) return failed(profilesResponse, 'EXPORT_PROFILES_LOAD_FAILED');
    const profiles =
      ((await profilesResponse.json()) as { items?: ExportProfileSummary[] }).items ?? [];
    const profileName =
      preset === 'shipping'
        ? tr(locale, 'labels.exportProfile.shippingOrders')
        : tr(locale, 'labels.exportProfile.wooOrders', { format: format.toUpperCase() });
    const exportColumns = preset === 'shipping' ? wooShippingExportColumns : wooOrderExportColumns;
    let profile = profiles.find((item) => item.name === profileName);
    if (!profile) {
      const createProfileResponse = await fetch('/api/v1/export-profiles', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken() },
        body: JSON.stringify({
          name: profileName,
          description:
            preset === 'shipping'
              ? 'Ready-to-use shipping order sheet'
              : 'Compact operational order sheet with readable addresses',
        }),
      });
      if (!createProfileResponse.ok)
        return failed(createProfileResponse, 'EXPORT_PROFILE_CREATE_FAILED');
      profile = ((await createProfileResponse.json()) as { profile: ExportProfileSummary }).profile;
    }
    const versionsResponse = await fetch(
      `/api/v1/export-profiles/${encodeURIComponent(profile.id)}/versions`,
      { credentials: 'include' },
    );
    if (!versionsResponse.ok) return failed(versionsResponse, 'EXPORT_VERSIONS_LOAD_FAILED');
    const versions =
      ((await versionsResponse.json()) as { items?: ExportVersionSummary[] }).items ?? [];
    const existing = versions.find(
      (item) =>
        item.format === format &&
        item.rowMode === 'line' &&
        item.columns?.length === exportColumns.length &&
        item.columns.every(
          (column, index) =>
            column.key === exportColumns[index]?.key &&
            column.label === exportColumns[index]?.label,
        ),
    );
    if (existing) return existing;
    const createVersionResponse = await fetch(
      `/api/v1/export-profiles/${encodeURIComponent(profile.id)}/versions`,
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken() },
        body: JSON.stringify({
          format,
          rowMode: 'line',
          columns: exportColumns,
          filenameTemplate:
            preset === 'shipping' ? 'shipping-orders-{date}-{format}' : 'orders-{date}-{format}',
          config: { required: ['woo.orderNumber'] },
        }),
      },
    );
    if (!createVersionResponse.ok)
      return failed(createVersionResponse, 'EXPORT_VERSION_CREATE_FAILED');
    return ((await createVersionResponse.json()) as { version: ExportVersionSummary }).version;
  };

  const downloadCompletedExport = async (batchId: string): Promise<void> => {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const response = await fetch('/api/v1/export-batches', { credentials: 'include' });
      if (response.ok) {
        const items = ((await response.json()) as { items?: ExportBatchSummary[] }).items ?? [];
        const batch = items.find((item) => item.id === batchId);
        if (batch?.status === 'completed') {
          const anchor = document.createElement('a');
          anchor.href = `/api/v1/export-batches/${encodeURIComponent(batchId)}/download`;
          anchor.download = batch.filename ?? '';
          document.body.append(anchor);
          anchor.click();
          anchor.remove();
          return;
        }
        if (batch?.status === 'failed') throw new Error(batch.error ?? 'EXPORT_CREATE_FAILED');
      }
      await new Promise((resolve) => window.setTimeout(resolve, 1_000));
    }
    throw new Error('EXPORT_DOWNLOAD_TIMEOUT');
  };

  const createSelectionExport = async (
    format: 'xlsx',
    preset: 'orders' | 'shipping' = 'orders',
  ) => {
    const selectionId = await createSelectionSnapshot();
    if (!selectionId) return;
    try {
      const version = await ensureOrderExportVersion(format, preset);
      const response = await fetch('/api/v1/export-batches', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken() },
        body: JSON.stringify({
          selectionId,
          profileVersionId: version.id,
          idempotencyKey: `orders-${format}:${selectionId}:${crypto.randomUUID()}`,
        }),
      });
      if (!response.ok) {
        const errorBody = (await response.json().catch(() => null)) as {
          error?: { code?: string };
          code?: string;
        } | null;
        throw new Error(
          errorBody?.error?.code ?? errorBody?.code ?? `EXPORT_HTTP_${response.status}`,
        );
      }
      const created = (await response.json()) as { batch: ExportBatchSummary };
      setSelectionError(false);
      setSelectionMessage(
        tr(locale, 'inline.app.exportCommandAddedAndWillDownloadAutomaticallyItAlsoRemainsInExp'),
      );
      setExportHistoryRevision((value) => value + 1);
      await downloadCompletedExport(created.batch.id);
    } catch (error) {
      setSelectionError(true);
      setSelectionMessage(error instanceof Error ? error.message : 'EXPORT_CREATE_FAILED');
    }
  };

  const unexportSelectedOrder = async () => {
    const orderId = [...selectedIds][0];
    if (!orderId || selectedIds.size !== 1 || selectAllMatching) return;
    const reason = window.prompt(tr(locale, 'inline.app.reasonForReversingExportState'));
    if (!reason?.trim()) return;
    try {
      const response = await fetch(
        `/api/v1/orders/${encodeURIComponent(orderId)}/export-state/unexport`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken() },
          body: JSON.stringify({ reason: reason.trim() }),
        },
      );
      if (!response.ok) throw new Error('EXPORT_UNEXPORT_FAILED');
      clearOrderSelection();
      await loadOrders();
      setSelectionMessage(tr(locale, 'inline.app.localExportStateReversed'));
    } catch {
      setSelectionMessage('EXPORT_UNEXPORT_FAILED');
    }
  };

  const createSelectionDocuments = async (
    action: 'generate-invoice' | 'generate-thermal' | 'generate-label',
    printAfterGeneration = false,
  ) => {
    const printWindow = printAfterGeneration ? window.open('', '_blank') : null;
    if (printAfterGeneration && !printWindow) {
      setSelectionError(true);
      setSelectionMessage(tr(locale, 'inline.app.allowThePrintPopupInYourBrowserThenTryAgain'));
      return;
    }
    if (printWindow) {
      printWindow.opener = null;
      printWindow.document.title = tr(locale, 'inline.app.preparingPrint');
      printWindow.document.body.textContent = tr(locale, 'inline.app.preparingDocument');
    }
    const selectionId = await createSelectionSnapshot();
    if (!selectionId) {
      printWindow?.close();
      return;
    }
    try {
      const templatesResponse = await fetch('/api/v1/document-templates', {
        credentials: 'include',
      });
      if (!templatesResponse.ok) throw new Error('DOCUMENT_TEMPLATES_LOAD_FAILED');
      const templatesBody = (await templatesResponse.json()) as { items: DocumentTemplate[] };
      const format =
        action === 'generate-thermal'
          ? 'thermal-80mm'
          : action === 'generate-label'
            ? 'label-100x150mm'
            : 'a4';
      let template = templatesBody.items.find((item) => item.active && item.format === format);
      template ??= templatesBody.items.find((item) => item.format === format);
      if (!template) {
        const templateResponse = await fetch('/api/v1/document-templates', {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken() },
          body: JSON.stringify({
            name:
              format === 'thermal-80mm'
                ? tr(locale, 'labels.documentFormat.thermal80mm')
                : format === 'label-100x150mm'
                  ? tr(locale, 'labels.documentFormat.shippingLabel80mm')
                  : tr(locale, 'labels.documentFormat.a4'),
            format,
            locale: locale === 'ar' ? 'ar-EG' : 'en-US',
            direction: locale === 'ar' ? 'rtl' : 'ltr',
            companyName: 'Wasat Al Balad',
            body: '{{order.number}}\n{{customer.name}}\n{{customer.phone}}\n{{shipping.address}}\n{{order.totalMinor}}',
            footerText: tr(locale, 'inline.app.thankYouForYourOrder'),
          }),
        });
        if (!templateResponse.ok) throw new Error('DOCUMENT_TEMPLATE_CREATE_FAILED');
        template = ((await templateResponse.json()) as { template: DocumentTemplate }).template;
      }
      const response = await fetch('/api/v1/document-jobs', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken() },
        body: JSON.stringify({
          selectionId,
          action,
          format,
          templateId: template.id,
          idempotencyKey: `orders-${action}:${selectionId}:${crypto.randomUUID()}`,
        }),
      });
      if (!response.ok) {
        const errorBody = (await response.json().catch(() => null)) as {
          error?: { code?: string };
          code?: string;
        } | null;
        throw new Error(
          errorBody?.error?.code ?? errorBody?.code ?? `DOCUMENT_JOB_HTTP_${response.status}`,
        );
      }
      const created = (await response.json()) as { batch: DocumentBatchSummary };
      setExportHistoryRevision((value) => value + 1);
      for (let attempt = 0; attempt < 45; attempt += 1) {
        const detailsResponse = await fetch(
          `/api/v1/document-jobs/${encodeURIComponent(created.batch.id)}`,
          { credentials: 'include' },
        );
        if (detailsResponse.ok) {
          const details = (await detailsResponse.json()) as DocumentBatchDetails;
          if (details.batch.status === 'completed' || details.batch.status === 'partial') {
            const artifact =
              details.artifacts.find((item) => item.kind === 'merged-pdf') ??
              details.artifacts.find((item) => item.kind === 'order-pdf') ??
              details.artifacts.find((item) => item.kind === 'zip');
            if (artifact) {
              const artifactUrl = `/api/v1/document-artifacts/${encodeURIComponent(artifact.id)}`;
              if (printAfterGeneration && printWindow) {
                const fileResponse = await fetch(artifactUrl, { credentials: 'include' });
                if (!fileResponse.ok) throw new Error('DOCUMENT_PRINT_LOAD_FAILED');
                const objectUrl = URL.createObjectURL(await fileResponse.blob());
                printWindow.document.body.replaceChildren();
                printWindow.document.body.style.margin = '0';
                const frame = printWindow.document.createElement('iframe');
                frame.title = artifact.filename;
                frame.style.width = '100vw';
                frame.style.height = '100vh';
                frame.style.border = '0';
                frame.src = objectUrl;
                frame.addEventListener('load', () => {
                  window.setTimeout(() => {
                    frame.contentWindow?.focus();
                    frame.contentWindow?.print();
                    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
                  }, 250);
                });
                printWindow.document.body.append(frame);
              } else {
                const anchor = document.createElement('a');
                anchor.href = `${artifactUrl}?download=1`;
                anchor.download = artifact.filename;
                document.body.append(anchor);
                anchor.click();
                anchor.remove();
              }
            }
            break;
          }
          if (details.batch.status === 'failed')
            throw new Error(details.batch.error ?? 'DOCUMENT_JOB_FAILED');
        }
        await new Promise((resolve) => window.setTimeout(resolve, 1_000));
      }
    } catch (error) {
      printWindow?.close();
      setSelectionError(true);
      setSelectionMessage(error instanceof Error ? error.message : 'DOCUMENT_JOB_FAILED');
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
    if (authStatus !== 'authenticated' || view !== 'orders') return;
    void loadOrders();
  }, [status, authStatus, view]);

  useEffect(() => {
    if (authStatus !== 'authenticated') return;
    void loadSavedViews();
  }, [authStatus]);

  const renderedColumns = useMemo(
    () => columns.filter((column) => visibleColumns.includes(column)),
    [visibleColumns],
  );
  const remoteStatusOptions = useMemo(
    () => [
      ...new Set([
        ...standardWooOrderStatuses,
        ...(orderFacets
          .find((facet) => facet.field === 'remoteStatus')
          ?.values.map((item) => item.value) ?? []),
      ]),
    ],
    [orderFacets],
  );
  const labelFor = (column: string) =>
    ({
      orderNumber: t.orderNumber,
      source: t.source,
      remoteStatus: t.remoteStatus,
      total: t.total,
      exportState: t.exportState,
      remoteExportStatus: tr(locale, 'inline.app.wooExportStatus'),
      customerName: t.customerName,
      customerEmail: t.email,
      customerPhone: t.phone,
      paymentMethod: t.payment,
      shippingMethod: t.shippingMethod,
      posLocation: t.pos,
      quantityTotal: t.quantity,
      createdAt: t.created,
      updatedAt: t.updated,
    })[column] ?? column;
  const display = (order: Order, column: string): string =>
    column === 'source'
      ? order.origin === 'manual'
        ? t.originManual
        : t.originWoo
      : column === 'total'
        ? formatMinor(order.grandTotalMinor, valueText(order.currency, ''), locale)
        : column === 'remoteExportStatus'
          ? order.remoteExportStatus == null
            ? tr(locale, 'inline.app.wooStatusUnavailable')
            : order.remoteExportStatus === 'exported'
              ? tr(locale, 'inline.app.exportedInWoocommerce')
              : order.remoteExportStatus === 'not_exported'
                ? tr(locale, 'inline.app.notExportedInWoocommerce')
                : tr(locale, 'inline.app.wooStatusUnavailable')
          : column === 'customerName'
            ? valueText(order.customerName ?? orderCustomerName(order))
            : column === 'customerEmail'
              ? valueText(order.customerEmail ?? asRecord(order.billing).email)
              : column === 'customerPhone'
                ? valueText(order.customerPhone ?? asRecord(order.billing).phone)
                : column === 'paymentMethod'
                  ? paymentMethodLabel(
                      order.paymentMethodTitle ?? asRecord(order.payment).title,
                      locale,
                    )
                  : column === 'shippingMethod'
                    ? shippingMethodLabel(
                        order.shippingMethodTitle ?? asRecord(order.shippingMethod).title,
                        locale,
                      )
                    : column === 'posLocation'
                      ? valueText(order.posLocation ?? order.pos)
                      : column === 'quantityTotal'
                        ? valueText(order.quantityTotal)
                        : column === 'createdAt'
                          ? dateText(order.createdAt ?? order.remoteCreatedAt, locale)
                          : column === 'updatedAt'
                            ? dateText(order.updatedAt, locale)
                            : column === 'exportState'
                              ? order.exportState === 'never-exported'
                                ? t.never
                                : order.exportState === 'exported'
                                  ? t.exported
                                  : order.exportState === 'changed-after-export'
                                    ? t.changedAfterExport
                                    : valueText(order.exportState)
                              : valueText(order[column]);

  if (authStatus === 'checking')
    return (
      <Box minHeight="100vh" display="grid" sx={{ placeItems: 'center' }}>
        <CircularProgress aria-label={t.loading} />
      </Box>
    );
  if (!authUser || authStatus === 'unauthenticated')
    return (
      <LoginScreen
        locale={locale}
        direction={direction}
        message={sessionMessage}
        onAuthenticated={(user) => {
          setAuthUser(user);
          setAuthStatus('authenticated');
          setSessionMessage('');
        }}
      />
    );

  const navigation: readonly { view: AppView; label: string }[] = [
    { view: 'overview', label: adminLabel('overview', locale) },
    { view: 'orders', label: t.orders },
    {
      view: 'catalog',
      label: tr(locale, 'inline.app.productsStock'),
    },
    {
      view: 'exports',
      label: tr(locale, 'inline.app.exports'),
    },
    { view: 'analytics', label: t.analyticsNav },
    { view: 'connections', label: adminLabel('connections', locale) },
    { view: 'settings', label: adminLabel('settings', locale) },
    { view: 'members', label: adminLabel('members', locale) },
    { view: 'operations', label: adminLabel('operations', locale) },
  ];
  const isAdminView = [
    'overview',
    'connections',
    'field-mappings',
    'settings',
    'members',
    'operations',
  ].includes(view);

  return (
    <>
      <WorkspaceShell
        direction={direction}
        locale={locale}
        userEmail={authUser.email}
        active={view === 'manual' || view === 'manual-create' ? 'orders' : view}
        navigation={navigation.map((item) => ({
          id: item.view,
          label: item.label,
          group: ['overview', 'orders', 'catalog', 'exports', 'analytics'].includes(item.view)
            ? ('workspace' as const)
            : ('management' as const),
        }))}
        onNavigate={(id) => setView(id as AppView)}
        onToggleLocale={onToggleLocale}
        onLogout={() => void logout()}
        onCreateManual={() => setView('manual-create')}
      >
        {connectionNotice && view === 'connections' && (
          <Alert
            severity={connectionNotice === 'success' ? 'success' : 'warning'}
            onClose={() => setConnectionNotice('')}
            sx={{ mb: 2 }}
          >
            {connectionNotice === 'success'
              ? tr(
                  locale,
                  'inline.app.woocommerceApprovedAccessWaitForTheStoreToAppearThenStartTheInit',
                )
              : tr(locale, 'inline.app.woocommerceAuthorizationWasNotApproved')}
          </Alert>
        )}
        {(view === 'orders' || view === 'manual') && (
          <Paper variant="outlined" sx={{ mb: 2, borderRadius: '12px', overflow: 'hidden' }}>
            <Tabs
              value={view === 'manual' ? 'manual' : 'woo'}
              onChange={(_event, value: 'woo' | 'manual') =>
                setView(value === 'manual' ? 'manual' : 'orders')
              }
              aria-label={tr(locale, 'inline.app.orderSourceTabs')}
              variant="fullWidth"
            >
              <Tab
                value="woo"
                label={tr(locale, 'inline.app.woocommerceOrders')}
                data-testid="orders-tab-woo"
              />
              <Tab
                value="manual"
                label={tr(locale, 'inline.app.manualOrders')}
                data-testid="orders-tab-manual"
              />
            </Tabs>
          </Paper>
        )}
        {isAdminView ? (
          <AdminWorkspace
            section={view as AdminSection}
            locale={locale}
            onLocaleChange={onLocaleChange}
            onSessionExpired={expireSession}
          />
        ) : view === 'exports' ? (
          <ExportsWorkspace
            key={exportHistoryRevision}
            direction={direction}
            t={t}
            savedViews={savedViews}
            currentOrderQuery={currentOrderQuery}
          />
        ) : view === 'analytics' ? (
          <AnalyticsWorkspace locale={locale} t={t} />
        ) : view === 'catalog' ? (
          <CatalogWorkspace locale={locale} onSync={() => setView('connections')} />
        ) : view === 'manual' ? (
          <ManualOrdersWorkspace locale={locale} onCreate={() => setView('manual-create')} />
        ) : view === 'manual-create' ? (
          <ManualOrderForm
            locale={locale}
            t={t}
            onCancel={() => setView('manual')}
            onSaved={(order) => {
              setOrders((previous) => [order, ...previous]);
              setView('manual');
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
                <Typography variant="body2" color="text.secondary">
                  {t.totalResults}: {totalCount}
                </Typography>
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
                setSelectedSavedViewId('');
                setActiveSavedQuery(null);
                void loadOrders(false, { search: search || undefined, filter: orderFilter });
              }}
            >
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: {
                    xs: '1fr',
                    md: 'repeat(2, minmax(0, 1fr))',
                    lg: 'minmax(240px, 2fr) repeat(3, minmax(130px, 1fr))',
                  },
                  gap: 1.5,
                  alignItems: 'start',
                  '& .MuiFormControl-root': { minWidth: 0, width: '100%' },
                }}
              >
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
                    onChange={(event) => {
                      setSelectedSavedViewId('');
                      setActiveSavedQuery(null);
                      setStatus(event.target.value);
                    }}
                  >
                    <MenuItem value="">{t.all}</MenuItem>
                    {remoteStatusOptions.map((value) => (
                      <MenuItem key={value} value={value}>
                        {(
                          {
                            pending: t.pending,
                            processing: t.processing,
                            'on-hold': t.onHold,
                            completed: t.completed,
                            cancelled: t.cancelled,
                            refunded: t.refunded,
                            failed: t.failed,
                            'checkout-draft': t.checkoutDraft,
                          } as Record<string, string>
                        )[value] ?? value}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <Autocomplete
                  size="small"
                  options={facetValues('governorate')}
                  value={filters.governorate || null}
                  getOptionLabel={(option) => egyptianGovernorateName(option, locale)}
                  onChange={(_event, value) =>
                    setFilters((current) => ({ ...current, governorate: value ?? '' }))
                  }
                  renderInput={(params) => <TextField {...params} label={t.governorateFilter} />}
                />
                <Autocomplete
                  size="small"
                  options={catalogOptions
                    .filter((item) => item.kind === 'product' || item.kind === 'variation')
                    .map((item) => item.name)
                    .filter((value, index, values) => values.indexOf(value) === index)}
                  value={filters.product || null}
                  onChange={(_event, value) =>
                    setFilters((current) => ({ ...current, product: value ?? '' }))
                  }
                  renderInput={(params) => <TextField {...params} label={t.productFilterOrders} />}
                />
                <FormControl size="small">
                  <InputLabel id="orders-export-quick-label">{t.exportFilter}</InputLabel>
                  <Select
                    value={filters.exportState}
                    labelId="orders-export-quick-label"
                    label={t.exportFilter}
                    onChange={(event) =>
                      setFilters((current) => ({ ...current, exportState: event.target.value }))
                    }
                  >
                    <MenuItem value="">{t.all}</MenuItem>
                    <MenuItem value="never-exported">{t.never}</MenuItem>
                    <MenuItem value="exported">{t.exported}</MenuItem>
                    <MenuItem value="changed-after-export">{t.changedAfterExport}</MenuItem>
                  </Select>
                </FormControl>
                <Button type="submit" variant="contained">
                  {t.searchButton}
                </Button>
              </Box>
              <Stack direction="row" gap={1} mt={2} flexWrap="wrap" alignItems="center">
                <Button
                  type="button"
                  size="small"
                  variant={advancedOpen ? 'contained' : 'text'}
                  onClick={() => setAdvancedOpen((current) => !current)}
                >
                  {advancedOpen ? t.hideFilters : t.advancedFilters}
                </Button>
                <Button
                  type="button"
                  size="small"
                  variant={savedFiltersOpen ? 'contained' : 'outlined'}
                  onClick={() => setSavedFiltersOpen((current) => !current)}
                  aria-expanded={savedFiltersOpen}
                  aria-controls="saved-order-filters"
                >
                  {t.savedViews}
                  {savedViews.length > 0 ? ` (${savedViews.length})` : ''}
                </Button>
              </Stack>
              {savedFiltersOpen && (
                <Paper
                  id="saved-order-filters"
                  data-testid="saved-order-filters"
                  variant="outlined"
                  sx={{ mt: 2, p: 1.5, bgcolor: 'background.default' }}
                >
                  <Stack
                    direction={{ xs: 'column', md: 'row' }}
                    gap={1.5}
                    alignItems={{ md: 'center' }}
                  >
                    <FormControl size="small" sx={{ minWidth: 220, flex: 1 }}>
                      <InputLabel id="orders-saved-view-label">{t.savedViews}</InputLabel>
                      <Select
                        value={selectedSavedViewId}
                        labelId="orders-saved-view-label"
                        label={t.savedViews}
                        onChange={(event) => applySavedView(event.target.value)}
                      >
                        {savedViews.map((saved) => (
                          <MenuItem key={saved.id} value={saved.id}>
                            {saved.name}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    <Button
                      type="button"
                      size="small"
                      color="error"
                      variant="outlined"
                      onClick={() => void deleteSavedView()}
                      disabled={!selectedSavedViewId}
                    >
                      {tr(locale, 'inline.app.deleteFilter')}
                    </Button>
                    <TextField
                      size="small"
                      label={t.viewName}
                      value={viewName}
                      onChange={(event) => setViewName(event.target.value)}
                      sx={{ minWidth: 220, flex: 1 }}
                    />
                    <Button
                      type="button"
                      size="small"
                      variant="contained"
                      onClick={() => void saveCurrentView()}
                      disabled={!viewName.trim()}
                    >
                      {t.saveView}
                    </Button>
                  </Stack>
                </Paper>
              )}
              {advancedOpen && (
                <Box
                  data-testid="advanced-order-filters"
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: {
                      xs: 'minmax(0, 1fr)',
                      sm: 'repeat(2, minmax(0, 1fr))',
                      lg: 'repeat(4, minmax(180px, 1fr))',
                    },
                    gap: 2,
                    mt: 2,
                    alignItems: 'start',
                    '& .MuiFormControl-root': { minWidth: 0, width: '100%' },
                  }}
                >
                  {(
                    [
                      ['paymentMethod', t.paymentFilter],
                      ['shippingMethod', t.shippingFilterOrders],
                    ] as const
                  ).map(([field, label]) => (
                    <Autocomplete
                      key={field}
                      size="small"
                      options={facetValues(field)}
                      value={filters[field] || null}
                      getOptionLabel={(option) => option}
                      onChange={(_event, value) =>
                        setFilters((current) => ({ ...current, [field]: value ?? '' }))
                      }
                      renderInput={(params) => <TextField {...params} label={label} />}
                    />
                  ))}
                  <TextField
                    size="small"
                    type="date"
                    label={t.created}
                    value={filters.from}
                    onChange={(event) =>
                      setFilters((current) => ({ ...current, from: event.target.value }))
                    }
                    InputLabelProps={{ shrink: true }}
                  />
                  <TextField
                    size="small"
                    type="date"
                    label={t.updated}
                    value={filters.to}
                    onChange={(event) =>
                      setFilters((current) => ({ ...current, to: event.target.value }))
                    }
                    InputLabelProps={{ shrink: true }}
                  />
                  <Button type="button" onClick={() => setFilters(emptyOrderFilters())}>
                    {t.clearFilters}
                  </Button>
                </Box>
              )}
            </Paper>
            {(selectedIds.size > 0 || selectAllMatching) && (
              <Paper variant="outlined" sx={{ p: 1.5, mb: 2 }}>
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  gap={1}
                  alignItems={{ sm: 'center' }}
                >
                  <Typography fontWeight={700} sx={{ flexGrow: 1 }}>
                    {selectAllMatching ? totalCount : selectedIds.size} {t.selected}
                  </Typography>
                  {!selectAllMatching && totalCount > orders.length && (
                    <Button size="small" onClick={() => setSelectAllMatching(true)}>
                      {t.selectAllMatching} ({totalCount})
                    </Button>
                  )}
                  <Button
                    size="small"
                    variant="contained"
                    onClick={() => setOutputDialogOpen(true)}
                  >
                    {tr(locale, 'inline.app.exportPrint')}
                  </Button>
                  {!selectAllMatching && selectedIds.size === 1 && (
                    <Button
                      size="small"
                      color="warning"
                      onClick={() => void unexportSelectedOrder()}
                    >
                      {tr(locale, 'inline.app.reverseExportState')}
                    </Button>
                  )}
                  <Button size="small" onClick={clearOrderSelection}>
                    {t.clearSelection}
                  </Button>
                </Stack>
              </Paper>
            )}
            <OrderOutputDialog
              open={outputDialogOpen}
              locale={locale}
              count={selectAllMatching ? totalCount : selectedIds.size}
              onClose={() => setOutputDialogOpen(false)}
              onExcel={(shipping) =>
                void createSelectionExport('xlsx', shipping ? 'shipping' : 'orders')
              }
              onDocument={(action, print) => void createSelectionDocuments(action, print)}
            />
            {selectionMessage && (
              <Alert
                severity={
                  selectionError || selectionMessage.endsWith('_FAILED') ? 'error' : 'success'
                }
                sx={{ mb: 2 }}
              >
                {selectionMessage}
              </Alert>
            )}
            {error && (
              <Alert
                severity="warning"
                sx={{ mb: 2 }}
                action={
                  <Button color="inherit" size="small" onClick={() => void loadOrders()}>
                    {t.retry}
                  </Button>
                }
              >
                {authRequired ? t.authenticationRequired : t.errors}
              </Alert>
            )}
            <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
              <TableContainer
                data-testid="orders-table-scroll"
                tabIndex={0}
                aria-label={`${t.orders} — ${tr(locale, 'inline.app.scrollHorizontallyToViewAllColumns')}`}
                sx={{
                  maxWidth: '100%',
                  overflowX: 'auto',
                  overscrollBehaviorInline: 'contain',
                  WebkitOverflowScrolling: 'touch',
                  '&:focus-visible': {
                    outline: '3px solid',
                    outlineColor: 'primary.main',
                    outlineOffset: -3,
                  },
                }}
              >
                <Table
                  stickyHeader
                  size="small"
                  aria-label={t.orders}
                  data-testid="orders-table"
                  sx={{ minWidth: 1420, '& td, & th': { whiteSpace: 'nowrap' } }}
                >
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
                      <TableCell
                        padding="checkbox"
                        sx={{
                          position: 'sticky',
                          insetInlineStart: 0,
                          zIndex: 4,
                          bgcolor: 'background.paper',
                        }}
                      >
                        <Checkbox
                          inputProps={{ 'aria-label': t.selectAllMatching }}
                          checked={
                            selectAllMatching ||
                            (orders.length > 0 &&
                              orders.every((order) => selectedIds.has(order.id)))
                          }
                          indeterminate={
                            !selectAllMatching &&
                            selectedIds.size > 0 &&
                            selectedIds.size < orders.length
                          }
                          onChange={toggleVisibleSelection}
                        />
                      </TableCell>
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
                        selected={selectedIds.has(order.id)}
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
                        <TableCell
                          padding="checkbox"
                          onClick={(event) => event.stopPropagation()}
                          sx={{
                            position: 'sticky',
                            insetInlineStart: 0,
                            zIndex: 2,
                            bgcolor: 'background.paper',
                          }}
                        >
                          <Checkbox
                            checked={selectedIds.has(order.id) || selectAllMatching}
                            onChange={() => toggleOrderSelection(order.id)}
                            inputProps={{
                              'aria-label': `${t.orderNumber} ${valueText(order.orderNumber)}`,
                            }}
                          />
                        </TableCell>
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
                            ) : column === 'remoteExportStatus' ? (
                              <Chip
                                data-testid={`woo-export-status-${order.id}`}
                                size="small"
                                label={display(order, column)}
                                color={
                                  order.remoteExportStatus === 'exported'
                                    ? 'success'
                                    : order.remoteExportStatus === 'not_exported'
                                      ? 'default'
                                      : 'warning'
                                }
                                variant={
                                  order.remoteExportStatus === 'exported' ? 'filled' : 'outlined'
                                }
                                sx={{
                                  fontWeight: 700,
                                  ...(order.remoteExportStatus !== 'exported' &&
                                  order.remoteExportStatus !== 'not_exported'
                                    ? {
                                        borderColor: '#8a4b00',
                                        '& .MuiChip-label': { color: '#8a4b00' },
                                      }
                                    : {}),
                                }}
                              />
                            ) : column === 'exportState' ? (
                              <Chip
                                size="small"
                                label={display(order, column)}
                                color={
                                  order.exportState === 'exported'
                                    ? 'success'
                                    : order.exportState === 'changed-after-export'
                                      ? 'warning'
                                      : 'default'
                                }
                                variant={
                                  order.exportState === 'never-exported' ? 'outlined' : 'filled'
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
              </TableContainer>
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
      </WorkspaceShell>
      <Drawer
        anchor={direction === 'rtl' ? 'left' : 'right'}
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        aria-labelledby="order-detail-title"
        PaperProps={{ sx: { width: { xs: '100%', sm: 560 }, p: 3 } }}
      >
        {selected && (
          <OrderDetail
            order={selected}
            locale={locale}
            t={t}
            onClose={() => setSelected(null)}
            onUpdated={(updated) => {
              setSelected(updated);
              setOrders((current) =>
                current.map((item) => (item.id === updated.id ? updated : item)),
              );
            }}
          />
        )}
      </Drawer>
    </>
  );
}
