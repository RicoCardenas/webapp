import { defineConfig } from 'vite';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'public/index.html'),
        graph: resolve(__dirname, 'public/graph.html'),
        account: resolve(__dirname, 'public/account.html'),
        login: resolve(__dirname, 'public/login.html'),
        signup: resolve(__dirname, 'public/signup.html'),
        reset: resolve(__dirname, 'public/reset-password.html'),
        contactResult: resolve(__dirname, 'public/contact-result.html'),
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
});
