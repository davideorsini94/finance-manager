import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Providers } from './app/providers';
import { cleanupLegacyApiCaches } from './lib/sw-cache-cleanup';
import './index.css';

// NB: la registrazione del Service Worker è gestita da `vite-plugin-pwa`
// (auto-injected via `registerSW.js`). Niente registrazione manuale qui:
// duplicarla generava doppi event `sw-update-available` e race condition
// fra il SW di workbox e quello custom.

// Pulizia best-effort delle cache API lasciate da SW di versioni
// precedenti — vedi sw-cache-cleanup.ts per il razionale.
void cleanupLegacyApiCaches();

const container = document.getElementById('root');
if (!container) throw new Error('Root container missing');

createRoot(container).render(
  <StrictMode>
    <Providers />
  </StrictMode>,
);
