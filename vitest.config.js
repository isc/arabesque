import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/js/**/*.test.js'],
    environment: 'node',
    setupFiles: ['test/js/support/setup.js'],
    // What a test stubs with vi.stubGlobal or vi.stubEnv is put back before the
    // next one runs, so no file has to remember to — the storage and document
    // fakes (support/browserGlobals.js) are installed that way.
    unstubGlobals: true,
    unstubEnvs: true,
  },
})
