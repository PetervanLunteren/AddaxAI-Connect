/**
 * Main App component with routing
 */
import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ProjectProvider } from './contexts/ProjectContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import ErrorBoundary from './components/ErrorBoundary';
import { AppLayout } from './components/layout/AppLayout';

// Pages
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { VerifyEmail } from './pages/VerifyEmail';
import { ForgotPassword } from './pages/ForgotPassword';
import { ResetPassword } from './pages/ResetPassword';
import { Dashboard } from './pages/Dashboard';
import { CamerasPage } from './pages/CamerasPage';
import { ImagesPage } from './pages/ImagesPage';
import { SettingsPage } from './pages/SettingsPage';
import { AboutPage } from './pages/AboutPage';
import { DevToolsPage } from './pages/DevToolsPage';
import { CameraManagementPage } from './pages/CameraManagementPage';
import { ServerSettingsPage } from './pages/ServerSettingsPage';
import { ProjectsPage } from './pages/ProjectsPage';

function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <ProjectProvider>
            <Routes>
              {/* Public routes */}
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route path="/verify-email" element={<VerifyEmail />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />

              {/* Projects overview (no sidebar) */}
              <Route
                path="/projects"
                element={
                  <ProtectedRoute>
                    <ProjectsPage />
                  </ProtectedRoute>
                }
              />

              {/* Server-wide admin routes (no sidebar, superuser only) */}
              <Route
                path="/server-settings"
                element={
                  <ProtectedRoute>
                    <ServerSettingsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/debug"
                element={
                  <ProtectedRoute>
                    <DevToolsPage />
                  </ProtectedRoute>
                }
              />

              {/* Project-specific routes with sidebar */}
              <Route
                path="/projects/:projectId"
                element={
                  <ProtectedRoute>
                    <AppLayout>
                      <Outlet />
                    </AppLayout>
                  </ProtectedRoute>
                }
              >
                {/* Default redirect to dashboard */}
                <Route index element={<Navigate to="dashboard" replace />} />
                <Route path="dashboard" element={<Dashboard />} />
                <Route path="cameras" element={<CamerasPage />} />
                <Route path="images" element={<ImagesPage />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="about" element={<AboutPage />} />
                <Route path="camera-management" element={<CameraManagementPage />} />
              </Route>

              {/* Redirect root to projects */}
              <Route path="/" element={<Navigate to="/projects" replace />} />

              {/* 404 - redirect to projects */}
              <Route path="*" element={<Navigate to="/projects" replace />} />
            </Routes>
          </ProjectProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;
