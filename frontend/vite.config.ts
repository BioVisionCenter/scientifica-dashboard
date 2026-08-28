import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // one deck.gl/luma.gl instance: Viv's layers must extend the same Layer class
    dedupe: ['@deck.gl/core', '@luma.gl/core', '@luma.gl/engine', 'react', 'react-dom'],
  },
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
