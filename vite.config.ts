import { defineConfig, type ViteDevServer, type PreviewServer } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { localCodexPlugin } from './scripts/local-codex/bridge.mjs'
import { localTtsPlugin } from './scripts/ttrpg-local-tts/product-bridge.mjs'
import { execSync } from 'node:child_process'
import { providerProxies } from './scripts/distribution/proxies.mjs'

function resolveBuildSha(): string {
  const envSha = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA
  if (envSha) return envSha.slice(0, 7)
  try {
    return execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return 'local'
  }
}

// Actual static replay dependency groups: mechanics -> state -> open -> adapters.
// Keep adapters separate from their prerequisites to avoid circular chunk loading.
const TTRPG_REPLAY_CHUNK_MODULES = {
  mechanics: [
    'ability-ledger', 'action-economy', 'action-feedback', 'action-requirement',
    'advancement', 'dice', 'world-time',
  ],
  state: [
    'campaign', 'campaign-v2', 'character-sheet',
    'content-version', 'director-model', 'effect-plan',
    'effect-runtime', 'frozen-facts', 'frozen-content-cache', 'item-ledger', 'media-contract',
    'open-authorization', 'open-chaos', 'open-content-authoring', 'open-content-common',
    'open-content-predicates', 'open-content-references', 'open-content-situations', 'open-content-templates',
    'open-contract', 'open-contract-parse', 'context-trigger-contract', 'open-context-policy', 'open-model-purpose-contract', 'open-memory-contract', 'open-memory-receipt', 'open-model-memory-contract', 'open-brief-contract', 'open-memory-event-digest', 'open-memory-prefix-proof', 'open-private-choice-contract', 'open-coordination',
    'open-fact-authority', 'open-fact-ledger', 'open-fact-runtime-references', 'open-gates', 'open-intent', 'open-intent-clarification-contract', 'open-rule-request-contract',
    'open-knowledge', 'open-knowledge-share', 'open-identity-knowledge-contract', 'open-kp-binding', 'open-kp-narration',
    'open-kp-receipt', 'open-model-calls', 'open-model-purpose', 'open-oracle-contract',
    'open-interaction', 'oracle', 'participants', 'predicate', 'pressure-runtime',
    'private-guidance-model', 'resolution', 'rule-action-mechanical', 'rule-pack',
    'rule-pack-v2', 'run-format', 'runtime-state', 'session-facts',
    'situation-engine', 'open-session-situation-contract', 'open-session-situation-catalog',
    'character-mechanical-initialization', 'open-public-situation-authorization-contract', 'open-public-situation-request',
    'open-entity-contract', 'open-entity-model-contract', 'open-entity-model-origin-contract', 'open-entity-mechanics', 'open-entity-catalog', 'open-entity-window', 'open-runtime-entity-references', 'open-common-oracle-request', 'open-common-oracle-archive-contract', 'open-oracle-runtime-delivery',
    'open-voice-completion-contract', 'open-voice-timeline-contract',
  ],
  open: [
    'open-audio-runtime', 'open-audio-scope', 'open-audio-contract', 'open-voice-script-contract', 'open-voice-request-contract',
    'open-audio-receipt', 'open-generated-audio-contract',
    'open-voice-confirmed-reading-contract', 'open-voice-reading-contract', 'open-identity-knowledge',
    'open-branch-contract', 'open-branch-recovery', 'open-companion-preauthorization', 'open-handoff', 'open-hosting-delegation',
    'open-gate-recovery', 'open-knowledge-discovery', 'open-discovery-effect-templates', 'open-operation', 'open-oracle-review', 'open-pressure-cycle',
    'open-pressure-effect', 'open-table-conversation', 'open-table-conversation-reducer', 'open-turn-settlement', 'open-manual-action', 'open-manual-catalog', 'open-private-choice', 'open-table-risk', 'open-rule-plan', 'open-runtime-contract', 'open-situation-cycle',
    'open-situation-runtime', 'open-stage-close', 'open-terminal-gates', 'open-memory-proof', 'open-memory-reducer',
    'open-effect-binding', 'open-entity-admission', 'open-entity-operation-basis', 'open-entity-journal',
  ],
  adapters: [
    'open-branch-reducer', 'open-gate-recovery-reducer', 'open-fact-reducer', 'open-knowledge-settlement', 'open-knowledge-share-reducer', 'open-identity-knowledge-reducer',
    'open-kp-reducer', 'open-private-choice-reducer', 'open-model-call-reducer', 'open-operation-reducer', 'open-oracle-reducer',
    'open-oracle-review-reducer', 'open-pressure-effect-reducer', 'open-pressure-reducer', 'open-situation-cycle-reducer',
    'open-situation-work-reducer', 'open-stage-close-reducer', 'open-terminal-gates-reducer', 'runtime',
    'runtime-branch', 'runtime-event-reducer', 'open-session-situation-reducer',
    'open-entity-reducer',
    'open-audio-reducer', 'open-voice-request-reducer', 'open-audio-media',
  ],
} as const

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
  // The governed text-adventure production contracts are shared by the
  // scheduler, executor and player-facing package verifier. Keep their large
  // parsers/assemblers in one cacheable async chunk instead of folding them
  // into the already substantial generic production executor route chunk.
  if (/\/src\/lib\/adventure\/(?:dialogue-pass|language-quality|media-composition|narrative-location-plan|production-artifacts(?:-v2)?|production-brief|quality-analysis|scene-script)\.ts$/.test(id)) {
    return 'text-adventure-production-contracts'
  }
  if (id.endsWith('/src/lib/product-production/text-adventure-quality.ts')) {
    return 'text-adventure-production-contracts'
  }
  if (id.endsWith('/src/lib/product-production/product-quality.ts')) {
    return 'product-production-quality'
  }
  if (id.endsWith('/src/lib/product-production/compatibility.ts')) {
    return 'product-production-quality'
  }
  // All groups retain the standard scriptChunk size budget. AI/context and
  // author-production modules stay outside this deterministic replay closure.
  const ttrpgModule = id.match(/\/src\/lib\/ttrpg\/([^/]+)\.ts$/)?.[1]
  if (ttrpgModule) {
    for (const [group, names] of Object.entries(TTRPG_REPLAY_CHUNK_MODULES)) {
      if ((names as readonly string[]).includes(ttrpgModule)) return `runtime-domain-ttrpg-${group}`
    }
  }
  // The retired four-module open-world reducer is loaded only for immutable
  // legacy Releases. Do not make every vNext player parse that compatibility
  // implementation as part of the shared runtime foundation.
  if (id.endsWith('/src/lib/open-world/runtime.ts')) return 'runtime-domain-open-world-legacy'
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

export default defineConfig(({ mode }) => {
  const showcase = mode === 'showcase'
  return {
  // 冻结 E2E 工作区通过符号链接复用 node_modules，但必须使用自己的
  // Vite optimizer 缓存，避免与作者正在运行的预览互相改写预构建依赖。
  cacheDir: process.env.STORYFORGE_E2E_SNAPSHOT === '1'
    ? '.vite-e2e-cache'
    : 'node_modules/.vite',
  define: {
    __STORYFORGE_BUILD_SHA__: JSON.stringify(resolveBuildSha()),
  },
  plugins: [
    ...(!showcase ? [localCodexPlugin()] : []),
    ...(!showcase ? [localTtsPlugin()] : []),
    ...(showcase ? [{
      name: 'storyforge-showcase-html',
      transformIndexHtml: {
        order: 'pre' as const,
        handler(html: string) {
          return html.replace('/src/main.tsx', '/src/entry.ts').replace(/<script>([\s\S]*?)<\/script>/g, '')
            .replace('</head>', '<script defer src="/site-metrics.js"></script></head>')
            .replace('<title>StoryForge / 故事熔炉</title>', '<title>项目体验版｜StoryForge 故事熔炉</title>')
            .replace('<div id="root"></div>', '<div id="root"><p>正在打开 StoryForge 项目体验版…</p></div><noscript><p>体验项目界面需要启用 JavaScript。<a href="/">返回官网</a></p></noscript><footer id="showcase-fallback-filing">北京悬象科技有限公司 · <a href="https://beian.miit.gov.cn/">京ICP备2026061833号-1</a> · <a href="https://beian.mps.gov.cn/#/query/webSearch?code=11011502040776">京公网安备11011502040776号</a></footer>')
        },
      },
    }] : []),
    { name: 'storyforge-base-redirect', configureServer: installBaseRedirect, configurePreviewServer: installBaseRedirect },
    react(),
    VitePWA({
      disable: showcase || mode === 'android',
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
        globIgnores: ['ui-preview/**', 'assets/ui-preview-*', 'demo-assets/last-letter/**'],
        navigateFallback: '/storyforge/index.html',
        navigateFallbackDenylist: [/^\/storyforge\/local-codex(?:\/|$)/, /^\/(?!storyforge)/, /^\/storyforge\/ui-preview(?:\/|$)/, /^\/storyforge\/demo-assets\/last-letter(?:\/|$)/],
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
    proxy: showcase ? {} : providerProxies,
  },
  build: {
    outDir: showcase ? 'dist-showcase' : mode === 'android' ? 'dist-android/storyforge' : 'dist',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      input: showcase ? { main: 'index.html' } : { main: 'index.html', 'ui-preview': 'ui-preview/index.html' },
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
  }
})
