import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// For local development against a remote API, set VITE_PROXY_TARGET in
// services/frontend/.env.local (gitignored), for example:
//   VITE_PROXY_TARGET=https://dev.addaxai.com
// Without it, the proxy targets the docker-internal API service as before.
// See "Frontend UI development loop" in DEVELOPERS.md.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = env.VITE_PROXY_TARGET || 'http://api:8000'
  const entry = { target, changeOrigin: true }
  return {
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      port: 5173,
      proxy: {
        '/api': entry,
        '/auth': entry,
        '/users': entry,
        // Served by the frontend container's nginx in deployments (static
        // mount), so the local loop must proxy it to the remote too or
        // project cover images look broken during local dev.
        '/project-images': entry,
        '/ws': {
          target: target.replace(/^http/, 'ws'),
          ws: true,
          changeOrigin: true,
        },
      },
    },
  }
})
