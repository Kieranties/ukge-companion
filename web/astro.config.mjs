import { defineConfig } from 'astro/config';

// Deployed to https://blog.kieranties.com/ukge-companion/
// Custom domain serves at site root + base path.
export default defineConfig({
  site: 'https://blog.kieranties.com',
  base: '/ukge-companion',
  output: 'static',
  trailingSlash: 'ignore',
  build: {
    assets: 'assets',
  },
});
