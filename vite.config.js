import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  clearScreen: false,
  server: {
    // this machine blocks IPv6 loopback (::1) connections (WinError 10013);
    // bind to IPv4 by default. CLI --host/--port args still override this.
    host: '127.0.0.1',
    strictPort: false,
  },
  build: {
    target: 'es2021',
    minify: 'esbuild',
  },
});
