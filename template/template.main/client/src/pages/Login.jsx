import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../app/AuthContext';
import { APP_CONFIG } from '../config/appConfig';
import '../styles/Login.css';
import {
  Box,
  Button,
  TextField,
  Typography,
  Paper,
  Alert,
  CircularProgress,
  alpha
} from '@mui/material';
import logoImg from '../assets/logo.svg';
import { t } from '../locales/t';

export const Login = () => {
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/');
    }
  }, [isAuthenticated, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username || !password) {
      setError(t('auth.usernameRequired'));
      return;
    }

    setLoading(true);
    setError('');
    try {
      await login(username, password);
    } catch (err) {
      console.error(err);
      setError(err.message || t('auth.loginFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box className="login-page-container">
      <Paper className="login-dialog" elevation={0}>
        <Box className="login-logo-container">
          <Box
            component="img"
            src={logoImg}
            alt="Logo"
            className="login-logo-img"
          />
        </Box>

        <Typography variant="h5" className="login-title">
          {t('auth.login')}
        </Typography>
        <Typography variant="body2" className="login-subtitle">
          {APP_CONFIG.loginSubtitle}
        </Typography>

        {error && (
          <Alert severity="error" className="login-error-alert">
            {error}
          </Alert>
        )}

        <form onSubmit={handleSubmit}>
          <TextField
            margin="normal"
            required
            fullWidth
            id="username"
            label={t('auth.username')}
            name="username"
            autoComplete="username"
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={loading}
            className="login-field"
          />
          <TextField
            margin="normal"
            required
            fullWidth
            name="password"
            label={t('auth.password')}
            type="password"
            id="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
            className="login-field-last"
          />
          <Button
            type="submit"
            fullWidth
            variant="contained"
            size="large"
            disabled={loading}
            className="login-submit-button"
          >
            {loading ? <CircularProgress size={24} color="inherit" /> : t('auth.login')}
          </Button>
        </form>

        <Typography variant="caption" className="login-footer-text">
          {APP_CONFIG.companyName}
        </Typography>
      </Paper>
    </Box>
  );
};

export default Login;
