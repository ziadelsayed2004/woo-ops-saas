import './WorkspaceShell.css';
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
import { getShellCopy } from './i18n';

export type ShellNavigationItem = {
  id: string;
  label: string;
  group: 'workspace' | 'management';
};

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
  const copy = getShellCopy(locale);

  const drawer = (mobile = false) => (
    <Stack component="nav" aria-label={copy.primaryNavigation} className="workspace-shell-l94c5">
      <Toolbar
        className={`workspace-shell__brand ${collapsed && !mobile ? 'workspace-shell__brand--collapsed' : ''}`}
      >
        <Avatar variant="rounded" className="workspace-shell-l103c9">
          W
        </Avatar>
        {(!collapsed || mobile) && (
          <Box className="workspace-shell-l110c11">
            <Typography className="workspace-shell-l111c13">Woo Ops</Typography>
            <Typography variant="caption" className="workspace-shell-l114c13">
              {copy.storeOperations}
            </Typography>
          </Box>
        )}
      </Toolbar>
      <Divider />
      <Box className="workspace-shell-l121c7">
        {(['workspace', 'management'] as const).map((group) => (
          <Box key={group} className="workspace-shell-l123c11">
            {(!collapsed || mobile) && (
              <Typography variant="overline" className="workspace-shell-l125c15">
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
                        className={`workspace-shell__navigation-item ${collapsed && !mobile ? 'workspace-shell__navigation-item--collapsed' : ''}`}
                      >
                        <ListItemIcon
                          data-testid={`navigation-${item.id}-icon`}
                          className="workspace-shell-l166c25"
                        >
                          {iconFor(item.id)}
                        </ListItemIcon>
                        {(!collapsed || mobile) && (
                          <ListItemText
                            primary={item.label}
                            className="workspace-shell__item-text"
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
      <Stack className="workspace-shell-l191c7">
        {!mobile && (
          <Tooltip title={collapsed ? copy.expandSidebar : copy.collapseSidebar} placement="left">
            <Button
              variant="outlined"
              color="inherit"
              onClick={() => setCollapsed((value) => !value)}
              aria-label={collapsed ? copy.expandSidebar : copy.accountAndCollapse}
              data-testid="sidebar-account-toggle"
              className={`workspace-shell__account-toggle ${collapsed ? 'workspace-shell__account-toggle--collapsed' : ''}`}
            >
              {!collapsed && (
                <Typography
                  component="span"
                  variant="caption"
                  dir="ltr"
                  title={userEmail}
                  className="workspace-shell-l213c17"
                >
                  {userEmail}
                </Typography>
              )}
              <Box component="span" aria-hidden="true" className="workspace-shell-l225c15">
                {collapsed ? (
                  direction === 'rtl' ? (
                    <ChevronLeft />
                  ) : (
                    <ChevronRight />
                  )
                ) : direction === 'rtl' ? (
                  <ChevronRight />
                ) : (
                  <ChevronLeft />
                )}
              </Box>
            </Button>
          </Tooltip>
        )}
        {mobile && (
          <Typography
            variant="caption"
            dir="ltr"
            title={userEmail}
            className="workspace-shell-l242c11"
          >
            {userEmail}
          </Typography>
        )}
      </Stack>
    </Stack>
  );

  return (
    <Box dir={direction} className="workspace-shell-l266c5">
      <AppBar
        position="fixed"
        color="inherit"
        elevation={0}
        className={`workspace-shell__app-bar workspace-shell__offset--${collapsed ? 'collapsed' : 'expanded'}`}
      >
        <Toolbar className="workspace-shell-l279c9">
          <IconButton
            onClick={() => setMobileOpen(true)}
            aria-label={copy.openMenu}
            className="workspace-shell-l280c11"
          >
            <MenuIcon />
          </IconButton>
          <Box className="workspace-shell-l287c11" />
          <Button
            variant="contained"
            size="small"
            onClick={onCreateManual}
            className="workspace-shell-l288c11"
          >
            {copy.createManualOrder}
          </Button>
          <Button
            onClick={onToggleLocale}
            startIcon={<LanguageOutlined />}
            size="small"
            className="workspace-shell-l296c11"
          >
            {copy.switchLanguage}
          </Button>
          <Tooltip title={copy.signOut}>
            <IconButton onClick={onLogout} className="workspace-shell-l305c13">
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
        className="workspace-shell__mobile-drawer"
      >
        {drawer(true)}
      </Drawer>
      <Drawer
        variant="permanent"
        anchor={direction === 'rtl' ? 'right' : 'left'}
        open
        className={`workspace-shell__desktop-drawer workspace-shell__drawer--${collapsed ? 'collapsed' : 'expanded'}`}
      >
        {drawer()}
      </Drawer>
      <Box
        component="main"
        className={`workspace-shell__main workspace-shell__offset--${collapsed ? 'collapsed' : 'expanded'}`}
      >
        <Toolbar className="workspace-shell-l347c9" />
        <Box className="workspace-shell-l348c9">{children}</Box>
      </Box>
    </Box>
  );
}
