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
            transform: 'translate(0, -9px) scale(0.75)',
          },
        },
      },
      MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
      MuiButton: {
        styleOverrides: { root: { borderRadius: 10, textTransform: 'none', fontWeight: 700 } },
      },
      MuiCard: { styleOverrides: { root: { boxShadow: '0 1px 2px rgba(15, 23, 42, 0.08)' } } },
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
