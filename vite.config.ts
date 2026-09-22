import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { productName, productDescription } from './shared/branding';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'app-branding',
      transformIndexHtml: (html) =>
        html
          .replaceAll('%APP_NAME%', productName)
          .replaceAll('%APP_DESCRIPTION%', productDescription),
    },
  ],
  base: './',
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
  build: { outDir: 'dist/extension', sourcemap: false },
});
