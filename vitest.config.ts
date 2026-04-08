import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    environmentOptions: {
      jsdom: {
        url: 'https://demo.klassmatt.com.br/'
      }
    },
    include: ['tests/**/*.test.ts']
  }
});
