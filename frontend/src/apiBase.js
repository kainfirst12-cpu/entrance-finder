// 개발 환경(vite dev)에서는 로컬 백엔드, 프로덕션에서는 Railway
export const API_BASE = import.meta.env.DEV
  ? 'http://localhost:3001'
  : 'https://entrance-finder-production.up.railway.app';
