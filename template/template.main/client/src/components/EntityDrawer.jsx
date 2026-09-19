import React from 'react';
import { Drawer, Box, Typography, IconButton, LinearProgress, Alert } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import './EntityDrawer.css';

export const EntityDrawer = ({
  open,
  onClose,
  title,
  subtitle,
  size = 'medium', // 'small', 'medium', 'large'
  loading = false,
  error = null,
  actions = null,
  children,
  className = ''
}) => {
  return (
    <Drawer
      anchor="left" // Opens on the left in RTL to slide into viewport cleanly
      open={open}
      onClose={onClose}
      slotProps={{
        paper: {
          className: `entity-drawer-paper entity-drawer-paper--${size} ${className}`
        }
      }}
    >
      {/* Header */}
      <Box className="entity-drawer__header">
        <Box className="entity-drawer__header-text">
          <Typography variant="h6" className="entity-drawer__title">
            {title}
          </Typography>
          {subtitle && (
            <Typography variant="caption" className="entity-drawer__subtitle">
              {subtitle}
            </Typography>
          )}
        </Box>
        <IconButton onClick={onClose} size="small" className="entity-drawer__close-btn">
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>

      {/* Loading bar */}
      {loading && <LinearProgress color="primary" sx={{ height: 3 }} />}

      {/* Content wrapper */}
      <Box className="entity-drawer__content">
        {error && (
          <Alert severity="error" sx={{ mb: 3, borderRadius: 1.5 }}>
            {error}
          </Alert>
        )}
        {children}
      </Box>

      {/* Sticky footer actions */}
      {actions && (
        <Box className="entity-drawer__actions">
          {actions}
        </Box>
      )}
    </Drawer>
  );
};

export default EntityDrawer;
