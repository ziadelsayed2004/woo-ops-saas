import React, { useState } from 'react';
import { useAuth } from '../app/AuthContext';
import { apiClient } from '../services/apiClient';
import {
  Box,
  Typography,
  Paper,
  TextField,
  Button,
  Grid,
  Alert,
  Divider,
  CircularProgress,
  Chip,
  Avatar
} from '@mui/material';
import LockIcon from '@mui/icons-material/Lock';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';

import '../styles/Profile.css';

export const Profile = () => {
  const { user } = useAuth();
  
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!currentPassword || !newPassword || !confirmPassword) {
      setError('يرجى تعبئة كافة الحقول المطلوب');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('كلمة المرور الجديدة غير متطابقة مع التأكيد');
      return;
    }

    if (newPassword.length < 6) {
      setError('يجب ألا تقل كلمة المرور الجديدة عن ٦ خانات');
      return;
    }

    setLoading(true);
    try {
      await apiClient.post('/auth/change-password', {
        currentPassword,
        newPassword
      });
      setSuccess('تم تغيير كلمة المرور بنجاح.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      console.error(err);
      setError(err.message || 'فشل تغيير كلمة المرور. يرجى التحقق من المدخلات.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ mx: 'auto', mt: 0 }}>
      <Typography variant="h5" sx={{ fontWeight: 'bold', mb: 2, color: 'primary.main' }}>
        الملف الشخصي وإعدادات الحساب
      </Typography>

      <Paper className="profile-unified-card">
        {/* Profile Info Header */}
        <Box className="profile-card-header">
          <Avatar sx={{ width: 80, height: 80, bgcolor: 'primary.main', fontSize: 32 }}>
            {user?.fullName?.charAt(0) || user?.username?.charAt(0) || 'U'}
          </Avatar>
          <Box sx={{ flexGrow: 1 }}>
            <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
              {user?.fullName}
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
              اسم المستخدم: {user?.username}
            </Typography>
            <Box className="profile-card-chips">
              {user?.roles?.map((role) => (
                <Chip
                  key={role}
                  label={role}
                  color="primary"
                  variant="outlined"
                  size="small"
                  sx={{ fontWeight: 'bold' }}
                />
              ))}
            </Box>
          </Box>
        </Box>

        <Divider sx={{ my: 3 }} />

        {/* Change password section */}
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
          <LockIcon color="primary" sx={{ ml: 1 }} />
          <Typography variant="h6" sx={{ fontWeight: 'bold' }}>
            تغيير كلمة المرور
          </Typography>
        </Box>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {success && <Alert severity="success" sx={{ mb: 2 }}>{success}</Alert>}

        <form onSubmit={handleChangePassword}>
          <TextField
            required
            fullWidth
            type="password"
            label="كلمة المرور الحالية"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            disabled={loading}
            sx={{ mb: 2 }}
          />
          <TextField
            required
            fullWidth
            type="password"
            label="كلمة المرور الجديدة"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            disabled={loading}
            sx={{ mb: 2 }}
          />
          <TextField
            required
            fullWidth
            type="password"
            label="تأكيد كلمة المرور الجديدة"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            disabled={loading}
            sx={{ mb: 3 }}
          />
          <Button
            type="submit"
            variant="contained"
            color="primary"
            disabled={loading}
            fullWidth
            sx={{ py: 1.2, fontWeight: 'bold' }}
          >
            {loading ? <CircularProgress size={24} color="inherit" /> : 'تحديث كلمة المرور'}
          </Button>
        </form>
      </Paper>
    </Box>
  );
};

export default Profile;
