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
    setupFiles: ['tests/setup.ts'],
    include: ['tests/**/*.test.ts']
  }
});
