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
// react-day-picker's default stylesheet must load before our index.css
// so the brand-teal `--rdp-*` overrides in index.css win the cascade.
import 'react-day-picker/style.css';
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

// A deploy replaces the content-hashed chunks, so a tab that was open before it
// asks for a lazy chunk that is no longer there, gets a 404, and the whole app
// dies on the error screen. Vite fires this event for exactly that case, and a
// reload picks up the new index.html with the new chunk names.
//
// Once per tab, on purpose. If the chunk is genuinely missing rather than
// renamed, the second attempt has to fail visibly instead of reloading forever.
const CHUNK_RELOAD_KEY = 'chunk-reload-attempted';

window.addEventListener('vite:preloadError', (event) => {
  if (sessionStorage.getItem(CHUNK_RELOAD_KEY)) return;
  event.preventDefault();
  sessionStorage.setItem(CHUNK_RELOAD_KEY, '1');
  window.location.reload();
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);
