import React from 'react';
import { Box, CircularProgress, Typography, Skeleton } from '@mui/material';
import './LoadingState.css';

export const LoadingState = ({ type = 'spinner', message = 'جاري تحميل البيانات...', rows = 5 }) => {
  if (type === 'table') {
    return (
      <Box className="loading-state-table">
        <Skeleton variant="rectangular" height={50} className="loading-state-table__header" />
        {Array.from(new Array(rows)).map((_, index) => (
          <Skeleton key={index} variant="text" height={40} className="loading-state-table__row" />
        ))}
      </Box>
    );
  }

  if (type === 'skeleton') {
    return (
      <Box className="loading-state-skeleton">
        <Skeleton variant="text" className="loading-state-skeleton__title" />
        <Skeleton variant="circular" width={40} height={40} className="loading-state-skeleton__avatar" />
        <Skeleton variant="rectangular" height={150} className="loading-state-skeleton__box" />
      </Box>
    );
  }

  // Default spinner type
  return (
    <Box className="loading-state-spinner">
      <CircularProgress color="secondary" className="loading-state-spinner__progress" />
      <Typography variant="body1" className="loading-state-spinner__message">
        {message}
      </Typography>
    </Box>
  );
};

export default LoadingState;

