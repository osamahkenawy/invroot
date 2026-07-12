import { createContext, useState, useEffect, useCallback } from 'react';
import api from '../lib/api.js';

export const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]     = useState(null);
  const [tenant, setTenant] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchMe = useCallback(async () => {
    try {
      const res = await api.get('/auth/me');
      if (res.success) {
        setUser(res.user);
        // Optionally load tenant data
        const tenantRes = await api.get('/tenants');
        if (tenantRes.success) setTenant(tenantRes.data);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchMe(); }, [fetchMe]);

  const login = async (email, password) => {
    const res = await api.post('/auth/login', { email, password });
    if (res.success) {
      setUser(res.user);
      localStorage.setItem('auth_token', res.token);
      const tenantRes = await api.get('/tenants');
      if (tenantRes.success) setTenant(tenantRes.data);
    }
    return res;
  };

  const logout = async () => {
    await api.post('/auth/logout', {});
    localStorage.removeItem('auth_token');
    setUser(null);
    setTenant(null);
  };

  const refreshUser = fetchMe;

  return (
    <AuthContext.Provider value={{ user, tenant, loading, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}
