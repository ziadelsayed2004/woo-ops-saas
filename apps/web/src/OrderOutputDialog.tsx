import { useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import { getOutputDialogCopy, translate as tr } from './i18n';

type DocumentAction = 'generate-invoice' | 'generate-thermal' | 'generate-label';
type Props = {
  open: boolean;
  locale: 'ar' | 'en';
  count: number;
  onClose: () => void;
  onExcel: (shipping: boolean) => void;
  onDocument: (action: DocumentAction, print: boolean) => void;
};

export function OrderOutputDialog({ open, locale, count, onClose, onExcel, onDocument }: Props) {
  const [mode, setMode] = useState<'download' | 'print'>('download');
  const copy = getOutputDialogCopy(locale);
  const documents: Array<{ action: DocumentAction; title: string; description: string }> = [
    {
      action: 'generate-invoice',
      title: copy.a4Invoice,
      description: copy.a4Description,
    },
    {
      action: 'generate-thermal',
      title: copy.thermalReceipt,
      description: copy.thermalDescription,
    },
    {
      action: 'generate-label',
      title: copy.shippingLabel,
      description: copy.shippingDescription,
    },
  ];
  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      aria-labelledby="order-output-title"
      PaperProps={{ dir: locale === 'ar' ? 'rtl' : 'ltr', sx: { borderRadius: '12px' } }}
    >
      <DialogTitle id="order-output-title" sx={{ pb: 1 }}>
        {copy.title}
      </DialogTitle>
      <DialogContent>
        <Typography color="text.secondary" variant="body2" sx={{ mb: 2 }}>
          {tr(locale, 'outputDialog.selectedOrders', { count })}
        </Typography>
        <Tabs
          value={mode}
          onChange={(_event, value: 'download' | 'print') => setMode(value)}
          variant="fullWidth"
          aria-label={copy.title}
          sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
        >
          <Tab
            id="output-download-tab"
            aria-controls="output-panel"
            value="download"
            label={copy.downloadFiles}
          />
          <Tab
            id="output-print-tab"
            aria-controls="output-panel"
            value="print"
            label={copy.print}
          />
        </Tabs>
        <Stack id="output-panel" role="tabpanel" aria-labelledby={`output-${mode}-tab`} gap={1.5}>
          {mode === 'download' && (
            <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, bgcolor: 'grey.50' }}>
              <Typography fontWeight={700} sx={{ mb: 1 }}>
                {copy.excelTables}
              </Typography>
              <Stack direction="row" gap={1} flexWrap="wrap">
                <Button
                  variant="outlined"
                  onClick={() => {
                    onClose();
                    onExcel(false);
                  }}
                >
                  {copy.exportExcel}
                </Button>
                <Button
                  variant="outlined"
                  onClick={() => {
                    onClose();
                    onExcel(true);
                  }}
                >
                  {copy.shippingSheet}
                </Button>
              </Stack>
            </Paper>
          )}
          {documents.map((item) => (
            <Paper key={item.action} variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
              <Stack direction="row" alignItems="center" justifyContent="space-between" gap={2}>
                <Box>
                  <Typography fontWeight={700}>{item.title}</Typography>
                  <Typography color="text.secondary" variant="body2">
                    {item.description}
                  </Typography>
                </Box>
                <Button
                  variant={mode === 'print' ? 'contained' : 'outlined'}
                  sx={{ flexShrink: 0, minWidth: 95 }}
                  aria-label={
                    item.action === 'generate-invoice'
                      ? mode === 'print'
                        ? copy.printA4
                        : copy.downloadA4
                      : item.action === 'generate-thermal'
                        ? mode === 'print'
                          ? copy.printThermal
                          : copy.downloadThermal
                        : mode === 'print'
                          ? copy.printShipping
                          : copy.downloadShipping
                  }
                  onClick={() => {
                    onClose();
                    onDocument(item.action, mode === 'print');
                  }}
                >
                  {mode === 'print' ? copy.print : copy.pdf}
                </Button>
              </Stack>
            </Paper>
          ))}
          <Typography variant="caption" color="text.secondary">
            {mode === 'print' ? copy.printHint : copy.downloadHint}
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{copy.close}</Button>
      </DialogActions>
    </Dialog>
  );
}
