import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // "/assets" is taken by the backend's derived-data mount
    assetsDir: 'app',
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8100',
      '/assets': 'http://localhost:8100',
      '/ws': { target: 'ws://localhost:8100', ws: true },
    },
  },
})
