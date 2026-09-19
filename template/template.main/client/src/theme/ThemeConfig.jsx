import React, { createContext, useContext, useState, useMemo, useEffect } from 'react';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import rtlPlugin from 'stylis-plugin-rtl';
import { CacheProvider } from '@emotion/react';
import createCache from '@emotion/cache';
import { prefixer } from 'stylis';
import CssBaseline from '@mui/material/CssBaseline';
import './ThemeConfig.css';

// Create Emotion cache for RTL
const cacheRtl = createCache({
  key: 'muirtl',
  stylisPlugins: [prefixer, rtlPlugin],
  prepend: true,
});

export const ColorModeContext = createContext({
  toggleColorMode: () => { },
  mode: 'light'
});

export const useColorMode = () => useContext(ColorModeContext);

export const ThemeConfig = ({ children }) => {
  // Read initial mode from localStorage or fallback to system preferences
  const [mode, setMode] = useState(() => {
    const savedMode = localStorage.getItem('themeMode');
    if (savedMode) return savedMode;
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    return systemPrefersDark ? 'dark' : 'light';
  });

  useEffect(() => {
    localStorage.setItem('themeMode', mode);
    document.documentElement.setAttribute('data-theme', mode);
  }, [mode]);

  const colorMode = useMemo(
    () => ({
      mode,
      toggleColorMode: () => {
        setMode((prevMode) => (prevMode === 'light' ? 'dark' : 'light'));
      },
    }),
    [mode]
  );

  const theme = useMemo(
    () =>
      createTheme({
        direction: 'rtl',
        palette: {
          mode,
          ...(mode === 'light'
            ? {
              // ── Light Mode: Google Workspace / Cloud Console Palette ──
              primary: {
                main: '#1a73e8',     // Google Blue
                light: '#4285f4',
                dark: '#0d56b3',
                contrastText: '#ffffff',
              },
              secondary: {
                main: '#5f6368',     // Google Grey
                light: '#70757a',
                dark: '#3c4043',
                contrastText: '#ffffff',
              },
              background: {
                default: '#f8f9fa',  // Google Background Grey
                paper: '#ffffff',
              },
              text: {
                primary: '#202124',  // Google Dark Grey Text
                secondary: '#5f6368', // Google Secondary Grey Text
              },
              divider: '#dadce0',    // Google Standard Divider
            }
            : {
              // ── Dark Mode: Premium Unified Dark Charcoal Theme ──
              primary: {
                main: '#8ab4f8',     // Google Light Blue
                light: '#aecbfa',
                dark: '#669df6',
                contrastText: '#202124',
              },
              secondary: {
                main: '#9aa0a6',     // Google Light Grey
                light: '#bdc1c6',
                dark: '#2d2d2d',
                contrastText: '#202124',
              },
              background: {
                default: '#121212',  // Dark Background
                paper: '#1e1e1e',    // Sidebar & Card Surface (Charcoal)
              },
              text: {
                primary: '#e8eaed',  // Light Text
                secondary: '#9aa0a6', // Light Secondary Text
              },
              divider: '#3c4043',    // Dark Divider
            }),
        },
        typography: {
          fontFamily: [
            'Cairo',
            'Inter',
            'Roboto',
            '"Segoe UI"',
            'Arial',
            'sans-serif',
          ].join(','),
          h1: { fontWeight: 700 },
          h2: { fontWeight: 700 },
          h3: { fontWeight: 600 },
          h4: { fontWeight: 600 },
          h5: { fontWeight: 600 },
          h6: { fontWeight: 600 },
          subtitle1: { fontWeight: 500 },
          subtitle2: { fontWeight: 600 },
          button: { textTransform: 'none', fontWeight: 600 },
        },
        shape: {
          borderRadius: 4, // "مش راوند" - Sharp subtle rounding for Google Design
        },
        components: {
          MuiCssBaseline: {
            styleOverrides: {
              body: {
                fontFamily: 'Cairo, Inter, Roboto, sans-serif',
              },
            },
          },
          MuiInputBase: {
            styleOverrides: {
              input: {
                textAlign: 'right',
                '&.ltr-value': {
                  textAlign: 'left', // ltr-value
                },
              },
            },
          },
          MuiOutlinedInput: {
            styleOverrides: {
              root: {
                borderRadius: 4,
              },
            },
          },
          MuiFormLabel: {
            styleOverrides: {
              root: {
                fontFamily: 'Cairo, Inter, Roboto, sans-serif',
              },
            },
          },

          MuiMenuItem: {
            styleOverrides: {
              root: {
                fontFamily: 'Cairo, Inter, Roboto, sans-serif',
                fontSize: '0.85rem',
                fontWeight: 500,
              },
            },
          },
          MuiButton: {
            styleOverrides: {
              root: {
                borderRadius: 4, // Rectangular with subtle rounding
                boxShadow: 'none',
                fontWeight: 600,
                textTransform: 'none',
                padding: '6px 16px',
                transition: 'all 0.15s ease',
                '&:hover': {
                  boxShadow: 'none',
                  backgroundColor: mode === 'light' ? 'rgba(26, 115, 232, 0.04)' : 'rgba(138, 180, 248, 0.08)',
                },
              },
              contained: {
                '&:hover': {
                  boxShadow: 'none',
                  backgroundColor: mode === 'light' ? '#1557b0' : '#aecbfa',
                },
              },
              outlined: {
                borderWidth: '1px',
                borderColor: mode === 'light' ? '#dadce0' : '#5f6368',
                padding: '5px 15px',
                color: mode === 'light' ? '#1a73e8' : '#8ab4f8',
                '&:hover': {
                  borderWidth: '1px',
                  borderColor: mode === 'light' ? '#1a73e8' : '#8ab4f8',
                  backgroundColor: mode === 'light' ? 'rgba(26, 115, 232, 0.04)' : 'rgba(138, 180, 248, 0.08)',
                },
              },
            },
          },
          MuiPaper: {
            styleOverrides: {
              root: {
                borderRadius: 4,
                backgroundImage: 'none',
              },
            },
          },
          MuiCard: {
            styleOverrides: {
              root: {
                borderRadius: 4,
                backgroundImage: 'none',
                border: mode === 'light' ? '1px solid #dadce0' : '1px solid #3c4043',
                boxShadow: 'none', // Flat Google Card style
              },
            },
          },
          MuiAppBar: {
            styleOverrides: {
              root: {
                backgroundColor: mode === 'light' ? '#ffffff' : '#202124',
                color: mode === 'light' ? '#202124' : '#e8eaed',
                borderBottom: mode === 'light' ? '1px solid #dadce0' : '1px solid #3c4043',
                boxShadow: 'none',
                borderRadius: 0,
              },
            },
          },
          MuiDrawer: {
            styleOverrides: {
              paper: {
                backgroundColor: mode === 'light' ? '#ffffff' : '#202124',
                borderRight: 'none',
                borderLeft: 'none',
                borderRadius: 0,
              },
            },
          },
          MuiDialog: {
            styleOverrides: {
              paper: {
                borderRadius: 0,
              },
            },
          },
          MuiListItemButton: {
            styleOverrides: {
              root: {
                borderRadius: 100, // Keep sidebar navigation drawer pill-shaped active style as requested
                margin: '2px 8px',
                padding: '8px 16px',
                '&.Mui-selected': {
                  backgroundColor: mode === 'light' ? 'rgba(26, 115, 232, 0.08)' : 'rgba(138, 180, 248, 0.12)',
                  color: mode === 'light' ? '#1a73e8' : '#8ab4f8',
                  fontWeight: 700,
                  '&:hover': {
                    backgroundColor: mode === 'light' ? 'rgba(26, 115, 232, 0.12)' : 'rgba(138, 180, 248, 0.16)',
                  },
                  '& .MuiListItemIcon-root': {
                    color: mode === 'light' ? '#1a73e8' : '#8ab4f8',
                  },
                },
              },
            },
          },
          MuiOutlinedInput: {
            styleOverrides: {
              root: {
                borderRadius: 4, // Google input style
                '& fieldset': {
                  borderColor: mode === 'light' ? '#dadce0' : '#3c4043',
                },
                '&:hover fieldset': {
                  borderColor: mode === 'light' ? '#80868b' : '#9aa0a6',
                },
                '&.Mui-focused fieldset': {
                  borderColor: mode === 'light' ? '#1a73e8' : '#8ab4f8',
                  borderWidth: '2px',
                },
              },
            },
          },
          MuiChip: {
            styleOverrides: {
              root: {
                borderRadius: 4, // Rectangular chips with subtle rounding
                fontWeight: 600,
                fontSize: '0.75rem',
                backgroundColor: mode === 'light' ? '#f1f3f4' : '#3c4043',
                color: mode === 'light' ? '#3c4043' : '#bdc1c6',
              },
            },
          },
          MuiTooltip: {
            styleOverrides: {
              tooltip: {
                borderRadius: 4,
                fontSize: '0.8rem',
                backgroundColor: mode === 'light' ? '#202124' : '#e8eaed',
                color: mode === 'light' ? '#ffffff' : '#202124',
              },
            },
          },
          MuiDialog: {
            styleOverrides: {
              paper: {
                borderRadius: 6,
                padding: 12,
                width: 'calc(100vw - 32px)',
                maxWidth: 'min(720px, calc(100vw - 32px))',
                maxHeight: 'calc(100vh - 32px)',
                margin: 16,
                boxShadow: mode === 'light'
                  ? '0 24px 38px 3px rgba(0,0,0,0.14), 0 9px 46px 8px rgba(0,0,0,0.12), 0 11px 15px -7px rgba(0,0,0,0.2)'
                  : '0 24px 38px 3px rgba(0,0,0,0.5), 0 9px 46px 8px rgba(0,0,0,0.4), 0 11px 15px -7px rgba(0,0,0,0.6)',
              },
            },
          },
          MuiTableContainer: {
            styleOverrides: {
              root: {
                borderRadius: 4,
                border: mode === 'light' ? '1px solid #dadce0' : '1px solid #3c4043',
                overflow: 'hidden',
                boxShadow: 'none',
              },
            },
          },
          MuiTableHead: {
            styleOverrides: {
              root: {
                backgroundColor: mode === 'light' ? '#f8f9fa' : '#2d2f31', // Google Table header style
                '& .MuiTableCell-root': {
                  fontWeight: 700,
                  fontSize: '0.8rem',
                  color: mode === 'light' ? '#202124' : '#e8eaed',
                  borderBottom: mode === 'light' ? '2px solid #dadce0' : '2px solid #3c4043',
                },
              },
            },
          },
          MuiTableCell: {
            styleOverrides: {
              root: {
                padding: '10px 16px', // Compact layout padding
                fontSize: '0.85rem',
                borderBottom: mode === 'light' ? '1px solid #dadce0' : '1px solid #3c4043',
              },
            },
          },
          MuiTabs: {
            styleOverrides: {
              root: {
                minHeight: 40,
                borderBottom: mode === 'light' ? '1px solid #dadce0' : '1px solid #3c4043',
              },
              indicator: {
                height: 3,
                backgroundColor: mode === 'light' ? '#1a73e8' : '#8ab4f8',
              },
            },
          },
          MuiTab: {
            styleOverrides: {
              root: {
                fontWeight: 600,
                fontSize: '0.85rem',
                textTransform: 'none',
                minHeight: 40,
                color: mode === 'light' ? '#5f6368' : '#9aa0a6',
                '&.Mui-selected': {
                  color: mode === 'light' ? '#1a73e8' : '#8ab4f8',
                },
              },
            },
          },
        },
      }),
    [mode]
  );

  return (
    <CacheProvider value={cacheRtl}>
      <ColorModeContext.Provider value={colorMode}>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <div dir="rtl" className="theme-root">
            {children}
          </div>
        </ThemeProvider>
      </ColorModeContext.Provider>
    </CacheProvider>
  );
};

export default ThemeConfig;
