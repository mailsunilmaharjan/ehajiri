import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 4000,
    open: true,
    host: true,
    strictPort: false,
    hmr: { overlay: true },
    watch: { usePolling: true, interval: 300 },
    proxy: {
      '/api': {
        // Overridable so an isolated dev backend on another port can be
        // targeted without hardcoding it here (e.g. VITE_API_PROXY_TARGET=
        // http://localhost:5099 npx vite) — defaults to the standard dev port.
        target      : process.env.VITE_API_PROXY_TARGET || 'http://localhost:5001',
        changeOrigin: true,
        secure      : false,
      },
    },
  },
})
