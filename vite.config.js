import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: './',  // 使用相对路径，支持 Electron 本地加载
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://47.113.228.135:7099',
        changeOrigin: true,
        rewrite: path => path.replace(new RegExp(`^/api`, 'g'), '')
      },
    },
    hmr: {
      overlay: false
    },
    host: '0.0.0.0'
  },
})
