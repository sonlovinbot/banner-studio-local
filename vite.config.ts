import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Cổng 3100 = giao diện (Vite). Cổng 5174 = server local (API + DB).
// Mọi đường dẫn dữ liệu được proxy sang server local nên trình duyệt chỉ
// thấy một origin duy nhất — không vướng CORS, và code không cần biết
// đang chạy dev hay đã build.
const API_TARGET = process.env.API_TARGET || 'http://localhost:5174';

export default defineConfig({
  server: {
    port: 3100,
    host: '127.0.0.1',
    proxy: {
      '/rest':  { target: API_TARGET, changeOrigin: true },
      '/auth':  { target: API_TARGET, changeOrigin: true },
      '/api':   { target: API_TARGET, changeOrigin: true },
      '/files': { target: API_TARGET, changeOrigin: true },
    },
  },
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
});
