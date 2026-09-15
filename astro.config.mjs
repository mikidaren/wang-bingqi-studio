import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  site: 'https://studio.miki2022.eu.org',
  output: 'static',
  build: {
    assets: 'assets',
  },
});
