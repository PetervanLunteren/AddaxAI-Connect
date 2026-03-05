/**
 * Protected route wrapper
 *
 * Redirects to login if user is not authenticated
 */
import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-600">Loading...</div>
      </div>
    );
  }

  if (!user) {
    const returnTo = location.pathname + location.search;
    const loginUrl = returnTo && returnTo !== '/'
      ? `/login?from=${encodeURIComponent(returnTo)}`
      : '/login';
    return <Navigate to={loginUrl} replace />;
  }

  return <>{children}</>;
};
