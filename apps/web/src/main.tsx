import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { CssBaseline, ThemeProvider, createTheme } from '@mui/material';
import { App } from './App';

function AppShell() {
  const [locale, setLocale] = useState<'ar' | 'en'>(
    () => (localStorage.getItem('woo-ops-locale') as 'ar' | 'en') ?? 'ar',
  );
  const [direction, setDirection] = useState<'rtl' | 'ltr'>(
    () => (localStorage.getItem('woo-ops-direction') as 'rtl' | 'ltr') ?? 'rtl',
  );
  const toggleLocale = () => {
    const next = locale === 'ar' ? 'en' : 'ar';
    setLocale(next);
    localStorage.setItem('woo-ops-locale', next);
  };
  const toggleDirection = () => {
    const next = direction === 'rtl' ? 'ltr' : 'rtl';
    setDirection(next);
    localStorage.setItem('woo-ops-direction', next);
  };
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
        onToggleDirection={toggleDirection}
      />
    </ThemeProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppShell />
  </StrictMode>,
);
