import React from 'react';
import { Box } from '@mui/material';

export const FormActions = ({ children, className = '' }) => {
  return (
    <Box className={`form-actions ${className}`}>
      {children}
    </Box>
  );
};

export default FormActions;
