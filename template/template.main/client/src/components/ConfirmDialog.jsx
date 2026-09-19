import React from 'react';
import { Dialog, DialogContent, DialogActions, Button, Typography, Box } from '@mui/material';

export const ConfirmDialog = ({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'تأكيد',
  cancelText = 'إلغاء',
  severity = 'primary'
}) => {
  const getButtonColor = () => {
    if (severity === 'error') return 'error';
    if (severity === 'warning') return 'warning';
    if (severity === 'success') return 'success';
    return 'secondary';
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      classes={{
        paper: 'confirm-dialog'
      }}
    >
      <Box className="confirm-dialog__header">
        <Typography variant="h6" className="confirm-dialog__title" component="h3">
          {title}
        </Typography>
      </Box>
      <DialogContent className="confirm-dialog__content">
        <Typography variant="body2">
          {message}
        </Typography>
      </DialogContent>
      <DialogActions className="confirm-dialog__actions">
        <Button onClick={onClose} variant="outlined" color="inherit">
          {cancelText}
        </Button>
        <Button onClick={onConfirm} variant="contained" color={getButtonColor()} autoFocus>
          {confirmText}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ConfirmDialog;
