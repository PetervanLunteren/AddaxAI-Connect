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
import { Toaster } from './components/ui/Toaster';

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
import { FileManagementPage } from './pages/server/FileManagementPage';
import { ServerSettingsPage } from './pages/server/ServerSettingsPage';
import { HealthPage } from './pages/server/HealthPage';
import { ProjectUsersPage } from './pages/ProjectUsersPage';
import { ProjectSettingsPage } from './pages/admin/ProjectSettingsPage';
import { ManageImagesPage } from './pages/admin/ManageImagesPage';
import { NaiveOccupancyPage } from './pages/insights/NaiveOccupancyPage';
import { InsightsMapPage } from './pages/insights/MapPage';
import { InsightsPerformancePage } from './pages/insights/PerformancePage';

function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <ProjectProvider>
            <ImageCacheProvider>
            <Toaster>
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
                path="/server/file-management"
                element={
                  <ProtectedRoute>
                    <FileManagementPage />
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
                {/* Legacy single-page routes redirect into Insights so old
                    bookmarks keep working. */}
                <Route path="map" element={<Navigate to="../insights/map" replace />} />
                <Route path="performance" element={<Navigate to="../insights/performance" replace />} />
                {/* Insights section */}
                <Route path="insights" element={<Navigate to="insights/naive-occupancy" replace />} />
                <Route path="insights/naive-occupancy" element={<NaiveOccupancyPage />} />
                <Route path="insights/map" element={<InsightsMapPage />} />
                <Route path="insights/performance" element={<InsightsPerformancePage />} />
                <Route path="notifications" element={<NotificationsPage />} />
                <Route path="exports" element={<ExportsPage />} />
                <Route path="documents" element={<DocumentsPage />} />
                <Route path="settings" element={<ProjectSettingsPage />} />
                <Route path="users" element={<ProjectUsersPage />} />
                <Route path="manage-images" element={<ManageImagesPage />} />
              </Route>

              {/* Redirect root to projects */}
              <Route path="/" element={<Navigate to="/projects" replace />} />

              {/* 404 - redirect to projects */}
              <Route path="*" element={<Navigate to="/projects" replace />} />
            </Routes>
            </Toaster>
            </ImageCacheProvider>
          </ProjectProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;
