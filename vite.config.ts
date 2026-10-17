import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { configDefaults } from 'vitest/config';

export default defineConfig({
  plugins: [react(), {
    name: 'protected-viewer-runtime-headers',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.startsWith('/viewer-runtime/')) {
          res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; worker-src 'self' blob:; img-src 'self' data: blob:; font-src 'self' data:; frame-ancestors 'self'; object-src 'none'; base-uri 'none'; form-action 'none'");
          res.setHeader('X-Frame-Options', 'SAMEORIGIN');
          res.setHeader('X-Content-Type-Options', 'nosniff');
          // Vite's HTML transform adds its development client. The trusted runtime
          // is served as an ordinary static document, independently of the app HMR.
        }
        next();
      });
    },
  }],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  server: {
    host: true,
    proxy: {
      '/api': {
        target: process.env.WFC_API_PROXY_TARGET ?? 'http://127.0.0.1:4000',
        changeOrigin: false,
        xfwd: true,
      },
    },
  },
  preview: {
    host: true
  },
  test: {
    // These copied geometry/protocol suites use Node's runner and run separately.
    exclude: [...configDefaults.exclude, 'viewer-runtime/test/**'],
    globals: true,
    environment: 'jsdom',
    setupFiles: 'src/test/setup.ts',
    coverage: {
      provider: 'v8'
    }
  }
});
