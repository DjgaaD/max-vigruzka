import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';

export default defineConfig({
  plugins: [react()],
  // В продакшене статика лежит прямо в /var/www/max-vigruzka,
  // поэтому пути в index.html должны быть относительными, без /max-vigruzka префикса.
  // Иначе получается src="/max-vigruzka/assets/...", а nginx уже и так отдаёт корень /max-vigruzka.
  base: './',
  server: {
    port: 5173
  }
});

