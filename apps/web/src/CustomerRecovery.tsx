import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  LinearProgress,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { translate as tr } from './i18n';
import './CustomerRecovery.css';

type Item = {
  orderId: string;
  email: string;
  name: string;
  phone: string;
  governorate: string;
  orderNumber: string;
  orderDate: string;
  status: string;
  totalMinor: string;
  currency: string;
  products: string;
  failedCount: number;
};
type Report = {
  id: string;
  status: string;
  rowCount: number;
  createdAt: string;
  filename: string | null;
};
type Product = { externalId: string; name: string; sku: string | null };
export function CustomerRecovery({
  locale,
  canExport,
  onSessionExpired,
  onOpenOrder,
}: {
  locale: 'ar' | 'en';
  canExport: boolean;
  onSessionExpired: () => void;
  onOpenOrder: (id: string) => Promise<void>;
}) {
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [product, setProduct] = useState<Product | null>(null);
  const [options, setOptions] = useState<Product[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [freshness, setFreshness] = useState<{
    stale: boolean;
    lastSuccessAt: string | null;
  } | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [failed, setFailed] = useState(false);
  const sequence = useRef(0);
  const mounted = useRef(true);
  const t = (key: keyof (typeof import('./locales/en.json'))['recovery']) =>
    tr(locale, `recovery.${key}`);
  const filters = () => ({
    ...(search.trim() ? { search: search.trim() } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(product ? { productId: product.externalId } : {}),
  });
  const request = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(path, { credentials: 'include', ...init });
    if (response.status === 401) onSessionExpired();
    if (!response.ok) throw new Error('CUSTOMER_REPORT_REQUEST_FAILED');
    return response.json() as Promise<T>;
  };
  const load = async (next?: string) => {
    const current = ++sequence.current;
    setLoading(true);
    setFailed(false);
    try {
      const query = new URLSearchParams({
        ...filters(),
        limit: '50',
        ...(next ? { cursor: next } : {}),
      });
      const result = await request<{
        items: Item[];
        nextCursor: string | null;
        freshness: { stale: boolean; lastSuccessAt: string | null };
      }>(`/api/v1/customer-recovery?${query}`);
      if (!mounted.current || current !== sequence.current) return;
      setItems((old) => (next ? [...old, ...result.items] : result.items));
      setCursor(result.nextCursor);
      setFreshness(result.freshness);
    } catch {
      if (mounted.current && current === sequence.current) setFailed(true);
    } finally {
      if (mounted.current && current === sequence.current) setLoading(false);
    }
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      sequence.current += 1;
    };
  }, []);
  useEffect(() => {
    sequence.current += 1;
    setItems([]);
    setCursor(null);
    const timer = window.setTimeout(() => void load(), 350);
    return () => window.clearTimeout(timer);
  }, [search, from, to, product?.externalId]);
  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      void request<{ items: Product[] }>(
        `/api/v1/catalog?${new URLSearchParams({ kind: 'product', limit: '30', search: productSearch })}`,
      )
        .then((r) => {
          if (active) setOptions(r.items);
        })
        .catch(() => {
          if (active) setOptions([]);
        });
    }, 300);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [productSearch]);
  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const result = await request<{ items: Report[] }>('/api/v1/customer-recovery/reports');
        if (!active) return;
        setReports(result.items);
        if (result.items.some((r) => ['queued', 'running'].includes(r.status)))
          timer = window.setTimeout(() => void poll(), 3000);
      } catch {
        if (active) setFailed(true);
      }
    };
    void poll();
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [exporting]);
  const exportReport = async () => {
    setExporting(true);
    setFailed(false);
    try {
      const csrf = document.cookie.match(/(?:^|;\s*)woo_ops_csrf=([^;]+)/u)?.[1] ?? '';
      await request('/api/v1/customer-recovery/reports', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
        body: JSON.stringify({ filter: filters(), locale, idempotencyKey: crypto.randomUUID() }),
      });
    } catch {
      setFailed(true);
    } finally {
      setExporting(false);
    }
  };
  const amount = (minor: string) => {
    const value = BigInt(minor);
    const absolute = value < 0n ? -value : value;
    return `${value < 0n ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
  };
  return (
    <Stack className="customer-recovery" data-testid="customer-recovery">
      <Alert severity="info">{t('definition')}</Alert>
      <Box className="customer-recovery__filters">
        <TextField label={t('search')} value={search} onChange={(e) => setSearch(e.target.value)} />
        <Autocomplete<Product>
          options={options}
          value={product}
          filterOptions={(v) => v}
          getOptionLabel={(p) => p.name}
          isOptionEqualToValue={(a, b) => a.externalId === b.externalId}
          onChange={(_e, v) => setProduct(v)}
          onInputChange={(_e, v, reason) => {
            if (reason === 'input' || reason === 'clear') setProductSearch(v);
          }}
          renderInput={(params) => <TextField {...params} label={t('product')} />}
        />
        <TextField
          label={t('from')}
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          InputLabelProps={{ shrink: true }}
        />
        <TextField
          label={t('to')}
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          InputLabelProps={{ shrink: true }}
        />
      </Box>
      {freshness && (
        <Alert severity={freshness.stale ? 'warning' : 'info'}>
          {freshness.stale ? t('stale') : t('localData')} {t('lastSync')}{' '}
          <bdi>
            {freshness.lastSuccessAt
              ? new Date(freshness.lastSuccessAt).toLocaleString('en-GB', { timeZone: 'UTC' })
              : t('unknown')}
          </bdi>{' '}
          UTC
        </Alert>
      )}
      <Box className="customer-recovery__actions">
        <Button variant="outlined" onClick={() => void load()} disabled={loading}>
          {t('refresh')}
        </Button>
        {canExport && (
          <Button
            variant="contained"
            onClick={() => void exportReport()}
            disabled={exporting || loading || items.length === 0}
          >
            {exporting ? t('preparing') : t('export')}
          </Button>
        )}
      </Box>
      {failed && <Alert severity="error">{t('error')}</Alert>}
      {loading && <LinearProgress aria-label={t('loading')} />}
      <TableContainer component={Paper} variant="outlined">
        <Table size="small" aria-label={t('title')}>
          <TableHead>
            <TableRow>
              {(
                [
                  'name',
                  'contact',
                  'governorate',
                  'order',
                  'status',
                  'date',
                  'amount',
                  'attempts',
                ] as const
              ).map((k) => (
                <TableCell key={k}>{t(k)}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.orderId}>
                <TableCell>{item.name || '—'}</TableCell>
                <TableCell>
                  <Stack>
                    <bdi>{item.email}</bdi>
                    <bdi>{item.phone}</bdi>
                  </Stack>
                </TableCell>
                <TableCell>{item.governorate || '—'}</TableCell>
                <TableCell>
                  <Button
                    onClick={() => {
                      void onOpenOrder(item.orderId).catch(() => setFailed(true));
                    }}
                  >
                    {item.orderNumber}
                  </Button>
                </TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    variant="outlined"
                    color="warning"
                    label={item.status === 'failed' ? t('failed') : t('cancelled')}
                  />
                </TableCell>
                <TableCell>
                  <bdi>{item.orderDate.slice(0, 10)}</bdi>
                </TableCell>
                <TableCell>
                  <bdi>
                    {amount(item.totalMinor)} {item.currency}
                  </bdi>
                </TableCell>
                <TableCell>
                  <bdi>{item.failedCount}</bdi>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      {!loading && !failed && items.length === 0 && <Typography>{t('empty')}</Typography>}
      {cursor && (
        <Button disabled={loading} onClick={() => void load(cursor)}>
          {t('more')}
        </Button>
      )}
      <Typography variant="body2" color="text.secondary">
        {t('exportNote')}
      </Typography>
      {reports.length > 0 && (
        <Paper variant="outlined" className="customer-recovery__history">
          <Typography component="h2" variant="h6">
            {t('history')}
          </Typography>
          {reports.map((report) => (
            <Box key={report.id} className="customer-recovery__report">
              <Typography>
                <bdi>{new Date(report.createdAt).toLocaleString('en-GB')}</bdi> ·{' '}
                <bdi>{report.rowCount}</bdi> {t('customers')}
              </Typography>
              {report.status === 'completed' ? (
                <Button href={`/api/v1/customer-recovery/reports/${report.id}/download`}>
                  {t('download')}
                </Button>
              ) : (
                <Typography color={report.status === 'failed' ? 'error' : 'text.secondary'}>
                  {report.status === 'failed' ? t('exportError') : t('preparing')}
                </Typography>
              )}
            </Box>
          ))}
        </Paper>
      )}
    </Stack>
  );
}
