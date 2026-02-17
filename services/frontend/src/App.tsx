/**
 * Main App component with routing
 */
import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ProjectProvider } from './contexts/ProjectContext';
import { ImageCacheProvider } from './contexts/ImageCacheContext';
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
import { NotificationsPage } from './pages/NotificationsPage';
import { ExportsPage } from './pages/ExportsPage';
import { DocumentsPage } from './pages/DocumentsPage';
import { AboutPage } from './pages/AboutPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { ServerAdminManagementPage } from './pages/server/ServerAdminManagementPage';
import { RejectedFilesPage } from './pages/server/RejectedFilesPage';
import { FTPSUploadPage } from './pages/server/FTPSUploadPage';
import { DeleteDataPage } from './pages/server/DeleteDataPage';
import { ServerSettingsPage } from './pages/server/ServerSettingsPage';
import { HealthPage } from './pages/server/HealthPage';
import { ProjectUsersPage } from './pages/ProjectUsersPage';
import { ProjectSettingsPage } from './pages/admin/ProjectSettingsPage';
import { DetectionRateMapPage } from './pages/DetectionRateMapPage';

function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <ProjectProvider>
            <ImageCacheProvider>
            <Routes>
              {/* Public routes */}
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route path="/verify-email" element={<VerifyEmail />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />

              {/* Projects overview */}
              <Route
                path="/projects"
                element={
                  <ProtectedRoute>
                    <ProjectsPage />
                  </ProtectedRoute>
                }
              />

              {/* Server administration pages (superuser only) */}
              <Route
                path="/server/server-admin-management"
                element={
                  <ProtectedRoute>
                    <ServerAdminManagementPage />
                  </ProtectedRoute>
                }
              />
              {/* Aliases for backwards compatibility */}
              <Route
                path="/server/user-assignment"
                element={<Navigate to="/server/server-admin-management" replace />}
              />
              <Route
                path="/admin/users"
                element={<Navigate to="/server/server-admin-management" replace />}
              />
              <Route
                path="/server/rejected-files"
                element={
                  <ProtectedRoute>
                    <RejectedFilesPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/server/ftps-upload"
                element={
                  <ProtectedRoute>
                    <FTPSUploadPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/server/delete-data"
                element={
                  <ProtectedRoute>
                    <DeleteDataPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/server/settings"
                element={
                  <ProtectedRoute>
                    <ServerSettingsPage />
                  </ProtectedRoute>
                }
              />
              {/* Redirect old Telegram config URL */}
              <Route
                path="/server/telegram-config"
                element={<Navigate to="/server/settings" replace />}
              />
              <Route
                path="/server/health"
                element={
                  <ProtectedRoute>
                    <HealthPage />
                  </ProtectedRoute>
                }
              />
<Route
                path="/about"
                element={
                  <ProtectedRoute>
                    <AboutPage />
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
                <Route path="map" element={<DetectionRateMapPage />} />
                <Route path="notifications" element={<NotificationsPage />} />
                <Route path="exports" element={<ExportsPage />} />
                <Route path="documents" element={<DocumentsPage />} />
                <Route path="settings" element={<ProjectSettingsPage />} />
                <Route path="users" element={<ProjectUsersPage />} />
              </Route>

              {/* Redirect root to projects */}
              <Route path="/" element={<Navigate to="/projects" replace />} />

              {/* 404 - redirect to projects */}
              <Route path="*" element={<Navigate to="/projects" replace />} />
            </Routes>
            </ImageCacheProvider>
          </ProjectProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;
