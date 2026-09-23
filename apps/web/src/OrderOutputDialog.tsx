import './OrderOutputDialog.css';
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
      aria-labelledby="order-output-title"
      PaperProps={{ dir: locale === 'ar' ? 'rtl' : 'ltr', sx: { borderRadius: '12px' } }}
      className="order-output-dialog-l48c5"
    >
      <DialogTitle id="order-output-title" className="order-output-dialog-l56c7">
        {copy.title}
      </DialogTitle>
      <DialogContent>
        <Typography variant="body2" className="order-output-dialog-l60c9">
          {tr(locale, 'outputDialog.selectedOrders', { count })}
        </Typography>
        <Tabs
          value={mode}
          onChange={(_event, value: 'download' | 'print') => setMode(value)}
          variant="fullWidth"
          aria-label={copy.title}
          className="order-output-dialog-l63c9"
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
        <Stack
          id="output-panel"
          role="tabpanel"
          aria-labelledby={`output-${mode}-tab`}
          className="order-output-dialog-l83c9"
        >
          {mode === 'download' && (
            <Paper variant="outlined" className="order-output-dialog-l85c13">
              <Typography className="order-output-dialog-l86c15">{copy.excelTables}</Typography>
              <Stack className="order-output-dialog-l89c15">
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
            <Paper key={item.action} variant="outlined" className="order-output-dialog-l112c13">
              <Stack className="order-output-dialog-l113c15">
                <Box>
                  <Typography className="order-output-dialog-l115c19">{item.title}</Typography>
                  <Typography variant="body2" className="order-output-dialog-l116c19">
                    {item.description}
                  </Typography>
                </Box>
                <Button
                  variant={mode === 'print' ? 'contained' : 'outlined'}
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
                  className="order-output-dialog-l120c17"
                >
                  {mode === 'print' ? copy.print : copy.pdf}
                </Button>
              </Stack>
            </Paper>
          ))}
          <Typography variant="caption" className="order-output-dialog-l146c11">
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
