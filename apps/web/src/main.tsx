import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CssBaseline, ThemeProvider, createTheme } from '@mui/material';
import { App } from './App';

function AppShell() {
  const [locale, setLocale] = useState<'ar' | 'en'>(
    () => (localStorage.getItem('woo-ops-locale') as 'ar' | 'en') ?? 'ar',
  );
  const direction = locale === 'ar' ? 'rtl' : 'ltr';
  const changeLocale = (next: 'ar' | 'en') => {
    setLocale(next);
    localStorage.setItem('woo-ops-locale', next);
    localStorage.setItem('woo-ops-direction', next === 'ar' ? 'rtl' : 'ltr');
  };
  const toggleLocale = () => changeLocale(locale === 'ar' ? 'en' : 'ar');
  document.documentElement.lang = locale;
  document.documentElement.dir = direction;
  const theme = createTheme({
    direction,
    shape: { borderRadius: 12 },
    typography: { fontFamily: 'Cairo, Inter, Tahoma, Arial, sans-serif' },
    palette: {
      mode: 'light',
      primary: { main: '#1558b0', light: '#e8f0fe', dark: '#124b98' },
      background: { default: '#f8fafc', paper: '#ffffff' },
      text: { primary: '#111827', secondary: '#64748b' },
      divider: '#e5e7eb',
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          '[dir="rtl"] .MuiInputBase-input': { textAlign: 'right' },
          '[dir="rtl"] .MuiOutlinedInput-notchedOutline': { direction: 'rtl', textAlign: 'right' },
          '[dir="rtl"] .MuiOutlinedInput-notchedOutline legend': { textAlign: 'right' },
          '[dir="rtl"] .MuiInputLabel-outlined': {
            left: 'auto',
            right: 14,
            transformOrigin: 'top right',
            transform: 'translate(0, 16px) scale(1)',
          },
          '[dir="rtl"] .MuiInputLabel-outlined.MuiInputLabel-sizeSmall': {
            transform: 'translate(0, 9px) scale(1)',
          },
          '[dir="rtl"] .MuiInputLabel-outlined.MuiInputLabel-shrink': {
            transform: 'translate(-2px, -9px) scale(0.75)',
          },
          '[dir="rtl"] .MuiFormControl-root .MuiInputLabel-shrink + .MuiOutlinedInput-root legend':
            {
              marginInlineStart: 6,
              paddingInline: 5,
            },
          '[dir="rtl"] .MuiFormControl-root:has(.MuiSelect-select) .MuiInputLabel-outlined': {
            right: 14,
          },
          '[dir="rtl"] .MuiSelect-icon': {
            left: '14px !important',
            right: 'auto !important',
          },
          '[dir="rtl"] .MuiSelect-select': {
            paddingLeft: '52px !important',
            paddingRight: '16px !important',
          },
          '[dir="rtl"] .MuiAutocomplete-endAdornment': {
            left: '10px !important',
            right: 'auto !important',
          },
          '[dir="rtl"] .MuiAutocomplete-inputRoot': {
            paddingLeft: '48px !important',
            paddingRight: '12px !important',
          },
          '[dir="rtl"] .MuiAutocomplete-input': {
            paddingLeft: '8px !important',
            paddingRight: '6px !important',
          },
          '[dir="rtl"] .MuiAutocomplete-root .MuiInputLabel-outlined': {
            maxWidth: 'calc(100% - 70px)',
          },
        },
      },
      MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
      MuiButton: {
        styleOverrides: {
          root: { borderRadius: 10, textTransform: 'none', fontWeight: 700, minHeight: 40 },
          startIcon: { marginInlineStart: 0, marginInlineEnd: 8 },
          endIcon: { marginInlineStart: 8, marginInlineEnd: 0 },
        },
      },
      MuiSelect: {
        styleOverrides: {
          select:
            direction === 'rtl'
              ? { paddingRight: 16, paddingLeft: 52, textAlign: 'right' }
              : { paddingLeft: 16, paddingRight: 44, textAlign: 'left' },
          icon:
            direction === 'rtl'
              ? { left: 14, right: 'auto', pointerEvents: 'none' }
              : { right: 14, left: 'auto', pointerEvents: 'none' },
        },
      },
      MuiAutocomplete: {
        styleOverrides: {
          inputRoot:
            direction === 'rtl'
              ? { paddingLeft: '42px !important', paddingRight: '12px !important' }
              : { paddingRight: '42px !important' },
          endAdornment:
            direction === 'rtl'
              ? {
                  left: 10,
                  right: 'auto',
                  pointerEvents: 'none',
                  '& button': { pointerEvents: 'auto' },
                }
              : { right: 10, left: 'auto' },
        },
      },
      MuiInputLabel: {
        styleOverrides: {
          root: { transformOrigin: direction === 'rtl' ? 'top right' : 'top left' },
        },
      },
      MuiCard: { styleOverrides: { root: { boxShadow: '0 1px 2px rgba(15, 23, 42, 0.08)' } } },
      MuiTableCell: {
        styleOverrides: {
          root: {
            textAlign: direction === 'rtl' ? 'right' : 'left',
            direction,
          },
        },
      },
    },
  });
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <App
        locale={locale}
        direction={direction}
        onToggleLocale={toggleLocale}
        onLocaleChange={changeLocale}
      />
    </ThemeProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppShell />
  </StrictMode>,
);
