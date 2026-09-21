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
  const ar = locale === 'ar';
  const documents: Array<{ action: DocumentAction; title: string; description: string }> = [
    {
      action: 'generate-invoice',
      title: ar ? 'فاتورة A4' : 'A4 invoice',
      description: ar
        ? 'فاتورة ملونة بتفاصيل المنتجات والإجماليات'
        : 'Branded invoice with itemized totals',
    },
    {
      action: 'generate-thermal',
      title: ar ? 'إيصال حراري' : 'Thermal receipt',
      description: ar ? 'عرض 80 مم وطول مناسب لمحتوى كل طلب' : '80mm roll, sized to each order',
    },
    {
      action: 'generate-label',
      title: ar ? 'بوليصة شحن' : 'Shipping label',
      description: ar
        ? '80 مم · بيانات المستلم والعنوان ومحتويات الطلب'
        : '80mm · recipient, address and order contents',
    },
  ];
  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      aria-labelledby="order-output-title"
      PaperProps={{ dir: ar ? 'rtl' : 'ltr', sx: { borderRadius: 3 } }}
    >
      <DialogTitle id="order-output-title" sx={{ pb: 1 }}>
        {ar ? 'تصدير وطباعة الطلبات' : 'Export & print orders'}
      </DialogTitle>
      <DialogContent>
        <Typography color="text.secondary" variant="body2" sx={{ mb: 2 }}>
          {count}{' '}
          {ar
            ? 'طلب محدد · يتم حفظ كل أمر في سجل التصديرات'
            : 'selected orders · every command is saved in export history'}
        </Typography>
        <Tabs
          value={mode}
          onChange={(_event, value: 'download' | 'print') => setMode(value)}
          variant="fullWidth"
          aria-label={ar ? 'نوع الإخراج' : 'Output action'}
          sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
        >
          <Tab
            id="output-download-tab"
            aria-controls="output-panel"
            value="download"
            label={ar ? 'تحميل الملفات' : 'Download files'}
          />
          <Tab
            id="output-print-tab"
            aria-controls="output-panel"
            value="print"
            label={ar ? 'الطباعة' : 'Print'}
          />
        </Tabs>
        <Stack id="output-panel" role="tabpanel" aria-labelledby={`output-${mode}-tab`} gap={1.5}>
          {mode === 'download' && (
            <Paper variant="outlined" sx={{ p: 2, borderRadius: 2, bgcolor: 'grey.50' }}>
              <Typography fontWeight={700} sx={{ mb: 1 }}>
                {ar ? 'جداول Excel' : 'Excel workbooks'}
              </Typography>
              <Stack direction="row" gap={1} flexWrap="wrap">
                <Button
                  variant="outlined"
                  onClick={() => {
                    onClose();
                    onExcel(false);
                  }}
                >
                  {ar ? 'تصدير Excel' : 'Export Excel'}
                </Button>
                <Button
                  variant="outlined"
                  onClick={() => {
                    onClose();
                    onExcel(true);
                  }}
                >
                  {ar ? 'شيت الشحن' : 'Shipping sheet'}
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
                  aria-label={`${mode === 'print' ? (ar ? 'طباعة' : 'Print') : ar ? 'تحميل' : 'Download'} ${item.title}`}
                  onClick={() => {
                    onClose();
                    onDocument(item.action, mode === 'print');
                  }}
                >
                  {mode === 'print' ? (ar ? 'طباعة' : 'Print') : 'PDF'}
                </Button>
              </Stack>
            </Paper>
          ))}
          <Typography variant="caption" color="text.secondary">
            {mode === 'print'
              ? ar
                ? 'يفتح حوار الطباعة بعد تجهيز الملف. للحراري اختر 80 مم ومقياس 100%.'
                : 'Opens print after generation. For rolls, choose 80mm paper and 100% scale.'
              : ar
                ? 'يبدأ التحميل بعد التجهيز، ويظل تحديد الطلبات محفوظًا.'
                : 'Downloads when ready. Your order selection is preserved.'}
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{ar ? 'إغلاق' : 'Close'}</Button>
      </DialogActions>
    </Dialog>
  );
}
