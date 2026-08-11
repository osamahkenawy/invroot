import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5050,
    // Bind IPv4 loopback explicitly. The default resolved to the IPv6 loopback
    // only ([::1]), so browsers that reach localhost over IPv4 (127.0.0.1) got
    // ERR_CONNECTION_REFUSED. Use `host: true` instead to also expose on the LAN.
    host: '127.0.0.1',
    proxy: {
      // 127.0.0.1, not "localhost" — same IPv4/IPv6 mismatch would break the
      // proxy's hop to the API.
      '/api': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
