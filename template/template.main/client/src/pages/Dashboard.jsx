import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../app/AuthContext';
import { apiClient } from '../services/apiClient';
import { formatCurrencyEGP, formatEgyptDateTime } from '../utils/formatters';
import LoadingState from '../components/LoadingState';
import { t } from '../locales/t';
import {
  Box,
  Typography,
  Grid,
  Paper,
  Card,
  CardContent,
  Chip,
  List,
  ListItem,
  Divider,
  Alert,
  Button,
  LinearProgress,
  Stack,
  IconButton,
  Tooltip
} from '@mui/material';
import {
  Store as StoreIcon,
  Book as BookIcon,
  Receipt as ReceiptIcon,
  TrendingUp as TrendingUpIcon,
  Payment as PaymentIcon,
  AccountBalanceWallet as WalletIcon,
  AddShoppingCart as AddInvoiceIcon,
  AddBox as AddProductIcon,
  MoveToInbox as AddStockIcon,
  AddCircle as AddCircleIcon,
  PersonAdd as AddUserIcon,
  History as HistoryIcon,
  NotificationImportant as AlertIcon,
  CheckCircle as CheckCircleIcon,
  LocalShipping as ShippingIcon,
  AccessTime as AccessTimeIcon,
  Launch as LaunchIcon,
  Check as ResolveIcon,
  Category as CategoryIcon
} from '@mui/icons-material';
import '../styles/Dashboard.css';

export const Dashboard = () => {
  const { user, hasPermission } = useAuth();
  const navigate = useNavigate();

  // Core Data States
  const [financials, setFinancials] = useState(null);
  const [financeSummary, setFinanceSummary] = useState(null);
  const [stock, setStock] = useState([]);
  const [activeAlerts, setActiveAlerts] = useState([]);
  const [outlets, setOutlets] = useState([]);
  const [recentInvoices, setRecentInvoices] = useState([]);
  const [recentPayments, setRecentPayments] = useState([]);
  const [recentTransactions, setRecentTransactions] = useState([]);
  const [shipments, setShipments] = useState([]);
  const [recentReturns, setRecentReturns] = useState([]);

  const [loading, setLoading] = useState(true);
  const [cairoTime, setCairoTime] = useState('');

  const fetchActiveAlerts = async () => {
    const data = await apiClient.get('/notifications?status=unread&severities=critical,warning&limit=5');
    setActiveAlerts(data || []);
  };

  // Localized Cairo Dynamic Clock
  useEffect(() => {
    const updateTime = () => {
      setCairoTime(new Intl.DateTimeFormat('ar-EG', {
        timeZone: 'Africa/Cairo',
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
        numberingSystem: 'latn'
      }).format(new Date()));
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Fetch Dashboard Data
  useEffect(() => {
    const loadDashboardData = async () => {
      setLoading(true);
      const promises = [];

      if (hasPermission('finance.view')) {
        promises.push(
          apiClient.get('/finance/summary')
            .then(data => setFinanceSummary(data))
            .catch(err => console.error('Finance summary fetch error:', err))
        );
      } else {
        setFinanceSummary(null);
        setFinancials(null);
      }

      if (hasPermission('finance.view') && hasPermission('reports.view')) {
        promises.push(
          apiClient.get('/reports/financials/summary')
            .then(data => setFinancials(data))
            .catch(err => console.error('Financials summary fetch error:', err))
        );
      }

      if (hasPermission('reports.view')) {
        promises.push(
          apiClient.get('/reports/stock')
            .then(data => setStock((data || []).map((item) => ({
              ...item,
              currentStock: item.currentStock ?? item.stock ?? 0,
              stockPolicy: item.stockPolicy ?? item.stock_policy
            }))))
            .catch(err => console.error('Stock report fetch error:', err))
        );
      } else if (hasPermission('inventory.view')) {
        promises.push(
          apiClient.get('/inventory/stock-summary?limit=500')
            .then(data => setStock((data || []).map((item) => ({
              ...item,
              currentStock: item.currentStock ?? item.stock ?? 0,
              stockPolicy: item.stockPolicy ?? item.stock_policy
            }))))
            .catch(err => console.error('Stock summary fetch error:', err))
        );
      }

      if (hasPermission('notifications.view')) {
        promises.push(
          fetchActiveAlerts()
            .catch(err => console.error('Active notifications fetch error:', err))
        );
      }

      if (hasPermission('outlets.view')) {
        promises.push(
          apiClient.get('/outlets')
            .then(data => setOutlets(data || []))
            .catch(err => console.error('Outlets fetch error:', err))
        );
      }

      if (hasPermission('invoices.view')) {
        promises.push(
          apiClient.get('/invoices?limit=5')
            .then(data => setRecentInvoices(data || []))
            .catch(err => console.error('Recent invoices fetch error:', err))
        );
      }

      if (hasPermission('returns.view')) {
        promises.push(
          apiClient.get('/returns?limit=5')
            .then(data => setRecentReturns(data || []))
            .catch(err => console.error('Recent returns fetch error:', err))
        );
      }

      if (hasPermission('payments.view')) {
        promises.push(
          apiClient.get('/payments?limit=5')
            .then(data => setRecentPayments(data || []))
            .catch(err => console.error('Recent payments fetch error:', err))
        );
      }

      if (hasPermission('inventory.view')) {
        promises.push(
          apiClient.get('/inventory/transactions?limit=5')
            .then(data => setRecentTransactions(data || []))
            .catch(err => console.error('Recent transactions fetch error:', err))
        );
      }

      if (hasPermission('shipments.view')) {
        promises.push(
          apiClient.get('/shipments')
            .then(data => setShipments(data || []))
            .catch(err => console.error('Shipments fetch error:', err))
        );
      }

      await Promise.all(promises);
      setLoading(false);
    };

    loadDashboardData();
  }, [user?.id]);

  const handleResolveAlert = async (id) => {
    if (!hasPermission('notifications.manage')) return;
    try {
      await apiClient.patch(`/notifications/${id}/resolve`);
      await fetchActiveAlerts();
    } catch (err) {
      console.error('Error resolving notification on dashboard:', err);
    }
  };

  if (loading) {
    return <LoadingState message={t('common.loading')} />;
  }

  // Calculated Metrics & Counts
  const totalSales = financeSummary ? financeSummary.totalInvoices : (financials ? financials.totalSales : 0);
  const totalPaid = financeSummary ? financeSummary.totalCollected : (financials ? financials.totalPaid : 0);
  const totalRemaining = financeSummary ? financeSummary.totalReceivables : (financials ? financials.totalRemaining : 0);
  const totalOverdue = financeSummary ? financeSummary.totalOverdue : 0;

  const isDatabaseFresh = stock.length === 0 && (!financeSummary || financeSummary.totalInvoices === 0) && (!financials || financials.totalSales === 0);

  // Date calculation
  const todayStr = new Date().toISOString().split('T')[0];
  const invoicesTodayCount = recentInvoices.filter(inv => {
    const invDateStr = inv.invoice_date || inv.created_at || '';
    return invDateStr.startsWith(todayStr);
  }).length;

  const salesTodayVal = recentInvoices
    .filter(inv => {
      const invDateStr = inv.invoice_date || inv.created_at || '';
      return invDateStr.startsWith(todayStr);
    })
    .reduce((sum, inv) => sum + (inv.total_price || 0), 0);

  const activeBooksCount = stock.length;
  const activeOutletsCount = outlets.filter(o => o.status === 'active').length;
  const collectionRate = totalSales > 0 ? (totalPaid / totalSales) * 100 : 0;

  // Exceeded limits outlets count
  const exceededLimitsCount = outlets.filter(o => o.credit_limit > 0 && o.balance > o.credit_limit).length;

  // Stock Snapshot calculations
  const lowStockItemsCount = stock.filter(item => item.currentStock <= 10 && item.stockPolicy !== 'ignore').length;
  const negativeStockItemsCount = stock.filter(item => item.currentStock < 0 && item.stockPolicy !== 'ignore').length;
  const receiptsTodayCount = recentTransactions.filter(tx => {
    const txDateStr = tx.created_at || '';
    return tx.transaction_type === 'receipt' && txDateStr.startsWith(todayStr);
  }).length;

  // 8 Core Command Center metrics
  const pendingMetric = financeSummary ? (financeSummary.pending || 0) : totalRemaining;
  const collectedMetric = financeSummary ? (financeSummary.collected || 0) : totalPaid;
  const suppliedMetric = financeSummary ? (financeSummary.supplied || 0) : 0;
  const unsuppliedMetric = financeSummary ? (financeSummary.unsupplied || 0) : 0;
  const returnsMetric = financeSummary ? (financeSummary.returns || 0) : 0;
  const invoicesCountVal = financeSummary ? (financeSummary.totalInvoicesCount || 0) : recentInvoices.length;
  const invoicesAmountVal = totalSales;
  const partialShipmentsVal = financeSummary ? (financeSummary.partialShipmentsCount || 0) : shipments.filter(s => s.status === 'pending').length;
  const stockAlertsVal = financeSummary ? (financeSummary.stockAlertsCount || 0) : (lowStockItemsCount + negativeStockItemsCount);
  const unreviewedCountVal = financeSummary ? (financeSummary.unreviewedCount || 0) : 0;
  const unreviewedAmountVal = financeSummary ? (financeSummary.unreviewedReceipts || 0) : 0;

  return (
    <Box className="dashboard-container">
      {/* 1. Welcome Hero Header */}
      <Paper className="dashboard-hero">
        <Grid container spacing={3} alignItems="center">
          <Grid item xs={12} md={7}>
            <Typography variant="h5" className="dashboard-hero__title">
              {t('dashboard.welcome', { name: user?.fullName || user?.username || t('common.user') })}
            </Typography>
            <Typography variant="body2" className="dashboard-hero__subtitle">
              <AccessTimeIcon sx={{ fontSize: 16 }} />
              {cairoTime || t('dashboard.cairoTimeLoading')}
            </Typography>
          </Grid>
          <Grid item xs={12} md={5} sx={{ display: 'flex', justifyContent: { xs: 'flex-start', md: 'flex-end' }, gap: 1 }}>
            {user?.roles?.map(r => (
              <Chip key={r} label={r === 'super_admin' ? t('dashboard.superAdminRole') : r} color="secondary" className="dashboard-hero__role-chip" />
            ))}
          </Grid>
        </Grid>
      </Paper>

      {/* 2. Onboarding Wizard for Fresh Database Reset */}
      {isDatabaseFresh && (
        hasPermission('outlet_types.create') ||
        hasPermission('products.create') ||
        hasPermission('inventory.receipts.create')
      ) && (
        <Paper className="onboarding-wizard">
          <Typography variant="h6" className="onboarding-wizard__title">
            <CheckCircleIcon color="success" /> {t('dashboard.systemInitReady')}
          </Typography>
          <Typography variant="body2" sx={{ opacity: 0.9 }}>
            {t('dashboard.systemInitDesc')}
          </Typography>
          <Box className="onboarding-wizard__steps-grid">
            {hasPermission('outlet_types.create') && <Box className="onboarding-card" onClick={() => navigate('/outlet-types')}>
              <Typography variant="subtitle2" className="onboarding-card__step-title">
                {t('dashboard.initStep1Title')}
              </Typography>
              <Typography variant="caption" className="onboarding-card__step-description">
                {t('dashboard.initStep1Desc')}
              </Typography>
            </Box>}
            {hasPermission('products.create') && <Box className="onboarding-card" onClick={() => navigate('/products')}>
              <Typography variant="subtitle2" className="onboarding-card__step-title">
                {t('dashboard.initStep2Title')}
              </Typography>
              <Typography variant="caption" className="onboarding-card__step-description">
                {t('dashboard.initStep2Desc')}
              </Typography>
            </Box>}
            {hasPermission('inventory.receipts.create') && <Box className="onboarding-card" onClick={() => navigate('/inventory')}>
              <Typography variant="subtitle2" className="onboarding-card__step-title">
                {t('dashboard.initStep3Title')}
              </Typography>
              <Typography variant="caption" className="onboarding-card__step-description">
                {t('dashboard.initStep3Desc')}
              </Typography>
            </Box>}
          </Box>
        </Paper>
      )}

      {/* 3. Urgent Alerts and Notifications */}
      {activeAlerts.length > 0 && (
        <Box sx={{ mb: 4 }}>
          <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 'bold', color: 'error.main', display: 'flex', alignItems: 'center', gap: 1 }}>
              <AlertIcon /> {t('dashboard.criticalAlertsTitle')}
            </Typography>
            <Button variant="outlined" size="small" onClick={() => navigate('/notifications')}>
              {t('notifications.viewAll')}
            </Button>
          </Box>
          {activeAlerts.map((alert) => (
            <Alert
              key={alert.id}
              severity={alert.severity === 'critical' ? 'error' : 'warning'}
              sx={{ mb: 2, borderRadius: '8px', '& .MuiAlert-message': { width: '100%' } }}
              action={
                <Stack direction="row" spacing={1}>
                  {alert.action_url && (
                    <Tooltip title={t('dashboard.preview')}>
                      <IconButton
                        color="inherit"
                        size="small"
                        onClick={() => {
                          const cleanUrl = alert.action_url
                            .replace(/^\/catalog\/products\/\d+/, '/inventory')
                            .replace(/^\/operations\/outlets\/\d+/, '/outlets')
                            .replace(/^\/finance\/invoices\/\d+/, '/invoices')
                            .replace(/^\/finance\/payments/, '/payments')
                            .replace(/^\/finance\/ledger/, '/finance')
                            .replace(/^\/operations\/shipments/, '/shipments');
                          navigate(cleanUrl);
                        }}
                      >
                        <LaunchIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                  {hasPermission('notifications.manage') && (
                    <Tooltip title={t('dashboard.dismiss')}>
                      <IconButton color="inherit" size="small" onClick={() => handleResolveAlert(alert.id)}>
                        <ResolveIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  )}
                </Stack>
              }
            >
              <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>{alert.title}</Typography>
              <Typography variant="body2" sx={{ opacity: 0.9 }}>{alert.message}</Typography>
            </Alert>
          ))}
        </Box>
      )}

      {/* 4. KPI Cards Strip (8-Card Grid) */}
      <Box className="kpi-grid">
        {[
          { title: t('dashboard.kpiPending'), value: formatCurrencyEGP(pendingMetric), sub: t('dashboard.kpiPendingSub'), icon: <WalletIcon />, theme: 'warning', permission: 'finance.view' },
          { title: t('dashboard.kpiCollected'), value: formatCurrencyEGP(collectedMetric), sub: t('dashboard.kpiCollectedSub'), icon: <PaymentIcon />, theme: 'success', permission: 'finance.view' },
          { title: t('dashboard.kpiSupplied'), value: formatCurrencyEGP(suppliedMetric), sub: t('dashboard.kpiSuppliedSub'), icon: <CheckCircleIcon />, theme: 'primary', permission: 'finance.view' },
          { title: t('dashboard.kpiUnsupplied'), value: formatCurrencyEGP(unsuppliedMetric), sub: t('dashboard.kpiUnsuppliedSub'), icon: <AccessTimeIcon />, theme: 'info', permission: 'finance.view' },
          { title: t('dashboard.kpiReturns'), value: formatCurrencyEGP(returnsMetric), sub: t('dashboard.kpiReturnsSub'), icon: <HistoryIcon />, theme: 'danger', permission: 'finance.view' },
          { title: t('dashboard.kpiSales'), value: formatCurrencyEGP(invoicesAmountVal), sub: t('dashboard.kpiSalesSub', { count: invoicesCountVal }), icon: <ReceiptIcon />, theme: 'primary', permission: 'finance.view' },
          { title: t('dashboard.kpiShipments'), value: t('dashboard.kpiShipmentsValue', { count: partialShipmentsVal }), sub: t('dashboard.kpiShipmentsSub'), icon: <ShippingIcon />, theme: 'warning', permission: 'shipments.view' },
          { title: t('dashboard.kpiStockAlerts'), value: t('dashboard.kpiStockAlertsValue', { count: stockAlertsVal }), sub: t('dashboard.kpiStockAlertsSub'), icon: <AlertIcon />, theme: 'danger', permission: 'inventory.view' }
        ].filter((card) => hasPermission(card.permission)).map((card, i) => (
          <Card className={`kpi-card kpi-card--${card.theme}`} key={i}>
            <CardContent className="kpi-card__body">
              <Box className={`kpi-card__icon-wrapper kpi-card__icon-wrapper--${card.theme}`}>
                {card.icon}
              </Box>
              <Box>
                <Typography className="kpi-card__title">
                  {card.title}
                </Typography>
                <Typography className="kpi-card__value">
                  {card.value}
                </Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5 }}>
                  {card.sub}
                </Typography>
              </Box>
            </CardContent>
          </Card>
        ))}
      </Box>

      {/* 5. Finance and Operations Status Overview */}
      <Box className="snapshots-grid">
        {/* Finance Overview Panel */}
        {hasPermission('finance.view') && <Paper className="snapshot-panel">
          <Typography variant="subtitle1" className="snapshot-panel__header">
            <TrendingUpIcon color="primary" /> {t('dashboard.financeSnapshotTitle')}
          </Typography>
          <Divider sx={{ mb: 3 }} />

          <Box className="snapshot-panel__progress-box">
            <Box className="snapshot-panel__progress-label">
              <Typography variant="body2" sx={{ fontWeight: 'bold' }}>{t('dashboard.collectionRate')}</Typography>
              <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
                {collectionRate.toFixed(1)}%
              </Typography>
            </Box>
            <LinearProgress variant="determinate" value={collectionRate} className="snapshot-panel__progress-bar" />
          </Box>

          <Box className="snapshot-panel__grid">
            <Box className="snapshot-panel__stat-box">
              <Typography className="snapshot-panel__stat-title">{t('dashboard.totalCreditSales')}</Typography>
              <Typography className="snapshot-panel__stat-value">
                {formatCurrencyEGP(totalSales)}
              </Typography>
            </Box>
            <Box className="snapshot-panel__stat-box">
              <Typography className="snapshot-panel__stat-title">{t('dashboard.unreviewedReceipts')}</Typography>
              <Typography className={`snapshot-panel__stat-value ${unreviewedCountVal > 0 ? 'snapshot-panel__stat-value--danger' : 'snapshot-panel__stat-value--success'}`}>
                {t('dashboard.unreviewedReceiptsCount', { count: unreviewedCountVal })}
              </Typography>
            </Box>
            <Box className="snapshot-panel__stat-box">
              <Typography className="snapshot-panel__stat-title">{t('dashboard.creditExceedances')}</Typography>
              <Typography className={`snapshot-panel__stat-value ${exceededLimitsCount > 0 ? 'snapshot-panel__stat-value--danger' : 'snapshot-panel__stat-value--success'}`}>
                {t('dashboard.creditExceedancesCount', { count: exceededLimitsCount })}
              </Typography>
            </Box>
            <Box className="snapshot-panel__stat-box">
              <Typography className="snapshot-panel__stat-title">{t('dashboard.outletCount')}</Typography>
              <Typography className="snapshot-panel__stat-value snapshot-panel__stat-value--warning">
                {t('dashboard.activeCount', { count: activeOutletsCount })}
              </Typography>
            </Box>
          </Box>
        </Paper>}

        {/* Inventory Operations Panel */}
        {(hasPermission('inventory.view') || hasPermission('shipments.view')) && <Paper className="snapshot-panel">
          <Typography variant="subtitle1" className="snapshot-panel__header">
            <StoreIcon color="primary" /> {t('dashboard.inventorySnapshotTitle')}
          </Typography>
          <Divider sx={{ mb: 3 }} />

          <Box className="snapshot-panel__grid" sx={{ height: '100%', alignContent: 'center' }}>
            {hasPermission('inventory.view') && <Box className="snapshot-panel__stat-box">
              <Typography className="snapshot-panel__stat-title">{t('dashboard.lowStock')}</Typography>
              <Typography className={`snapshot-panel__stat-value ${lowStockItemsCount > 0 ? 'snapshot-panel__stat-value--danger' : 'snapshot-panel__stat-value--success'}`}>
                {t('dashboard.lowStockCount', { count: lowStockItemsCount })}
              </Typography>
            </Box>}
            {hasPermission('inventory.view') && <Box className="snapshot-panel__stat-box">
              <Typography className="snapshot-panel__stat-title">{t('dashboard.negativeStock')}</Typography>
              <Typography className={`snapshot-panel__stat-value ${negativeStockItemsCount > 0 ? 'snapshot-panel__stat-value--danger' : 'snapshot-panel__stat-value--success'}`}>
                {t('dashboard.negativeStockCount', { count: negativeStockItemsCount })}
              </Typography>
            </Box>}
            {hasPermission('inventory.view') && <Box className="snapshot-panel__stat-box">
              <Typography className="snapshot-panel__stat-title">{t('dashboard.todayReceipts')}</Typography>
              <Typography className="snapshot-panel__stat-value snapshot-panel__stat-value--success">
                {t('dashboard.todayReceiptsCount', { count: receiptsTodayCount })}
              </Typography>
            </Box>}
            {hasPermission('shipments.view') && <Box className="snapshot-panel__stat-box">
              <Typography className="snapshot-panel__stat-title">{t('dashboard.pendingShipments')}</Typography>
              <Typography className="snapshot-panel__stat-value snapshot-panel__stat-value--warning">
                {t('dashboard.pendingShipmentsCount', { count: shipments.filter(s => s.status === 'pending').length })}
              </Typography>
            </Box>}
          </Box>
        </Paper>}
      </Box>

      {/* 6. Quick Operations Grid */}
      <Typography variant="subtitle1" className="quick-actions-section-title">
        {t('dashboard.quickTasksTitle')}
      </Typography>
      <Box className="quick-actions-grid">
        {[
          { label: t('dashboard.newInvoice'), icon: <AddInvoiceIcon className="quick-action-btn__icon" />, path: '/invoices', perm: 'invoices.create' },
          { label: t('dashboard.addStock'), icon: <AddStockIcon className="quick-action-btn__icon" />, path: '/inventory', perm: 'inventory.receipts.create' },
          { label: t('dashboard.addOutlet'), icon: <StoreIcon className="quick-action-btn__icon" />, path: '/outlets', perm: 'outlets.create' },
          { label: t('dashboard.addProduct'), icon: <AddProductIcon className="quick-action-btn__icon" />, path: '/products', perm: 'products.create' },
          { label: t('dashboard.bookCategories'), icon: <CategoryIcon className="quick-action-btn__icon" />, path: '/categories', perm: 'categories.view' },
          { label: t('dashboard.outletTypes'), icon: <AddCircleIcon className="quick-action-btn__icon" />, path: '/outlet-types', perm: 'outlet_types.create' },
        ].map(act => {
          if (act.perm && !hasPermission(act.perm)) return null;
          return (
            <Button
              key={act.label}
              variant="outlined"
              onClick={() => navigate(act.path)}
              className="quick-action-btn"
            >
              {act.icon}
              <Typography className="quick-action-btn__label">
                {act.label}
              </Typography>
            </Button>
          );
        })}
      </Box>

      {/* 7. Live Activity Lists */}
      <Box className="activity-grid">
        {/* Latest Invoices */}
        {hasPermission('invoices.view') && (
        <Paper className="activity-panel">
          <Typography variant="subtitle2" className="activity-panel__header">
            <ReceiptIcon color="primary" /> {t('dashboard.recentInvoices')}
          </Typography>
          <Divider sx={{ mb: 2 }} />
          {recentInvoices.length > 0 ? (
            <List disablePadding>
              {recentInvoices.map((inv, idx) => (
                <React.Fragment key={inv.id}>
                  <ListItem className="activity-item">
                    <Box>
                      <Typography className="activity-item__primary-text">{inv.invoice_number}</Typography>
                      <Typography className="activity-item__secondary-text">{inv.outlet_name}</Typography>
                    </Box>
                    <Box className="activity-item__meta">
                      <Typography className="activity-item__amount">
                        {formatCurrencyEGP(inv.total_price)}
                      </Typography>
                      <Chip
                        label={
                          inv.payment_status === 'paid' ? t('dashboard.invoicePaid') :
                          inv.payment_status === 'partially_paid' ? t('dashboard.invoicePartiallyPaid') :
                          inv.payment_status === 'cancelled' ? t('dashboard.invoiceCancelled') :
                          t('dashboard.invoiceUnpaid')
                        }
                        size="small"
                        color={inv.payment_status === 'paid' ? 'success' : inv.payment_status === 'partially_paid' ? 'warning' : inv.payment_status === 'cancelled' ? 'default' : 'error'}
                        className="activity-item__chip"
                      />
                    </Box>
                  </ListItem>
                  {idx < recentInvoices.length - 1 && <Divider />}
                </React.Fragment>
              ))}
            </List>
          ) : (
            <Typography variant="body2" sx={{ color: 'text.secondary', py: 4, textAlign: 'center' }}>
              {t('dashboard.noInvoices')}
            </Typography>
          )}
        </Paper>
        )}

        {/* Latest Payments */}
        {hasPermission('payments.view') && (
        <Paper className="activity-panel">
          <Typography variant="subtitle2" className="activity-panel__header">
            <PaymentIcon color="primary" /> {t('dashboard.recentPayments')}
          </Typography>
          <Divider sx={{ mb: 2 }} />
          {recentPayments.length > 0 ? (
            <List disablePadding>
              {recentPayments.map((pay, idx) => (
                <React.Fragment key={pay.id}>
                  <ListItem className="activity-item">
                    <Box>
                      <Typography className="activity-item__primary-text">{formatCurrencyEGP(pay.amount)}</Typography>
                      <Typography className="activity-item__secondary-text">{t('dashboard.invoiceLabel', { num: pay.invoice_number })}</Typography>
                    </Box>
                    <Box className="activity-item__meta">
                      <Typography variant="caption" className="activity-item__secondary-text" sx={{ display: 'block' }}>
                        {
                          pay.payment_method === 'cash' ? t('dashboard.methodCash') :
                          pay.payment_method === 'bank_transfer' ? t('dashboard.methodTransfer') :
                          pay.payment_method === 'check' ? t('dashboard.methodCheck') :
                          t('dashboard.methodOther')
                        }
                      </Typography>
                      <Typography variant="caption" className="activity-item__secondary-text">
                        {new Date(pay.payment_date).toLocaleDateString('ar-EG')}
                      </Typography>
                    </Box>
                  </ListItem>
                  {idx < recentPayments.length - 1 && <Divider />}
                </React.Fragment>
              ))}
            </List>
          ) : (
            <Typography variant="body2" sx={{ color: 'text.secondary', py: 4, textAlign: 'center' }}>
              {t('dashboard.noPayments')}
            </Typography>
          )}
        </Paper>
        )}

        {/* Recent Stock Transactions */}
        {hasPermission('inventory.view') && (
        <Paper className="activity-panel">
          <Typography variant="subtitle2" className="activity-panel__header">
            <HistoryIcon color="primary" /> {t('dashboard.recentInventory')}
          </Typography>
          <Divider sx={{ mb: 2 }} />
          {recentTransactions.length > 0 ? (
            <List disablePadding>
              {recentTransactions.map((tx, idx) => (
                <React.Fragment key={tx.id}>
                  <ListItem className="activity-item">
                    <Box sx={{ minWidth: 0, flex: 1, pr: 1 }}>
                      <Typography noWrap className="activity-item__primary-text">{tx.product_title}</Typography>
                      <Typography className="activity-item__secondary-text">SKU: {tx.product_code}</Typography>
                    </Box>
                    <Box className="activity-item__meta">
                      <Chip
                        label={tx.quantity > 0 ? `+${tx.quantity}` : tx.quantity}
                        size="small"
                        color={tx.quantity > 0 ? 'success' : 'error'}
                        variant="outlined"
                        className="activity-item__chip"
                      />
                      <Typography variant="caption" className="activity-item__secondary-text" sx={{ display: 'block', mt: 0.5 }}>
                        {
                          tx.transaction_type === 'receipt' ? t('dashboard.typeReceipt') :
                          tx.transaction_type === 'sale' ? t('dashboard.typeSale') :
                          tx.transaction_type === 'return' ? t('dashboard.typeReturn') :
                          t('dashboard.typeAdjustment')
                        }
                      </Typography>
                    </Box>
                  </ListItem>
                  {idx < recentTransactions.length - 1 && <Divider />}
                </React.Fragment>
              ))}
            </List>
          ) : (
            <Typography variant="body2" sx={{ color: 'text.secondary', py: 4, textAlign: 'center' }}>
              {t('dashboard.noInventory')}
            </Typography>
          )}
        </Paper>
        )}

        {/* Latest Returns */}
        {hasPermission('returns.view') && (
        <Paper className="activity-panel">
          <Typography variant="subtitle2" className="activity-panel__header">
            <HistoryIcon color="primary" /> {t('dashboard.recentReturns')}
          </Typography>
          <Divider sx={{ mb: 2 }} />
          {recentReturns.length > 0 ? (
            <List disablePadding>
              {recentReturns.map((ret, idx) => (
                <React.Fragment key={ret.id}>
                  <ListItem
                    className="activity-item"
                    sx={{ cursor: 'pointer', '&:hover': { backgroundColor: 'action.hover' } }}
                    onClick={() => navigate(`/returns?search=${ret.return_number}`)}
                  >
                    <Box>
                      <Typography className="activity-item__primary-text">{ret.return_number}</Typography>
                      <Typography className="activity-item__secondary-text">{ret.outlet_name}</Typography>
                    </Box>
                    <Box className="activity-item__meta" sx={{ textAlign: 'left' }}>
                      <Typography className="activity-item__amount" sx={{ color: 'error.main' }}>
                        {formatCurrencyEGP(ret.return_value)}
                      </Typography>
                      <Typography variant="caption" className="activity-item__secondary-text" display="block">
                        {ret.created_at ? formatEgyptDateTime(ret.created_at).split(' ')[0] : ''}
                      </Typography>
                    </Box>
                  </ListItem>
                  {idx < recentReturns.length - 1 && <Divider />}
                </React.Fragment>
              ))}
            </List>
          ) : (
            <Typography variant="body2" sx={{ color: 'text.secondary', py: 4, textAlign: 'center' }}>
              {t('dashboard.noReturns')}
            </Typography>
          )}
        </Paper>
        )}
      </Box>
    </Box>
  );
};

export default Dashboard;
