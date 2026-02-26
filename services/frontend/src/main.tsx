/**
 * Main entry point
 */

// Clean up old PWA service worker for existing users (can be removed after a few months)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(registrations => {
    registrations.forEach(r => r.unregister());
  });
}

import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import './styles/index.css';
import { queryClient } from './lib/query-client';
import { logUnhandledError, logUnhandledRejection } from './utils/logger';

// Set up global error handlers
window.addEventListener('error', (event) => {
  logUnhandledError(event.error || event);
});

window.addEventListener('unhandledrejection', (event) => {
  logUnhandledRejection(event);
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);
