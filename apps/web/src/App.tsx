import { type ReactNode, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  AppBar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  Divider,
  Drawer,
  FormControl,
  IconButton,
  InputLabel,
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
              <Typography color="text.secondary">{error ? t.noConnection : t.noOrders}</Typography>
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
