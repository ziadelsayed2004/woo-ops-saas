import React from 'react';
import { Box } from '@mui/material';

export const FieldGrid = ({ columns = 2, children, className = '' }) => {
  let gridClass = 'form-grid';
  if (columns === 3) {
    gridClass = 'form-grid--three';
  } else if (columns === 1) {
    gridClass = 'form-grid--one';
  }
  return (
    <Box className={`${gridClass} ${className}`}>
      {children}
    </Box>
  );
};

export default FieldGrid;
