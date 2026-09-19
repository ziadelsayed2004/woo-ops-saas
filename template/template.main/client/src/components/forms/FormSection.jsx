import React from 'react';
import { Box, Typography } from '@mui/material';

export const FormSection = ({ title, description, children, className = '' }) => {
  return (
    <Box className={`form-section ${className}`}>
      {title && (
        <Typography variant="h6" className="form-section__title" component="h3">
          {title}
        </Typography>
      )}
      {description && (
        <Typography variant="body2" className="form-section__description">
          {description}
        </Typography>
      )}
      {children}
    </Box>
  );
};

export default FormSection;
