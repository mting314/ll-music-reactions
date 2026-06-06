import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

// Project pages serve under /<repo>/, so the production build needs that base
// path. Dev (`vite`) stays at "/".
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/ll-music-reactions/' : '/',
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
}));
