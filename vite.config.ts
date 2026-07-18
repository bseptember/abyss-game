import { defineConfig } from 'vite';

// Base is always `/` for Cloudflare (abyss.imidlalo.co.za).
// GitHub Pages uses `npm run build:gh` which passes --base=/abyss-game/.
export default defineConfig({
  base: '/',
  build: {
    target: 'esnext',
    cssCodeSplit: false,
  },
});
