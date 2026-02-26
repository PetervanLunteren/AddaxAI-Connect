// Self-destructing service worker — replaces old PWA worker.
// Browsers check for sw.js updates periodically; when they fetch this version,
// it unregisters itself and reloads all open tabs.
// Can be deleted after a few months once all users have refreshed.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', () => {
  self.registration.unregister();
  self.clients.matchAll({ type: 'window' }).then(clients => {
    clients.forEach(client => client.navigate(client.url));
  });
});
