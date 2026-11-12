/**
 * Authentication context provider
 *
 * Manages user authentication state and provides login/logout functions
 */
import React, { createContext, useState, useEffect, ReactNode } from 'react';
import {
  User,
  LoginTwoFactorStep,
  isTwoFactorStep,
  login as apiLogin,
  logout as apiLogout,
  getCurrentUser,
} from '../api/auth';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  /**
   * Resolves to null when the user is logged in, or to the two-factor step
   * that still has to be done. That step ends with completeLogin.
   */
  login: (email: string, password: string) => Promise<LoginTwoFactorStep | null>;
  /** Finish a login with the access token a two-factor step returned */
  completeLogin: (accessToken: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  login: async () => null,
  completeLogin: async () => {},
  logout: async () => {},
  refreshUser: async () => {},
});

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  // Load user on mount if token exists
  useEffect(() => {
    const loadUser = async () => {
      const token = localStorage.getItem('access_token');

      if (token) {
        try {
          const userData = await getCurrentUser();
          setUser(userData);
        } catch (error) {
          // Token invalid, clear it
          localStorage.removeItem('access_token');
          localStorage.removeItem('user');
        }
      }

      setLoading(false);
    };

    loadUser();
  }, []);

  const completeLogin = async (accessToken: string): Promise<void> => {
    // Store token
    localStorage.setItem('access_token', accessToken);

    // Fetch user data
    const userData = await getCurrentUser();
    setUser(userData);
    localStorage.setItem('user', JSON.stringify(userData));
  };

  const login = async (email: string, password: string): Promise<LoginTwoFactorStep | null> => {
    const response = await apiLogin(email, password);
    if (isTwoFactorStep(response)) {
      // Drop a login that is still in this browser. The step that follows is
      // for the account whose password was just checked, not for the one
      // that was here before. Only now, so a mistyped password does not log
      // anyone out.
      localStorage.removeItem('access_token');
      localStorage.removeItem('user');
      setUser(null);
      return response;
    }

    await completeLogin(response.access_token);
    return null;
  };

  const logout = async (): Promise<void> => {
    await apiLogout();
    setUser(null);
  };

  const refreshUser = async (): Promise<void> => {
    try {
      const userData = await getCurrentUser();
      setUser(userData);
      localStorage.setItem('user', JSON.stringify(userData));
    } catch (error) {
      console.error('Failed to refresh user:', error);
      setUser(null);
      localStorage.removeItem('access_token');
      localStorage.removeItem('user');
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, completeLogin, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
};
