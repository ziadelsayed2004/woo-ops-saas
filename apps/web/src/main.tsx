import './main.css';
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
      primary: { main: '#720eec', light: '#f1e8ff', dark: '#4d0a9e' },
      background: { default: '#f8fafc', paper: '#ffffff' },
      text: { primary: '#111827', secondary: '#64748b' },
      divider: '#e5e7eb',
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
