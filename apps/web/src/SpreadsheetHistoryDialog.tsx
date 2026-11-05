import './SpreadsheetHistoryDialog.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material';
import { translate as tr, type AppLocale } from './i18n';
import {
  downloadSpreadsheet,
  downloadWhenSpreadsheetReady,
  type SpreadsheetBatch,
  type SpreadsheetSource,
  spreadsheetApiPath,
} from './exportDownloads';

type Page = { items: SpreadsheetBatch[]; nextCursor?: string | null; hasMore?: boolean };

export function SpreadsheetHistoryDialog({
  open,
  locale,
  canDelete = false,
  onClose,
  onChanged,
  source = 'orders',
}: {
  open: boolean;
  locale: AppLocale;
  canDelete?: boolean;
  onClose: () => void;
  onChanged?: () => void;
  source?: SpreadsheetSource;
}) {
  const [page, setPage] = useState<Page>({ items: [] });
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirm, setConfirm] = useState<SpreadsheetBatch | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const requestId = useRef(0);
  const cursor = cursors.at(-1) ?? null;
  const basePath = spreadsheetApiPath(source);
  const isCustomerReport = source === 'customer-recovery';
  const load = useCallback(
    async (showLoading = true) => {
      const id = ++requestId.current;
      if (showLoading) setLoading(true);
      setError(false);
      try {
        const params = new URLSearchParams({ limit: '20' });
        if (cursor) params.set('cursor', cursor);
        const response = await fetch(`${basePath}?${params}`, {
          credentials: 'include',
        });
        if (!response.ok) throw new Error('HISTORY_LOAD_FAILED');
        const result = (await response.json()) as Page;
        if (id === requestId.current)
          setPage(
            isCustomerReport
              ? {
                  ...result,
                  items: result.items.map((report) => ({
                    ...report,
                    format: 'xlsx',
                    orderCount: report.rowCount,
                  })),
                }
              : result,
          );
      } catch {
        if (id === requestId.current) setError(true);
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [cursor, basePath, isCustomerReport],
  );

  useEffect(() => {
    if (!open) return;
    setConfirm(null);
    void load();
    return () => {
      requestId.current++;
    };
  }, [open, load]);
  useEffect(() => {
    if (!open || !page.items.some((item) => item.status === 'queued' || item.status === 'running'))
      return;
    const timer = window.setTimeout(() => void load(false), 3_000);
    return () => window.clearTimeout(timer);
  }, [open, page, load]);
  useEffect(() => {
    if (!open) {
      setCursors([null]);
      setPage({ items: [] });
    }
  }, [open]);

  const remove = async () => {
    if (!confirm || deleting) return;
    setDeleting(true);
    setError(false);
    try {
      const csrf =
        document.cookie
          .split('; ')
          .find((part) => part.startsWith('woo_ops_csrf='))
          ?.split('=')
          .slice(1)
          .join('=') ?? '';
      const response = await fetch(`${basePath}/${encodeURIComponent(confirm.id)}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'x-csrf-token': decodeURIComponent(csrf) },
      });
      if (!response.ok) throw new Error('HISTORY_DELETE_FAILED');
      setConfirm(null);
      onChanged?.();
      if (cursor) setCursors([null]);
      else await load();
    } catch {
      setError(true);
    } finally {
      setDeleting(false);
    }
  };

  const retry = async (batch: SpreadsheetBatch) => {
    setRetrying(batch.id);
    setError(false);
    try {
      const csrf =
        document.cookie
          .split('; ')
          .find((part) => part.startsWith('woo_ops_csrf='))
          ?.split('=')
          .slice(1)
          .join('=') ?? '';
      const response = await fetch(`/api/v1/export-batches/${encodeURIComponent(batch.id)}/retry`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'x-csrf-token': decodeURIComponent(csrf) },
      });
      if (!response.ok) throw new Error('HISTORY_RETRY_FAILED');
      await load();
      await downloadWhenSpreadsheetReady(batch.id);
      await load();
    } catch {
      setError(true);
    } finally {
      setRetrying(null);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={deleting ? undefined : onClose}
      fullWidth
      aria-labelledby="spreadsheet-history-title"
      className="spreadsheet-history"
      PaperProps={{ dir: locale === 'ar' ? 'rtl' : 'ltr', className: 'spreadsheet-history__paper' }}
    >
      <DialogTitle id="spreadsheet-history-title">
        {tr(
          locale,
          isCustomerReport ? 'spreadsheetHistory.customerTitle' : 'spreadsheetHistory.title',
        )}
      </DialogTitle>
      <DialogContent className="spreadsheet-history__content">
        <Stack className="spreadsheet-history__toolbar">
          <Typography variant="body2" color="text.secondary">
            {tr(
              locale,
              isCustomerReport
                ? 'spreadsheetHistory.customerDescription'
                : 'spreadsheetHistory.description',
            )}
          </Typography>
          <Button onClick={() => void load()} disabled={loading || deleting}>
            {tr(locale, 'spreadsheetHistory.refresh')}
          </Button>
        </Stack>
        {error && <Alert severity="error">{tr(locale, 'spreadsheetHistory.error')}</Alert>}
        {confirm && (
          <Alert severity="warning" className="spreadsheet-history__confirmation">
            <Typography>
              {tr(
                locale,
                isCustomerReport
                  ? 'spreadsheetHistory.customerConfirmDelete'
                  : 'spreadsheetHistory.confirmDelete',
              )}
            </Typography>
            <Typography dir="auto" className="spreadsheet-history__filename">
              {confirm.filename ?? confirm.id}
            </Typography>
            <Stack className="spreadsheet-history__actions">
              <Button
                color="error"
                variant="contained"
                onClick={() => void remove()}
                disabled={deleting}
              >
                {tr(locale, 'spreadsheetHistory.delete')}
              </Button>
              <Button onClick={() => setConfirm(null)} disabled={deleting}>
                {tr(locale, 'spreadsheetHistory.cancel')}
              </Button>
            </Stack>
          </Alert>
        )}
        {loading ? (
          <Box className="spreadsheet-history__empty">
            <CircularProgress aria-label={tr(locale, 'spreadsheetHistory.loading')} />
          </Box>
        ) : (
          <Box className="spreadsheet-history__list">
            {page.items.map((batch) => (
              <Box key={batch.id} className="spreadsheet-history__item">
                <Box className="spreadsheet-history__details">
                  <Typography component="p" dir="auto" className="spreadsheet-history__filename">
                    {batch.filename ?? tr(locale, 'spreadsheetHistory.pendingFile')}
                  </Typography>
                  <Stack className="spreadsheet-history__metadata">
                    <Chip
                      size="small"
                      color={
                        batch.status === 'completed'
                          ? 'success'
                          : batch.status === 'failed'
                            ? 'error'
                            : 'default'
                      }
                      label={tr(locale, `labels.exportStatus.${batch.status}`)}
                    />
                    <Typography variant="caption">
                      {tr(
                        locale,
                        isCustomerReport
                          ? 'spreadsheetHistory.customerCounts'
                          : 'spreadsheetHistory.counts',
                        {
                          orders: batch.orderCount,
                          rows: batch.rowCount,
                        },
                      )}
                    </Typography>
                    {batch.createdAt && (
                      <Typography
                        component="time"
                        variant="caption"
                        dir="ltr"
                        dateTime={batch.createdAt}
                      >
                        {new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB', {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        }).format(new Date(batch.createdAt))}
                      </Typography>
                    )}
                  </Stack>
                  {batch.status === 'failed' && batch.error && (
                    <Typography
                      variant="caption"
                      color="error"
                      className="spreadsheet-history__error"
                    >
                      {batch.error}
                    </Typography>
                  )}
                </Box>
                <Stack className="spreadsheet-history__actions">
                  {batch.status === 'completed' && (
                    <Button variant="outlined" onClick={() => downloadSpreadsheet(batch, source)}>
                      {tr(locale, 'spreadsheetHistory.download')}
                    </Button>
                  )}
                  {canDelete && !isCustomerReport && batch.status === 'failed' && (
                    <Button onClick={() => void retry(batch)} disabled={retrying !== null}>
                      {tr(locale, 'app.retryExport')}
                    </Button>
                  )}
                  {canDelete && (batch.status === 'completed' || batch.status === 'failed') && (
                    <Button
                      color="error"
                      onClick={() => setConfirm(batch)}
                      disabled={deleting || retrying === batch.id}
                      aria-label={tr(locale, 'spreadsheetHistory.deleteFile', {
                        name: batch.filename ?? batch.id,
                      })}
                    >
                      {tr(locale, 'spreadsheetHistory.delete')}
                    </Button>
                  )}
                </Stack>
              </Box>
            ))}
            {page.items.length === 0 && (
              <Typography className="spreadsheet-history__empty">
                {tr(locale, 'spreadsheetHistory.empty')}
              </Typography>
            )}
          </Box>
        )}
        <Stack className="spreadsheet-history__pagination">
          <Button
            disabled={loading || deleting || cursors.length === 1}
            onClick={() => setCursors((values) => values.slice(0, -1))}
          >
            {tr(locale, 'spreadsheetHistory.previous')}
          </Button>
          <Typography variant="body2">
            {tr(locale, 'spreadsheetHistory.page', { page: cursors.length })}
          </Typography>
          <Button
            disabled={loading || deleting || !page.hasMore || !page.nextCursor}
            onClick={() => setCursors((values) => [...values, page.nextCursor ?? null])}
          >
            {tr(locale, 'spreadsheetHistory.next')}
          </Button>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={deleting}>
          {tr(locale, 'spreadsheetHistory.close')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
