import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY ?? 'http://backend:3000',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      // `prompt`: il SW NON prende il controllo automaticamente. Espone un
      // evento `vite:pwa-update-available` che il client gestisce con il
      // banner SWUpdateBanner (skipWaiting esplicito al click utente).
      // Questo evita le pagine "vuote in caricamento" quando workbox fa
      // skipWaiting + clientsClaim mentre la pagina ha già richieste in
      // flight su un SW diverso.
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Finance Manager',
        short_name: 'Finance',
        description: 'Gestione contabilità famigliare',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: '/icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Niente skip auto-claim: aspettiamo input utente via banner.
        skipWaiting: false,
        clientsClaim: false,
        navigateFallback: '/index.html',
        // NIENTE cache delle API: erano causa di pagine stale dopo
        // mutation (es. transfer balance non aggiornato sul GET seguente,
        // perché NetworkFirst poteva servire dalla cache se il network
        // tardava > 5s o per timing del SW). Le risposte API devono
        // sempre arrivare dal server, in modo che react-query si veda
        // dati freschi su ogni invalidate.
        runtimeCaching: [
          {
            urlPattern: /\.(?:js|css|woff2|png|svg)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'asset-cache',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
    }),
  ],
});
