import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// base relativa: o site gerado em dist/ funciona em qualquer hospedagem estática,
// inclusive em subpasta (GitHub Pages, Cloudflare Pages, Vercel, S3...).
export default defineConfig({
  base: './',
  plugins: [react()],
  test: { environment: 'node', include: ['src/**/*.test.ts'], testTimeout: 60000 },
});
