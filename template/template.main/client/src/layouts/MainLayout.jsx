import React, { useState, useEffect, useCallback } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../app/AuthContext';
import { apiClient } from '../services/apiClient';
import { formatEgyptDateTime } from '../utils/formatters';
import Breadcrumbs from '../components/Breadcrumbs';
import { APP_CONFIG } from '../config/appConfig';
import { useColorMode } from '../theme/ThemeConfig';
import { t } from '../locales/t';
import logoImg from '../assets/logo.svg';
import codzHubSparkDark from '../assets/CodzHub_Code_Spark_Mark_Dark.svg';
import codzHubSparkLight from '../assets/CodzHub_Code_Spark_Mark_Light.svg';
import codzHubWordmarkDark from '../assets/CodzHub_Wordmark_Dark.svg';
import codzHubWordmarkLight from '../assets/CodzHub_Wordmark_Light.svg';
import {
  AppBar,
  Box,
  CssBaseline,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Typography,
  Button,
  Chip,
  Avatar,
  Tooltip,
  ListSubheader,
  Menu,
  MenuItem,
  Badge,
  Collapse,
  useTheme
} from '@mui/material';
import {
  Menu as MenuIcon,
  Dashboard as DashboardIcon,
  People as PeopleIcon,
  Store as StoreIcon,
  Category as CategoryIcon,
  Create as CreateIcon,
  Book as BookIcon,
  Receipt as ReceiptIcon,
  Payment as PaymentIcon,
  AccountBalanceWallet as WalletIcon,
  LocalShipping as LocalShippingIcon,
  Assessment as AssessmentIcon,
  CloudDownload as CloudDownloadIcon,
  History as HistoryIcon,
  SettingsBackupRestore as SettingsBackupRestoreIcon,
  ExitToApp as ExitToAppIcon,
  DarkMode as DarkModeIcon,
  LightMode as LightModeIcon,
  MenuOpen as MenuOpenIcon,
  Notifications as NotificationsIcon,
  Error as ErrorIcon,
  Warning as WarningIcon,
  Info as InfoIcon,
  CheckCircle as CheckCircleIcon,
  Inventory as InventoryIcon,
  Person as PersonIcon,
  ExpandMore as ExpandMoreIcon
} from '@mui/icons-material';
import '../styles/MainLayout.css';

function readCollapsedSections(storageKey) {
  if (!storageKey) return {};

  try {
    const storedValue = JSON.parse(localStorage.getItem(storageKey) || '{}');
    return storedValue && typeof storedValue === 'object' && !Array.isArray(storedValue)
      ? storedValue
      : {};
  } catch {
    return {};
  }
}

export const MainLayout = () => {
  const { user, logout, hasPermission } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { mode, toggleColorMode } = useColorMode();
  const muiTheme = useTheme();

  const userRoles = Array.isArray(user?.roles) ? user.roles : [];
  const isInvoiceVisibilityRestricted = userRoles.some((role) =>
    ['shipping_user', 'inventory_manager'].includes(role)
  ) && !userRoles.some((role) => ['super_admin', 'assistant', 'readonly_viewer'].includes(role));

  const [mobileOpen, setMobileOpen] = useState(false);
  const sidebarStorageKey = user?.id ? `sidebarCollapsed:${user.id}` : null;
  const [collapsed, setCollapsed] = useState(() => {
    if (!user?.id) return false;
    return localStorage.getItem(`sidebarCollapsed:${user.id}`) === 'true';
  });
  const sectionsStorageKey = user?.id ? `sidebarSectionsCollapsed:${user.id}` : null;
  const [collapsedSections, setCollapsedSections] = useState(() =>
    readCollapsedSections(user?.id ? `sidebarSectionsCollapsed:${user.id}` : null)
  );
  const [anchorEl, setAnchorEl] = useState(null);
  const [notifyAnchorEl, setNotifyAnchorEl] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!sidebarStorageKey) return;
    setCollapsed(localStorage.getItem(sidebarStorageKey) === 'true');
  }, [sidebarStorageKey]);

  useEffect(() => {
    setCollapsedSections(readCollapsedSections(sectionsStorageKey));
  }, [sectionsStorageKey]);

  const toggleSidebar = () => {
    setCollapsed(previous => {
      const next = !previous;
      if (sidebarStorageKey) localStorage.setItem(sidebarStorageKey, String(next));
      return next;
    });
  };

  const updateCollapsedSections = useCallback((updater) => {
    setCollapsedSections(previous => {
      const next = updater(previous);
      if (sectionsStorageKey) localStorage.setItem(sectionsStorageKey, JSON.stringify(next));
      return next;
    });
  }, [sectionsStorageKey]);

  const toggleSection = useCallback((sectionKey) => {
    updateCollapsedSections(previous => ({
      ...previous,
      [sectionKey]: !previous[sectionKey]
    }));
  }, [updateCollapsedSections]);

  // ── Notifications Fetching ──
  const fetchNotifications = async () => {
    if (!user || !hasPermission('notifications.view')) return;
    try {
      const counts = await apiClient.get('/notifications/counts');
      setUnreadCount(counts.unread || 0);
      const list = await apiClient.get('/notifications?limit=5');
      setNotifications(list || []);
    } catch (err) {
      console.error('Error fetching notifications:', err);
    }
  };

  useEffect(() => {
    if (!hasPermission('notifications.view')) {
      setNotifications([]);
      setUnreadCount(0);
      return undefined;
    }
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 15000);
    return () => clearInterval(interval);
  }, [user]);

  const handleMarkAsRead = async (id, event) => {
    if (event) event.stopPropagation();
    if (!hasPermission('notifications.manage')) return;
    try {
      await apiClient.patch(`/notifications/${id}/read`);
      await fetchNotifications();
    } catch (err) {
      console.error('Error marking notification as read:', err);
    }
  };

  const handleResolve = async (id, event) => {
    if (event) event.stopPropagation();
    if (!hasPermission('notifications.manage')) return;
    try {
      await apiClient.patch(`/notifications/${id}/resolve`);
      await fetchNotifications();
    } catch (err) {
      console.error('Error resolving notification:', err);
    }
  };

  const getSeverityIcon = (severity) => {
    switch (severity) {
      case 'critical': return <ErrorIcon className="notification-severity-icon notification-severity-icon--critical" fontSize="small" />;
      case 'warning': return <WarningIcon className="notification-severity-icon notification-severity-icon--warning" fontSize="small" />;
      case 'success': return <CheckCircleIcon className="notification-severity-icon notification-severity-icon--success" fontSize="small" />;
      case 'info':
      default: return <InfoIcon className="notification-severity-icon notification-severity-icon--info" fontSize="small" />;
    }
  };

  // ── Page Titles ──
  const getPageTitle = () => {
    const pathnames = location.pathname.split('/').filter((x) => x);
    if (pathnames.length === 0) return t('nav.dashboard');
    const lastSegment = pathnames[pathnames.length - 1];
    const routeTitles = {
      'profile': t('nav.profile'),
      'users': t('nav.users'),
      'outlet-types': t('nav.outletTypes'),
      'outlets': t('nav.outlets'),
      'authors': t('nav.authors'),
      'products': t('nav.products'),
      'categories': t('nav.categories'),
      'inventory': t('nav.inventory'),
      'invoices': t('nav.invoices'),
      'returns': t('nav.returns'),
      'payments': t('nav.payments'),
      'finance': t('nav.finance'),
      'shipments': t('nav.shipments'),
      'reports': t('nav.reports'),
      'exports': t('nav.exports'),
      'audit': t('nav.audit'),
      'notifications': t('nav.notifications')
    };
    return routeTitles[lastSegment] || lastSegment;
  };

  // ── Event Handlers ──
  const handleDrawerToggle = () => setMobileOpen(!mobileOpen);
  const handleMenuClick = (event) => setAnchorEl(event.currentTarget);
  const handleMenuClose = () => setAnchorEl(null);
  const handleNotifyClick = (event) => setNotifyAnchorEl(event.currentTarget);
  const handleNotifyClose = () => setNotifyAnchorEl(null);
  const openMenu = Boolean(anchorEl);
  const openNotify = Boolean(notifyAnchorEl);

  const handleLogout = async () => {
    handleMenuClose();
    try {
      await logout();
      navigate('/login');
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  // ── Sidebar Menu Sections ──
  const menuSections = [
    {
      titleKey: 'nav.main',
      title: 'الرئيسية',
      items: [
        { textKey: 'nav.dashboard', text: 'لوحة التحكم', icon: <DashboardIcon />, path: '/', permission: null }
      ]
    },
    {
      titleKey: 'nav.catalog',
      title: 'الكتالوج والتسعير',
      items: [
        { textKey: 'nav.products', text: 'الكتب والمنتجات', icon: <BookIcon />, path: '/products', permission: 'products.view' },
        { textKey: 'nav.categories', text: 'تصنيفات الكتب', icon: <CategoryIcon />, path: '/categories', permission: 'categories.view' },
        { textKey: 'nav.authors', text: 'المؤلفين', icon: <CreateIcon />, path: '/authors', permission: 'authors.view' },
        { textKey: 'nav.outletTypes', text: 'فئات المنافذ', icon: <CategoryIcon />, path: '/outlet-types', permission: 'outlet_types.view' }
      ]
    },
    {
      titleKey: 'nav.distribution',
      title: 'المنافذ والتوزيع',
      items: [
        { textKey: 'nav.outlets', text: 'المنافذ والفروع', icon: <StoreIcon />, path: '/outlets', permission: 'outlets.view' }
      ]
    },
    {
      titleKey: 'nav.sales',
      title: 'الفواتير والمبيعات',
      items: [
        { textKey: 'nav.invoices', text: 'الفواتير', icon: <ReceiptIcon />, path: '/invoices', permission: 'invoices.view' },
        { textKey: 'nav.returns', text: 'المرتجعات', icon: <HistoryIcon />, path: '/returns', permission: 'returns.view', hideForRestrictedInvoiceRole: true }
      ]
    },
    {
      titleKey: 'nav.financeSection',
      title: hasPermission('finance.view') ? 'المالية والحسابات' : 'المدفوعات والتحصيل',
      items: [
        { textKey: 'nav.payments', text: 'المدفوعات', icon: <PaymentIcon />, path: '/payments', permission: 'payments.view' },
        { textKey: 'nav.finance', text: 'الخزينة والمالية', icon: <WalletIcon />, path: '/finance', permission: 'finance.view' }
      ]
    },
    {
      titleKey: 'nav.inventorySection',
      title: 'المخزون',
      items: [
        { textKey: 'nav.inventory', text: 'المخزون وواردات الكتب', icon: <InventoryIcon />, path: '/inventory', permission: 'inventory.view' }
      ]
    },
    {
      titleKey: 'nav.shippingSection',
      title: 'الشحن',
      items: [
        { textKey: 'nav.shipments', text: 'الشحنات', icon: <LocalShippingIcon />, path: '/shipments', permission: 'shipments.view' }
      ]
    },
    {
      titleKey: 'nav.reportsSection',
      title: 'التقارير والتصدير',
      items: [
        { textKey: 'nav.reports', text: 'التقارير', icon: <AssessmentIcon />, path: '/reports', permission: 'reports.view' },
        { textKey: 'nav.exports', text: 'تصدير البيانات', icon: <CloudDownloadIcon />, path: '/exports', permission: 'exports.run' }
      ]
    },
    {
      titleKey: 'nav.managementSection',
      title: 'الإدارة',
      items: [
        { textKey: 'nav.users', text: 'المستخدمين والأدوار', icon: <PeopleIcon />, path: '/users', permission: 'users.view' },
        { textKey: 'nav.backups', text: 'النسخ الاحتياطي والاستعادة', icon: <SettingsBackupRestoreIcon />, path: '/backups', anyPermissions: ['backup.view', 'backup.create'] },
        { textKey: 'nav.audit', text: 'سجل العمليات', icon: <HistoryIcon />, path: '/audit', permission: 'audit.view' }
      ]
    }
  ];

  const activeSectionKey = menuSections.find(section =>
    section.items.some(item => item.path === location.pathname)
  )?.titleKey;

  useEffect(() => {
    if (!activeSectionKey) return;

    updateCollapsedSections(previous => {
      if (!previous[activeSectionKey]) return previous;
      return { ...previous, [activeSectionKey]: false };
    });
  }, [activeSectionKey, updateCollapsedSections]);

  // ── Render Menu Items ──
  const renderMenuItems = (isMobileLayout = false) => {
    const isCollapsedView = !isMobileLayout && collapsed;

    return menuSections.map((section) => {
      const visibleItems = section.items.filter(
        item =>
          (!item.permission || hasPermission(item.permission)) &&
          (!item.anyPermissions || item.anyPermissions.some(hasPermission)) &&
          !(item.hideForRestrictedInvoiceRole && isInvoiceVisibilityRestricted)
      );
      if (visibleItems.length === 0) return null;

      const isSectionCollapsed = !isCollapsedView && Boolean(collapsedSections[section.titleKey]);
      const sectionId = `sidebar-${isMobileLayout ? 'mobile' : 'desktop'}-${section.titleKey.replace(/[^a-zA-Z0-9_-]/g, '-')}`;

      return (
        <List
          key={section.titleKey}
          disablePadding
          className="sidebar-menu-list"
          subheader={
            !isCollapsedView && (
              <ListSubheader component="div" disableSticky className="sidebar-subheader sidebar-section-header">
                <Box
                  component="button"
                  type="button"
                  className="sidebar-section-toggle"
                  onClick={() => toggleSection(section.titleKey)}
                  aria-expanded={!isSectionCollapsed}
                  aria-controls={sectionId}
                  aria-label={`${t(isSectionCollapsed ? 'nav.expandSection' : 'nav.collapseSection')} ${t(section.titleKey)}`}
                >
                  <Box component="span">{t(section.titleKey)}</Box>
                  <ExpandMoreIcon
                    className={`sidebar-section-arrow ${isSectionCollapsed ? '' : 'sidebar-section-arrow--expanded'}`}
                  />
                </Box>
              </ListSubheader>
            )
          }
        >
          {isCollapsedView && <Divider className="sidebar-divider" />}

          <Collapse in={isCollapsedView || !isSectionCollapsed} timeout="auto" unmountOnExit={!isCollapsedView}>
            <Box id={sectionId}>
              {visibleItems.map((item) => {
                const isSelected = location.pathname === item.path;

                const buttonContent = (
                  <ListItemButton
                    onClick={() => {
                      navigate(item.path);
                      if (isMobileLayout) setMobileOpen(false);
                    }}
                    selected={isSelected}
                    className={`sidebar-item-btn ${isCollapsedView ? 'sidebar-item-btn--collapsed' : 'sidebar-item-btn--expanded'}`}
                  >
                    <ListItemIcon className="sidebar-item-icon">
                      {item.icon}
                    </ListItemIcon>
                    {!isCollapsedView && (
                      <ListItemText
                        primary={t(item.textKey)}
                        primaryTypographyProps={{
                          fontSize: '0.875rem',
                          fontWeight: isSelected ? 600 : 400,
                        }}
                      />
                    )}
                  </ListItemButton>
                );

                return (
                  <ListItem key={item.textKey} disablePadding className="sidebar-list-item">
                    {isCollapsedView ? (
                      <Tooltip title={t(item.textKey)} placement="left">
                        {buttonContent}
                      </Tooltip>
                    ) : (
                      buttonContent
                    )}
                  </ListItem>
                );
              })}
            </Box>
          </Collapse>
        </List>
      );
    });
  };

  // ── Drawer Content ──
  const drawerContent = (isMobileLayout = false) => {
    const isCollapsedView = !isMobileLayout && collapsed;

    return (
      <Box className="main-layout__drawer-container">
        {/* ── Sidebar Header ── */}
        <Box
          className={`sidebar-header ${isCollapsedView ? 'sidebar-header--collapsed' : 'sidebar-header--expanded'}`}
        >
          <Box className="sidebar-logo-box" sx={{ overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 0.5 }}>
            <img src={logoImg} alt="Logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          </Box>
          {!isCollapsedView && (
            <Box className="sidebar-brand-container">
              <Typography
                variant="subtitle1"
                noWrap
                className="sidebar-brand-title"
              >
                {t('app.title')}
              </Typography>
              <Typography
                variant="caption"
                noWrap
                className="sidebar-brand-subtitle"
              >
                {t('app.subtitle')}
              </Typography>
            </Box>
          )}
        </Box>

        <Divider />

        {/* ── Profile Card ── */}
        {isCollapsedView ? (
          <ListItem key="profile" disablePadding className="sidebar-list-item sidebar-profile-item">
            <Tooltip title={user?.fullName || user?.username || 'الملف الشخصي'} placement="left">
              <ListItemButton
                onClick={() => {
                  navigate('/profile');
                  if (isMobileLayout) setMobileOpen(false);
                }}
                selected={location.pathname === '/profile'}
                className={`sidebar-item-btn sidebar-item-btn--collapsed sidebar-profile-btn ${location.pathname === '/profile' ? 'Mui-selected' : ''}`}
              >
                <ListItemIcon className="sidebar-item-icon sidebar-profile-icon-wrap">
                  <Avatar className="sidebar-profile-avatar-collapsed">
                    {user?.fullName?.charAt(0) || user?.username?.charAt(0) || 'U'}
                  </Avatar>
                </ListItemIcon>
              </ListItemButton>
            </Tooltip>
          </ListItem>
        ) : (
          <ListItem key="profile" disablePadding className="sidebar-list-item sidebar-profile-item">
            <ListItemButton
              onClick={() => {
                navigate('/profile');
                if (isMobileLayout) setMobileOpen(false);
              }}
              selected={location.pathname === '/profile'}
              className={`sidebar-item-btn sidebar-item-btn--expanded sidebar-profile-btn ${location.pathname === '/profile' ? 'Mui-selected' : ''}`}
            >
              <ListItemIcon className="sidebar-item-icon sidebar-profile-icon-wrap-expanded">
                <Avatar className="sidebar-profile-avatar-expanded">
                  {user?.fullName?.charAt(0) || user?.username?.charAt(0) || 'U'}
                </Avatar>
              </ListItemIcon>
              <Box className="profile-card__info profile-card__info-box">
                <Typography variant="body2" noWrap className="profile-card__name profile-card__name-text">
                  {user?.fullName || user?.username}
                </Typography>
                <Typography variant="caption" noWrap className="profile-card__role profile-card__role-text">
                  {user?.roles?.join(' • ') || t('common.user')}
                </Typography>
              </Box>
            </ListItemButton>
          </ListItem>
        )}

        {/* ── Menu Items ── */}
        <Box className="sidebar-menu-wrapper">
          {renderMenuItems(isMobileLayout)}
        </Box>

        {/* ── Collapse Toggle (desktop only) ── */}
        {!isMobileLayout && (
          <>
            <Divider />
            <Box className="sidebar-toggle-container">
              <Tooltip title={collapsed ? t('nav.expandMenu') : t('nav.collapseMenu')} placement="left">
                <IconButton
                  onClick={toggleSidebar}
                  size="small"
                  className="main-layout__icon-btn"
                >
                  <MenuOpenIcon
                    className={`sidebar-toggle-icon ${collapsed ? 'sidebar-toggle-icon--collapsed' : 'sidebar-toggle-icon--expanded'}`}
                  />
                </IconButton>
              </Tooltip>
            </Box>
          </>
        )}
      </Box>
    );
  };

  return (
    <Box className="main-layout">
      <CssBaseline />

      {/* ══════ Top AppBar ══════ */}
      <AppBar
        position="fixed"
        elevation={0}
        className={`main-layout__appbar ${collapsed ? 'main-layout__appbar--collapsed' : 'main-layout__appbar--expanded'}`}
      >
        <Toolbar className="main-layout__toolbar">
          {/* Mobile hamburger menu */}
          <IconButton
            color="inherit"
            aria-label={t('nav.openMenu')}
            edge="start"
            onClick={handleDrawerToggle}
            sx={{ display: { md: 'none' } }}
          >
            <MenuIcon />
          </IconButton>

          {/* Page Title */}
          <Typography
            variant="h6"
            noWrap
            component="h1"
            className="main-layout__title"
          >
            {getPageTitle()}
          </Typography>

          {/* ── TopBar Actions ── */}

          {/* Theme Toggle */}
          <Tooltip title={mode === 'dark' ? t('nav.lightMode') : t('nav.darkMode')}>
            <IconButton
              onClick={toggleColorMode}
              className="main-layout__icon-btn"
            >
              {mode === 'dark' ? <LightModeIcon /> : <DarkModeIcon />}
            </IconButton>
          </Tooltip>

          {/* Notifications Bell */}
          {hasPermission('notifications.view') && (
            <Tooltip title={t('nav.notifications')}>
              <IconButton
                onClick={handleNotifyClick}
                className="main-layout__icon-btn"
                aria-controls={openNotify ? 'notifications-menu' : undefined}
                aria-haspopup="true"
              >
                <Badge
                  badgeContent={unreadCount}
                  color="error"
                  className="main-layout__badge"
                >
                  <NotificationsIcon />
                </Badge>
              </IconButton>
            </Tooltip>
          )}

          {/* Account Avatar */}
          <Tooltip title={t('auth.accountOptions')}>
            <IconButton
              onClick={handleMenuClick}
              size="small"
              aria-controls={openMenu ? 'account-menu' : undefined}
              aria-haspopup="true"
            >
              <Avatar className="main-layout__avatar">
                {user?.fullName?.charAt(0) || user?.username?.charAt(0) || 'U'}
              </Avatar>
            </IconButton>
          </Tooltip>

          {/* ── Account Menu ── */}
          <Menu
            anchorEl={anchorEl}
            id="account-menu"
            open={openMenu}
            onClose={handleMenuClose}
            onClick={handleMenuClose}
            slotProps={{
              paper: {
                elevation: 4,
                className: "account-menu-paper"
              },
            }}
            transformOrigin={{ horizontal: 'left', vertical: 'top' }}
            anchorOrigin={{ horizontal: 'left', vertical: 'bottom' }}
          >
            <Box className="user-menu-header">
              <Typography variant="subtitle2" className="user-menu-header__name">
                {user?.fullName || user?.username}
              </Typography>
              <Typography variant="caption" className="user-menu-header__role">
                {user?.roles?.join(' • ')}
              </Typography>
            </Box>
            <Divider />
            <MenuItem onClick={() => navigate('/profile')} className="user-menu-item">
              <PersonIcon fontSize="small" className="main-layout__icon-btn" />
              {t('nav.profile')}
            </MenuItem>
            {hasPermission('notifications.view') && (
              <MenuItem onClick={() => navigate('/notifications')} className="user-menu-item">
                <NotificationsIcon fontSize="small" className="main-layout__icon-btn" />
                {t('nav.notifications')}
                {unreadCount > 0 && (
                  <Chip label={unreadCount} size="small" color="error" className="user-menu-chip" />
                )}
              </MenuItem>
            )}
            <Divider />
            <MenuItem onClick={handleLogout} className="user-menu-item user-menu-item--logout">
              <ExitToAppIcon fontSize="small" />
              {t('nav.logout')}
            </MenuItem>
          </Menu>

          {/* ── Notifications Dropdown ── */}
          {hasPermission('notifications.view') && <Menu
            anchorEl={notifyAnchorEl}
            id="notifications-menu"
            open={openNotify}
            onClose={handleNotifyClose}
            slotProps={{
              paper: {
                elevation: 4,
                className: "notify-menu-paper"
              },
            }}
            transformOrigin={{ horizontal: 'left', vertical: 'top' }}
            anchorOrigin={{ horizontal: 'left', vertical: 'bottom' }}
          >
            <Box className="notify-header">
              <Typography variant="subtitle2" className="notify-header__title">
                {t('nav.notifications')}
              </Typography>
              {unreadCount > 0 && (
                <Chip label={`${unreadCount} ${t('common.new')}`} size="small" color="error" className="notify-chip" />
              )}
            </Box>
            <Divider />
            {notifications.length === 0 ? (
              <Box className="notify-empty">
                <NotificationsIcon className="notify-empty__icon" />
                <Typography variant="body2" className="notify-empty__text">
                  {t('notifications.noNotifications')}
                </Typography>
              </Box>
            ) : (
              notifications.map((n) => (
                <Box key={n.id}>
                  <Box
                    className={`notification-item ${n.status === 'unread' ? 'notification-item--unread' : ''}`}
                    onClick={() => {
                      if (n.action_url) {
                        navigate(n.action_url);
                        handleNotifyClose();
                      }
                    }}
                  >
                    <Box className="notification-item__icon">
                      {getSeverityIcon(n.severity)}
                    </Box>
                    <Box className="notification-item__content">
                      <Typography variant="body2" noWrap className="notification-item__title">
                        {n.title}
                      </Typography>
                      <Typography variant="caption" className="notification-item__message">
                        {n.message}
                      </Typography>
                      <Typography variant="caption" className="notification-item__time">
                        {formatEgyptDateTime(n.created_at)}
                      </Typography>

                      <Box className="notification-item__actions" onClick={(e) => e.stopPropagation()}>
                        {hasPermission('notifications.manage') && n.status === 'unread' && (
                          <Button
                            size="small"
                            variant="text"
                            onClick={(e) => handleMarkAsRead(n.id, e)}
                            className="notification-item__action"
                          >
                            {t('notifications.markAsRead')}
                          </Button>
                        )}
                        {hasPermission('notifications.manage') && n.status !== 'resolved' && (
                          <Button
                            size="small"
                            variant="text"
                            color="success"
                            onClick={(e) => handleResolve(n.id, e)}
                            className="notification-item__action"
                          >
                            {t('notifications.resolve')}
                          </Button>
                        )}
                      </Box>
                    </Box>
                  </Box>
                  <Divider />
                </Box>
              ))
            )}
            <Box className="notify-footer">
              <Button
                size="small"
                fullWidth
                onClick={() => { navigate('/notifications'); handleNotifyClose(); }}
                className="notify-footer__button"
              >
                {t('notifications.viewAll')}
              </Button>
            </Box>
          </Menu>}
        </Toolbar>
      </AppBar>

      {/* ══════ Sidebar Drawer ══════ */}
      <Box
        component="nav"
        className={`main-layout__sidebar-nav ${collapsed ? 'main-layout__sidebar-nav--collapsed' : 'main-layout__sidebar-nav--expanded'}`}
      >
        {/* Mobile Drawer */}
        <Drawer
          variant="temporary"
          anchor={muiTheme.direction === 'rtl' ? 'left' : 'right'}
          open={mobileOpen}
          onClose={handleDrawerToggle}
          ModalProps={{ keepMounted: true }}
          slotProps={{ paper: { className: 'main-layout__mobile-drawer-paper' } }}
          className="main-layout__mobile-drawer"
        >
          {drawerContent(true)}
        </Drawer>

        {/* Desktop Drawer */}
        <Drawer
          variant="permanent"
          anchor={muiTheme.direction === 'rtl' ? 'left' : 'right'}
          slotProps={{
            paper: {
              className: `main-layout__desktop-drawer-paper ${collapsed ? 'main-layout__desktop-drawer-paper--collapsed' : 'main-layout__desktop-drawer-paper--expanded'}`
            }
          }}
          className="main-layout__desktop-drawer"
          open
        >
          {drawerContent(false)}
        </Drawer>
      </Box>

      {/* ══════ Main Content ══════ */}
      <Box
        component="main"
        className={`main-layout__content-wrapper ${collapsed ? 'main-layout__content-wrapper--collapsed' : 'main-layout__content-wrapper--expanded'}`}
      >
        <Toolbar /> {/* Spacer for AppBar */}
        <Box className="main-layout__content">
          <Breadcrumbs />
          <Outlet />
        </Box>
        <Box component="footer" className="main-layout__footer">
          <Box className="footer-left">
            <img 
              src={mode === 'dark' ? codzHubSparkDark : codzHubSparkLight} 
              alt="CodzHub Spark" 
              className="footer-logo-spark" 
            />
            <img 
              src={mode === 'dark' ? codzHubWordmarkDark : codzHubWordmarkLight} 
              alt="CodzHub Wordmark" 
              className="footer-logo-wordmark" 
            />
          </Box>
          <Box className="footer-right">
            <Typography variant="caption" className="footer-copyright">
              © {new Date().getFullYear()} CodzHub. All rights reserved.
            </Typography>
            <Typography variant="caption" className="footer-developer">
              Developed by{' '}
              <a 
                href="https://wa.me/201020572730" 
                target="_blank" 
                rel="noopener noreferrer"
                className="footer-developer-link"
              >
                Ziad Elsayed
              </a>
            </Typography>
          </Box>
        </Box>
      </Box>
    </Box>
  );
};

export default MainLayout;
