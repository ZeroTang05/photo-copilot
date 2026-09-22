import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  optimizeDeps: { exclude: ['@photo-copilot/domain', '@photo-copilot/renderer', '@photo-copilot/ai-contract'] },
  worker: { format: 'iife' },
  server: { proxy: { '/api': 'http://127.0.0.1:8787' } },
});
