import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 빌드 시각을 화면에 찍어 둔다. '고쳤는데 안 보인다'가 캐시 때문인지 코드 때문인지
// 이것 하나로 갈린다 — 사이드바 아래 빌드 표시가 최신이 아니면 옛 화면을 보고 있는 것이다.
const BUILD_ID = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(5, 16).replace('T', ' ');

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': 'http://localhost:3001'
    }
  }
})
