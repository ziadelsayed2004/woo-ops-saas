import React, { createContext, useContext, useState, useEffect } from 'react';
import { apiClient } from '../services/apiClient';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Restore session on mount
  useEffect(() => {
    async function restoreSession() {
      try {
        const data = await apiClient.get('/auth/me');
        setUser(data);
      } catch (err) {
        // 401 is expected if not logged in
        if (err.status !== 401) {
          console.error('Failed to restore session:', err);
          setError(err.message);
        }
      } finally {
        setLoading(false);
      }
    }
    restoreSession();
  }, []);

  const login = async (username, password) => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.post('/auth/login', { username, password });
      setUser(data.user);
      return data.user;
    } catch (err) {
      setError(err.message || 'Login failed');
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    setLoading(true);
    try {
      await apiClient.post('/auth/logout');
      setUser(null);
    } catch (err) {
      console.error('Logout failed:', err);
      setError(err.message || 'Logout failed');
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const hasPermission = (permission) => {
    if (!user) return false;
    // super_admin role bypasses all permissions checks
    if (user.roles && user.roles.includes('super_admin')) return true;
    return user.permissions && user.permissions.includes(permission);
  };

  const value = {
    user,
    isAuthenticated: !!user,
    loading,
    error,
    login,
    logout,
    hasPermission,
    clearError: () => setError(null)
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
