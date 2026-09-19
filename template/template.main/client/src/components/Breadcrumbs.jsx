import React from 'react';
import { useLocation, Link as RouterLink } from 'react-router-dom';
import { Breadcrumbs as MuiBreadcrumbs, Link, Typography, Box } from '@mui/material';
import NavigateBeforeIcon from '@mui/icons-material/NavigateBefore';
import HomeIcon from '@mui/icons-material/Home';
import { t } from '../locales/t';
import './Breadcrumbs.css';

const getBreadcrumbLabel = (name) => {
  const routeNameMap = {
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
    'imports': t('nav.imports'),
    'exports': t('nav.exports'),
    'backups': t('nav.backups'),
    'audit': t('nav.audit'),
    'profile': t('nav.profile'),
    'notifications': t('nav.notifications')
  };
  return routeNameMap[name] || name;
};

export const Breadcrumbs = () => {
  const location = useLocation();
  const pathnames = location.pathname.split('/').filter((x) => x);

  // Don't show breadcrumbs on login page
  if (location.pathname === '/login') {
    return null;
  }

  return (
    <Box className="breadcrumbs-container">
      <MuiBreadcrumbs
        separator={<NavigateBeforeIcon fontSize="small" />}
        aria-label="breadcrumb"
        className="breadcrumbs-list"
      >
        <Link
          component={RouterLink}
          underline="hover"
          color="inherit"
          to="/"
          className="breadcrumbs-link"
        >
          <HomeIcon className="breadcrumbs-home-icon" />
          {t('nav.main')}
        </Link>
        {pathnames.map((name, index) => {
          const routeTo = `/${pathnames.slice(0, index + 1).join('/')}`;
          const isLast = index === pathnames.length - 1;
          const label = getBreadcrumbLabel(name);

          return isLast ? (
            <Typography key={name} className="breadcrumbs-current">
              {label}
            </Typography>
          ) : (
            <Link
              component={RouterLink}
              underline="hover"
              color="inherit"
              to={routeTo}
              key={name}
            >
              {label}
            </Link>
          );
        })}
      </MuiBreadcrumbs>
    </Box>
  );
};

export default Breadcrumbs;
