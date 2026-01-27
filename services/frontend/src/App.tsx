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
import { NotificationsPage } from './pages/NotificationsPage';
import { AboutPage } from './pages/AboutPage';
import { CameraManagementPage } from './pages/CameraManagementPage';
import { SpeciesManagementPage } from './pages/SpeciesManagementPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { UserAssignmentPage } from './pages/server/UserAssignmentPage';
import { RejectedFilesPage } from './pages/server/RejectedFilesPage';
import { FTPSUploadPage } from './pages/server/FTPSUploadPage';
import { DeleteDataPage } from './pages/server/DeleteDataPage';
import { TelegramConfigPage } from './pages/server/TelegramConfigPage';
import { HealthPage } from './pages/server/HealthPage';
import { ProjectUsersPage } from './pages/ProjectUsersPage';
import { ProjectSettingsPage } from './pages/admin/ProjectSettingsPage';

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
                path="/server/user-assignment"
                element={
                  <ProtectedRoute>
                    <UserAssignmentPage />
                  </ProtectedRoute>
                }
              />
              {/* Alias for admin users page */}
              <Route
                path="/admin/users"
                element={<Navigate to="/server/user-assignment" replace />}
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
                path="/server/telegram-config"
                element={
                  <ProtectedRoute>
                    <TelegramConfigPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/server/health"
                element={
                  <ProtectedRoute>
                    <HealthPage />
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
                <Route path="notifications" element={<NotificationsPage />} />
                <Route path="about" element={<AboutPage />} />
                <Route path="settings" element={<ProjectSettingsPage />} />
                <Route path="camera-management" element={<CameraManagementPage />} />
                <Route path="species-management" element={<SpeciesManagementPage />} />
                <Route path="users" element={<ProjectUsersPage />} />
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
