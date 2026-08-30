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
    typography: { fontFamily: 'Tahoma, Arial, sans-serif' },
    palette: { mode: 'light', primary: { main: '#1565c0' } },
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
