import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

function getBackendPort(): number {
  try {
    const envText = fs.readFileSync(path.resolve(__dirname, '../backend/.env'), 'utf8')
    const match = envText.match(/^PORT=(\d+)/m)
    if (match) return Number(match[1])
  } catch {
    // fall through to default
  }
  return Number(process.env.PORT) || 3000
}

const backendPort = getBackendPort()

export default defineConfig(({ mode }) => ({
  base: mode === 'demo' ? '/jobhunt-ai/' : '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: `http://localhost:${backendPort}`,
        changeOrigin: true,
        timeout: 0,
        proxyTimeout: 0,
      },
    },
  },
  build: {
    outDir: '../backend/public',
    emptyOutDir: true,
  },
}))
