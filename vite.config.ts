import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      base: '/storyforge/',
      scope: '/storyforge/',
      manifest: {
        name: '故事熔炉 StoryForge',
        short_name: '故事熔炉',
        description: 'AI 驱动的小说创作工坊',
        theme_color: '#6366f1',
        background_color: '#0a0a0f',
        display: 'standalone',
        start_url: '/storyforge/',
        scope: '/storyforge/',
        lang: 'zh-CN',
        icons: [
          {
            src: '/storyforge/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/storyforge/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: '/storyforge/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        navigateFallback: '/storyforge/index.html',
        navigateFallbackDenylist: [/^\/(?!storyforge)/],
        runtimeCaching: [
          {
            // Google Fonts
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
    }),
  ],
  base: '/storyforge/',
  server: {
    port: 5175,
    open: true,
  },
  build: {
    outDir: 'dist',
  },
})
