import React from 'react';
import { Box, Typography, Button, Paper } from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import './EmptyState.css';

export const EmptyState = ({
  title = 'لا توجد بيانات',
  description = 'لم نتمكن من العثور على أي سجلات مطابقة للبحث أو الفرز الحالي.',
  icon = <InfoOutlinedIcon className="empty-state__icon" />,
  actionLabel,
  onAction,
}) => {
  return (
    <Paper
      elevation={0}
      className="empty-state"
    >
      <Box className="empty-state__icon-container">{icon}</Box>
      <Typography variant="h6" className="empty-state__title">
        {title}
      </Typography>
      <Typography variant="body2" className="empty-state__description">
        {description}
      </Typography>
      {actionLabel && onAction && (
        <Button
          variant="contained"
          color="secondary"
          onClick={onAction}
          className="empty-state__action-btn"
        >
          {actionLabel}
        </Button>
      )}
    </Paper>
  );
};

export default EmptyState;

