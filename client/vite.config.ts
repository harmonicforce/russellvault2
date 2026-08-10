/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
  test: {
    // jsdom provides no ResizeObserver, which @dnd-kit/dom constructs at module
    // load. The setup file installs no-op observer stubs so the module can be
    // imported; it simulates no geometry and proves no gesture.
    setupFiles: ['./vitest.setup.ts'],
    // The browser gate is Playwright's, not Vitest's. Both runners collect
    // `*.spec.ts`, so without this exclusion Vitest would try to execute the
    // browser suite in jsdom — the exact environment S1.6.7 exists to stop
    // relying on.
    exclude: ['**/node_modules/**', '**/dist/**', '**/dist-browser-gate/**', 'browser/**'],
  },
})
