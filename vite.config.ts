import { fileURLToPath } from 'node:url'
import { defineConfig, type ProxyOptions } from 'vite'
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
})
