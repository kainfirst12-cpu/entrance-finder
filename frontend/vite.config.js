import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  define: {
    // production 빌드 시 VITE_API_URL 미설정이면 Railway URL 강제 주입
    ...(mode === 'production' && !process.env.VITE_API_URL
      ? { 'import.meta.env.VITE_API_URL': JSON.stringify('https://entrance-finder-production.up.railway.app') }
      : {}),
  },
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:3001'
    }
  }
}))
