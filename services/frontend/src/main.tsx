/**
 * Main entry point
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/index.css';
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
    <App />
  </React.StrictMode>
);
