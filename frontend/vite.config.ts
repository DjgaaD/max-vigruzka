import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';

export default defineConfig({
  plugins: [react()],
  base: '/max-vigruzka/',
  server: {
    port: 5173
  }
});

