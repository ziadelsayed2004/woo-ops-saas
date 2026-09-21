import { type ReactNode, useState } from 'react';
import {
  AppBar,
  Avatar,
  Box,
  Button,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  Toolbar,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  AddShoppingCartOutlined,
  AnalyticsOutlined,
  ChevronLeft,
  ChevronRight,
  DashboardOutlined,
  DescriptionOutlined,
  HubOutlined,
  LanguageOutlined,
  LogoutOutlined,
  ManageAccountsOutlined,
  MapOutlined,
  Menu as MenuIcon,
  ReceiptLongOutlined,
  SettingsOutlined,
  ShoppingBagOutlined,
  SyncOutlined,
} from '@mui/icons-material';

export type ShellNavigationItem = {
  id: string;
  label: string;
  group: 'workspace' | 'management';
};

const drawerWidth = 272;
const collapsedWidth = 76;

const iconFor = (id: string): ReactNode =>
  ({
    overview: <DashboardOutlined />,
    orders: <ShoppingBagOutlined />,
    catalog: <ShoppingBagOutlined />,
    manual: <AddShoppingCartOutlined />,
    exports: <ReceiptLongOutlined />,
    documents: <DescriptionOutlined />,
    analytics: <AnalyticsOutlined />,
    connections: <HubOutlined />,
    'field-mappings': <MapOutlined />,
    settings: <SettingsOutlined />,
    members: <ManageAccountsOutlined />,
    operations: <SyncOutlined />,
  })[id] ?? <DashboardOutlined />;

export function WorkspaceShell({
  direction,
  locale,
  userEmail,
  active,
  navigation,
  onNavigate,
  onToggleLocale,
  onLogout,
  onCreateManual,
  children,
}: {
  direction: 'rtl' | 'ltr';
  locale: 'ar' | 'en';
  userEmail: string;
  active: string;
  navigation: readonly ShellNavigationItem[];
  onNavigate: (id: string) => void;
  onToggleLocale: () => void;
  onLogout: () => void;
  onCreateManual: () => void;
  children: ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const width = collapsed ? collapsedWidth : drawerWidth;
  const copy =
    locale === 'ar'
      ? {
          workspace: 'مساحة العمل',
          management: 'الإدارة',
          menu: 'فتح القائمة',
          collapse: 'طي القائمة',
        }
      : {
          workspace: 'Workspace',
          management: 'Management',
          menu: 'Open menu',
          collapse: 'Collapse menu',
        };

  const drawer = (mobile = false) => (
    <Stack
      component="nav"
      aria-label={locale === 'ar' ? 'التنقل الرئيسي' : 'Primary navigation'}
      height="100%"
      bgcolor="background.paper"
    >
      <Toolbar
        sx={{ minHeight: '72px !important', px: collapsed && !mobile ? 1.5 : 2.5, gap: 1.5 }}
      >
        <Avatar
          variant="rounded"
          sx={{ bgcolor: 'primary.main', width: 40, height: 40, fontWeight: 900 }}
        >
          W
        </Avatar>
        {(!collapsed || mobile) && (
          <Box minWidth={0}>
            <Typography fontWeight={900} lineHeight={1.1}>
              Woo Ops
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap>
              {locale === 'ar' ? 'إدارة متجر وسط البلد' : 'Wasat Al Balad operations'}
            </Typography>
          </Box>
        )}
      </Toolbar>
      <Divider />
      <Box sx={{ overflowY: 'auto', flex: 1, px: 1.25, py: 1.5 }}>
        {(['workspace', 'management'] as const).map((group) => (
          <Box key={group} mb={1.5}>
            {(!collapsed || mobile) && (
              <Typography
                variant="overline"
                color="text.secondary"
                fontWeight={800}
                sx={{ px: 1.5 }}
              >
                {copy[group]}
              </Typography>
            )}
            <List disablePadding>
              {navigation
                .filter((item) => item.group === group)
                .map((item) => (
                  <ListItem key={item.id} disablePadding>
                    <Tooltip title={collapsed && !mobile ? item.label : ''} placement="left">
                      <ListItemButton
                        data-testid={`navigation-${item.id}`}
                        aria-label={collapsed && !mobile ? item.label : undefined}
                        selected={active === item.id}
                        onClick={() => {
                          onNavigate(item.id);
                          if (mobile) setMobileOpen(false);
                        }}
                        sx={{
                          borderRadius: 3,
                          minHeight: 46,
                          my: 0.4,
                          px: collapsed && !mobile ? 1.5 : 1.75,
                          justifyContent: collapsed && !mobile ? 'center' : 'initial',
                          direction,
                          ...(!collapsed || mobile
                            ? {
                                display: 'flex',
                                flexDirection: direction === 'rtl' ? 'row' : 'row',
                                gap: 1.25,
                                textAlign: direction === 'rtl' ? 'right' : 'left',
                              }
                            : {}),
                          '&.Mui-selected': { bgcolor: 'primary.light', color: 'primary.dark' },
                        }}
                      >
                        <ListItemIcon
                          data-testid={`navigation-${item.id}-icon`}
                          sx={{
                            minWidth: 0,
                            color: 'inherit',
                            justifyContent: 'center',
                          }}
                        >
                          {iconFor(item.id)}
                        </ListItemIcon>
                        {(!collapsed || mobile) && (
                          <ListItemText
                            primary={item.label}
                            sx={{ m: 0, textAlign: direction === 'rtl' ? 'right' : 'left' }}
                          />
                        )}
                      </ListItemButton>
                    </Tooltip>
                  </ListItem>
                ))}
            </List>
          </Box>
        ))}
      </Box>
      <Divider />
      <Stack p={1.25} gap={1}>
        {(!collapsed || mobile) && (
          <Box
            sx={{
              px: 1.25,
              py: 1,
              bgcolor: 'background.default',
              borderRadius: 2,
              minWidth: 0,
            }}
          >
            <Typography
              variant="caption"
              color="text.secondary"
              noWrap
              dir="ltr"
              title={userEmail}
              sx={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis' }}
            >
              {userEmail}
            </Typography>
          </Box>
        )}
        {!mobile && (
          <Button
            variant="outlined"
            color="inherit"
            onClick={() => setCollapsed((value) => !value)}
            aria-label={copy.collapse}
            startIcon={
              collapsed ? undefined : direction === 'rtl' ? <ChevronRight /> : <ChevronLeft />
            }
            sx={{
              justifyContent: collapsed ? 'center' : 'flex-start',
              minWidth: 0,
              width: '100%',
              minHeight: 42,
              borderColor: 'divider',
              px: collapsed ? 1 : 1.5,
              '& .MuiButton-startIcon': { m: 0, me: 1 },
            }}
          >
            {collapsed ? direction === 'rtl' ? <ChevronLeft /> : <ChevronRight /> : copy.collapse}
          </Button>
        )}
      </Stack>
    </Stack>
  );

  return (
    <Box minHeight="100vh" bgcolor="background.default" dir={direction}>
      <AppBar
        position="fixed"
        color="inherit"
        elevation={0}
        sx={{
          borderBottom: 1,
          borderColor: 'divider',
          width: { md: `calc(100% - ${width}px)` },
          ...(direction === 'rtl' ? { mr: { md: `${width}px` } } : { ml: { md: `${width}px` } }),
          transition: (theme) => theme.transitions.create(['width', 'margin']),
        }}
      >
        <Toolbar sx={{ minHeight: '72px !important', gap: 1 }}>
          <IconButton
            onClick={() => setMobileOpen(true)}
            sx={{ display: { md: 'none' } }}
            aria-label={copy.menu}
          >
            <MenuIcon />
          </IconButton>
          <Box flex={1} />
          <Button
            variant="contained"
            size="small"
            onClick={onCreateManual}
            sx={{ display: { xs: 'none', sm: 'inline-flex' } }}
          >
            {locale === 'ar' ? 'إنشاء طلب يدوي' : 'Create manual order'}
          </Button>
          <Button
            onClick={onToggleLocale}
            startIcon={<LanguageOutlined />}
            size="small"
            sx={{ gap: 0.75, px: 1.25, '& .MuiButton-startIcon': { m: 0 } }}
          >
            {locale === 'ar' ? 'English' : 'العربية'}
          </Button>
          <Tooltip title={locale === 'ar' ? 'تسجيل الخروج' : 'Sign out'}>
            <IconButton onClick={onLogout} color="inherit">
              <LogoutOutlined />
            </IconButton>
          </Tooltip>
        </Toolbar>
      </AppBar>
      <Drawer
        variant="temporary"
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        anchor={direction === 'rtl' ? 'right' : 'left'}
        ModalProps={{ keepMounted: true }}
        sx={{ display: { xs: 'block', md: 'none' }, '& .MuiDrawer-paper': { width: drawerWidth } }}
      >
        {drawer(true)}
      </Drawer>
      <Drawer
        variant="permanent"
        anchor={direction === 'rtl' ? 'right' : 'left'}
        open
        sx={{
          display: { xs: 'none', md: 'block' },
          width,
          flexShrink: 0,
          '& .MuiDrawer-paper': {
            width,
            boxSizing: 'border-box',
            overflowX: 'hidden',
            transition: (theme) => theme.transitions.create('width'),
          },
        }}
      >
        {drawer()}
      </Drawer>
      <Box
        component="main"
        sx={{
          minWidth: 0,
          ...(direction === 'rtl' ? { mr: { md: `${width}px` } } : { ml: { md: `${width}px` } }),
          transition: (theme) => theme.transitions.create('margin'),
        }}
      >
        <Toolbar sx={{ minHeight: '72px !important' }} />
        <Box
          sx={{
            width: '100%',
            maxWidth: 1600,
            mx: 'auto',
            px: { xs: 2, sm: 3, lg: 4 },
            py: { xs: 2.5, md: 4 },
          }}
        >
          {children}
        </Box>
      </Box>
    </Box>
  );
}
