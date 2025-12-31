/**
 * Projects Page wrapper that shows server modal when on server routes
 */
import React from 'react';
import { useLocation, useNavigate, Outlet } from 'react-router-dom';
import { ProjectsPage } from './ProjectsPage';
import { ServerModal } from '../components/ServerModal';

export const ProjectsPageWithServerModal: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();

  // Check if we're on a server route
  const isServerRoute = location.pathname === '/server-settings' || location.pathname === '/debug';

  const handleCloseModal = () => {
    navigate('/projects');
  };

  return (
    <>
      {/* Always render ProjectsPage as the base */}
      <ProjectsPage />

      {/* Show server modal when on server routes */}
      <ServerModal open={isServerRoute} onClose={handleCloseModal}>
        <Outlet />
      </ServerModal>
    </>
  );
};
