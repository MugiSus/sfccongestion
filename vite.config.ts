import { fileURLToPath } from 'node:url'
import { type ProxyOptions } from 'vite'
import { defineConfig } from 'vitest/config'
import solid from 'vite-plugin-solid'
import tailwindcss from '@tailwindcss/vite'

const proxy: Record<string, ProxyOptions> = {
  '/api/crowd': {
    target: 'https://crowd-api.sfc.sz7.jp',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api\/crowd/, ''),
  },
}

export default defineConfig({
  plugins: [solid(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: { proxy },
  preview: { proxy },
  test: {
    environment: 'happy-dom',
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 15_000,
  },
})
