import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  AppBar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  Drawer,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Toolbar,
  Tooltip,
  Typography,
} from '@mui/material';

type Locale = 'ar' | 'en';
type Direction = 'rtl' | 'ltr';
type Order = Record<string, unknown> & {
  id: string;
  orderNumber?: string;
  origin?: string;
  remoteStatus?: string;
  localStatus?: string;
  exportState?: string;
  currency?: string;
  grandTotalMinor?: string;
  billing?: Record<string, unknown>;
  lines?: readonly Record<string, unknown>[];
};
type QueryResponse = { items: Order[]; nextCursor: string | null; hasMore: boolean };
const copy = {
  ar: {
    app: 'Woo Ops',
    orders: 'إدارة الطلبات',
    subtitle: 'بحث وتشغيل الطلبات من كل المصادر في مكان واحد',
    search: 'بحث في رقم الطلب، العميل، SKU أو الهاتف',
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
    customer: 'العميل والعناوين',
    items: 'المنتجات',
    noOrders: 'لا توجد طلبات مطابقة',
    noConnection: 'لم يتم الاتصال بالخادم بعد',
    loading: 'جارٍ التحميل',
    loadMore: 'تحميل المزيد',
    language: 'English',
    direction: 'LTR',
    orderNumber: 'رقم الطلب',
    source: 'المصدر',
    remoteStatus: 'حالة المنصة',
    localStatus: 'الحالة المحلية',
    total: 'الإجمالي',
    exportState: 'حالة التصدير',
    originWoo: 'WooCommerce',
    originManual: 'يدوي',
    never: 'لم يُصدّر',
    remoteOnly: 'لا يمكن تعديل بيانات المنصة من هنا',
    errors: 'تعذر تحميل الطلبات، يمكنك المحاولة مرة أخرى',
  },
  en: {
    app: 'Woo Ops',
    orders: 'Orders workspace',
    subtitle: 'Search and operate orders from every source in one place',
    search: 'Search order number, customer, SKU or phone',
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
    customer: 'Customer & addresses',
    items: 'Items',
    noOrders: 'No matching orders',
    noConnection: 'The server is not connected yet',
    loading: 'Loading',
    loadMore: 'Load more',
    language: 'العربية',
    direction: 'RTL',
    orderNumber: 'Order number',
    source: 'Source',
    remoteStatus: 'Remote status',
    localStatus: 'Local status',
    total: 'Total',
    exportState: 'Export state',
    originWoo: 'WooCommerce',
    originManual: 'Manual',
    never: 'Not exported',
    remoteOnly: 'Platform facts cannot be edited here',
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
const money = (order: Order): string =>
  `${(Number(order.grandTotalMinor ?? 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })} ${order.currency ?? ''}`;

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
        ? money(order)
        : column === 'exportState'
          ? order.exportState === 'never-exported'
            ? t.never
            : String(order.exportState ?? '')
          : String(order[column] ?? '—');
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
            aria-label={`Switch to ${t.direction}`}
          >
            {direction.toUpperCase()}
          </Button>
          <Button onClick={onToggleLocale} color="primary" size="small">
            {t.language}
          </Button>
        </Toolbar>
      </AppBar>
      <Container maxWidth="xl" sx={{ py: 4 }}>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          alignItems={{ md: 'center' }}
          justifyContent="space-between"
          gap={2}
          mb={3}
        >
          <Box>
            <Typography variant="h4" fontWeight={800}>
              {t.orders}
            </Typography>
            <Typography color="text.secondary">{t.subtitle}</Typography>
          </Box>
          <Stack direction="row" gap={1}>
            <Button variant="outlined" onClick={() => void loadOrders()} disabled={loading}>
              {loading ? <CircularProgress size={18} /> : t.refresh}
            </Button>
            <FormControl size="small" sx={{ minWidth: 150 }}>
              <InputLabel>{t.columns}</InputLabel>
              <Select
                multiple
                value={visibleColumns}
                label={t.columns}
                onChange={(event) => setVisibleColumns(event.target.value as string[])}
                renderValue={(value) => `${(value as string[]).length}/${columns.length}`}
              >
                <MenuItem value="orderNumber">{t.orderNumber}</MenuItem>
                <MenuItem value="source">{t.source}</MenuItem>
                <MenuItem value="remoteStatus">{t.remoteStatus}</MenuItem>
                <MenuItem value="localStatus">{t.localStatus}</MenuItem>
                <MenuItem value="total">{t.total}</MenuItem>
                <MenuItem value="exportState">{t.exportState}</MenuItem>
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
              <InputLabel>{t.status}</InputLabel>
              <Select
                value={status}
                label={t.status}
                onChange={(event) => setStatus(event.target.value)}
              >
                <MenuItem value="">{t.all}</MenuItem>
                <MenuItem value="processing">{t.processing}</MenuItem>
                <MenuItem value="completed">{t.completed}</MenuItem>
              </Select>
            </FormControl>
            <Button type="submit" variant="contained">
              {locale === 'ar' ? 'بحث' : 'Search'}
            </Button>
          </Stack>
        </Paper>
        {error && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            {t.errors}
          </Alert>
        )}
        <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
          <Table size="small" aria-label={t.orders}>
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
                  onClick={() => setSelected(order)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') setSelected(order);
                  }}
                  sx={{ cursor: 'pointer' }}
                >
                  {renderedColumns.map((column) => (
                    <TableCell key={column}>
                      {column === 'remoteStatus' ? (
                        <Chip
                          size="small"
                          label={display(order, column)}
                          color={order.remoteStatus === 'completed' ? 'success' : 'warning'}
                        />
                      ) : (
                        display(order, column)
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
        PaperProps={{ sx: { width: { xs: '100%', sm: 480 }, p: 3 } }}
      >
        {selected && (
          <Stack gap={2} role="dialog" aria-label={t.details}>
            <Stack direction="row" alignItems="center">
              <Typography variant="h5" fontWeight={800} sx={{ flexGrow: 1 }}>
                {t.details} #{selected.orderNumber}
              </Typography>
              <Tooltip title={t.close}>
                <IconButton onClick={() => setSelected(null)} aria-label={t.close}>
                  ×
                </IconButton>
              </Tooltip>
            </Stack>
            <Chip
              label={selected.origin === 'manual' ? t.originManual : t.originWoo}
              sx={{ alignSelf: 'flex-start' }}
            />
            <Typography variant="subtitle1" fontWeight={800}>
              {t.remote}
            </Typography>
            <Fact label={t.remoteStatus} value={String(selected.remoteStatus ?? '—')} />
            <Fact label={t.total} value={money(selected)} />
            <Fact
              label={t.customer}
              value={
                `${String(selected.billing?.first_name ?? '')} ${String(selected.billing?.last_name ?? '')}`.trim() ||
                '—'
              }
            />
            <Typography variant="subtitle1" fontWeight={800}>
              {t.localFacts}
            </Typography>
            <Fact label={t.localStatus} value={String(selected.localStatus ?? '—')} />
            <Fact label={t.exportState} value={String(selected.exportState ?? '—')} />
            <Alert severity="info">{t.remoteOnly}</Alert>
            <Typography variant="subtitle1" fontWeight={800}>
              {t.items}
            </Typography>
            {(selected.lines ?? []).map((line, index) => (
              <Box key={index} sx={{ bgcolor: '#f8fafc', p: 1, borderRadius: 1 }}>
                <Typography>{String(line.name ?? '—')}</Typography>
                <Typography variant="caption" color="text.secondary">
                  × {String(line.quantity ?? '—')} · {String(line.totalMinor ?? '—')}
                </Typography>
              </Box>
            ))}
          </Stack>
        )}
      </Drawer>
    </Box>
  );
}
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <Stack direction="row" justifyContent="space-between" gap={2}>
      <Typography color="text.secondary">{label}</Typography>
      <Typography fontWeight={700} textAlign="end">
        {value}
      </Typography>
    </Stack>
  );
}
