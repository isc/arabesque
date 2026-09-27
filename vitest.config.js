import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/js/**/*.test.js'],
    environment: 'node',
    setupFiles: ['test/js/support/setup.js'],
  },
})
