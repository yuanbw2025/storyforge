import { defineConfig, type ViteDevServer, type PreviewServer } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { execSync } from 'node:child_process'

function resolveBuildSha(): string {
  const envSha = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA
  if (envSha) return envSha.slice(0, 7)
  try {
    return execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return 'local'
  }
}

function manualChunkFor(moduleId: string): string | undefined {
  const id = moduleId.replaceAll('\\', '/')
  // pnpm resolves a package through `.pnpm/.../node_modules/<package>` and
  // therefore produces more than one `node_modules` segment. The actual
  // package identity is always after the final segment; using the first one
  // silently disabled all vendor rules and pushed React/editor code back into
  // route chunks.
  const packagePath = id.split('/node_modules/').at(-1)

  if (packagePath) {
    if (/^(?:react|react-dom|scheduler|react-router)(?:\/|$)/.test(packagePath)) {
      return 'vendor-react'
    }
    if (packagePath.startsWith('@tiptap/')) return 'vendor-editor'
    if (packagePath.startsWith('dexie/')) return 'vendor-db'
    if (packagePath.startsWith('d3-hierarchy/')) return 'vendor-d3'
    if (packagePath.startsWith('lucide-react/')) return 'vendor-icons'
    if (packagePath.startsWith('zustand/')) return 'vendor-zustand'
  }

  if (id.endsWith('/src/lib/ai/context-builder.ts')) return 'ai-context'
  if (id.endsWith('/src/lib/context-gateway/selector.ts')) return 'context-selector'
  // System prompt catalogs are large, immutable data. Keep them in one
  // cacheable chunk instead of making every application release reparse them
  // as part of the route entry bundle.
  if (/\/src\/lib\/ai\/prompt-seeds-(?:core|tools|genre-packs|genre-packs-extended)\.ts$/.test(id)) {
    return 'prompt-seeds-system'
  }
  return undefined
}

// Existing bookmarks may omit the final slash; normalize before Vite's base middleware.
function installBaseRedirect(server: ViteDevServer | PreviewServer) {
  server.middlewares.use((request, response, next) => {
    if (request.url === '/storyforge' || request.url?.startsWith('/storyforge?')) {
      response.writeHead(302, { Location: request.url.replace('/storyforge', '/storyforge/') })
      response.end()
      return
    }
    next()
  })
}

export default defineConfig({
  // 冻结 E2E 工作区通过符号链接复用 node_modules，但必须使用自己的
  // Vite optimizer 缓存，避免与作者正在运行的预览互相改写预构建依赖。
  cacheDir: process.env.STORYFORGE_E2E_SNAPSHOT === '1'
    ? '.vite-e2e-cache'
    : 'node_modules/.vite',
  define: {
    __STORYFORGE_BUILD_SHA__: JSON.stringify(resolveBuildSha()),
  },
  plugins: [
    { name: 'storyforge-base-redirect', configureServer: installBaseRedirect, configurePreviewServer: installBaseRedirect },
    react(),
    VitePWA({
      injectRegister: null,
      registerType: 'autoUpdate',
      base: '/storyforge/',
      scope: '/storyforge/',
      manifest: {
        name: '故事熔炉 StoryForge',
        short_name: '故事熔炉',
        description: 'AI 驱动的小说创作工坊',
        theme_color: '#153e37',
        background_color: '#e4eee7',
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
        globIgnores: ['ui-preview/**', 'assets/ui-preview-*'],
        navigateFallback: '/storyforge/index.html',
        navigateFallbackDenylist: [/^\/(?!storyforge)/, /^\/storyforge\/ui-preview(?:\/|$)/],
        // 主 bundle 已随功能增多突破 2 MiB（pdf.js + mammoth + 分块流水线），
        // 放宽到 5 MiB 让它被精确预缓存而不是只靠 runtime cache。
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
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
    port: 1111,
    // CF-1: 端口被占用时直接失败报错，而不是静默换到 1112 —— 避免用户以为在 1111、
    // 实际打开的却是被旧进程占用的 1111（错误服务 / 重定向循环）。
    strictPort: true,
    open: '/storyforge/',
    proxy: {
      '/deepseek-proxy': {
        target: 'https://api.deepseek.com',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/deepseek-proxy/, ''),
        secure: true,
      },
      '/openai-proxy': {
        target: 'https://api.openai.com',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/openai-proxy/, ''),
        secure: true,
      },
      '/kimi-proxy': {
        target: 'https://api.moonshot.cn',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/kimi-proxy/, ''),
        secure: true,
      },
      '/claude-proxy': {
        target: 'https://api.anthropic.com',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/claude-proxy/, ''),
        secure: true,
      },
      '/nvidia-proxy': {
        target: 'https://integrate.api.nvidia.com',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/nvidia-proxy/, ''),
        secure: true,
      },
      '/gemini-proxy': {
        target: 'https://generativelanguage.googleapis.com',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/gemini-proxy/, ''),
        secure: true,
      },
      '/doubao-proxy': {
        target: 'https://ark.cn-beijing.volces.com',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/doubao-proxy/, ''),
        secure: true,
      },
      '/agnes-proxy': {
        target: 'https://apihub.agnes-ai.com',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/agnes-proxy/, ''),
        secure: true,
      },
      '/longcat-proxy': {
        target: 'https://api.longcat.chat',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/longcat-proxy/, ''),
        secure: true,
      },
      '/opencode-proxy': {
        target: 'https://opencode.ai',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/opencode-proxy/, '/zen/go'),
        secure: true,
      },
      // NS-5 embedding：国内嵌入服务本地代理（绕浏览器 CORS）
      '/siliconflow-proxy': {
        target: 'https://api.siliconflow.cn',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/siliconflow-proxy/, ''),
        secure: true,
      },
      '/qwen-proxy': {
        target: 'https://dashscope.aliyuncs.com',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/qwen-proxy/, ''),
        secure: true,
      },
      '/glm-proxy': {
        target: 'https://open.bigmodel.cn',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/glm-proxy/, ''),
        secure: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      input: { main: 'index.html', 'ui-preview': 'ui-preview/index.html' },
      output: {
        // 只把 react 固定成独立 vendor chunk（便于缓存）。
        // pdfjs / mammoth / three / jszip 均已通过「动态 import() 按需加载」自然分块，
        // 不可在此用 manualChunks 固定它们——否则会被并入主包静态引用、反而变回首屏 eager 加载。
        // Phase 3.5:把大的静态依赖拆成独立 vendor chunk。
        // 好处:① 主包变小、解析更快 ② 这些库很少变,浏览器可长期缓存(应用更新不必重下)。
        // 按真实模块路径归组，确保 react-dom/client 及其 CJS 实现都进入
        // vendor-react；对象式入口声明会让 @tiptap/react 抢先吸收 react-dom，
        // 形成 vendor-editor ↔ vendor-react 循环并把 React DOM 回灌首屏。
        manualChunks: manualChunkFor,
      },
    },
  },
})
