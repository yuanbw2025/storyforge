import { defineConfig } from 'vitest/config'
import path from 'path'

const originalCoverageIncludes = [
  'src/lib/registry/**/*.ts',
  'src/lib/db/**/*.ts',
  'src/lib/export/**/*.ts',
  'src/lib/import/**/*.ts',
  'src/lib/ai/adapters/**/*.ts',
  'src/lib/ai/*.ts',
]

const originalGlobalThresholds = { lines: 58, functions: 50, statements: 58, branches: 60 }
// Initial risk-scope floors set before measurement, matching the existing AI floor.
const riskScopeThresholds = { lines: 50, functions: 40, statements: 50, branches: 50 }
const coverageScope = (files: readonly string[]) => `{${files.join(',')}}`
const riskScopes = [
  [ // Harness: identity, durable events, recovery and receipts.
    'src/lib/agent/run/contract.ts',
    'src/lib/agent/run/checkpoint.ts',
    'src/lib/agent/run/context-manifest.ts',
    'src/lib/agent/run/event-schema.ts',
    'src/lib/agent/run/event-store.ts',
    'src/lib/agent/run/projection.ts',
    'src/lib/agent/run/verification-receipt.ts',
    'src/lib/agent/run/creation-response-evidence.ts',
  ],
  [ // Production: author commands, budget/epoch, settlement and recovery.
    'src/lib/product-production/artifact-store.ts',
    'src/lib/product-production/commands.ts',
    'src/lib/product-production/plan.ts',
    'src/lib/product-production/recovery-policy.ts',
    'src/lib/product-production/scheduler.ts',
    'src/lib/product-production/task-evidence.ts',
  ],
  [ // Runtime: owner/source authority, event head, branches and media.
    'src/lib/product/runtime-core.ts',
    'src/lib/product/runtime-instances.ts',
    'src/lib/product/runtime-branch-lineage.ts',
    'src/lib/product/runtime-source-authority.ts',
    'src/lib/product/runtime-source-manifest.ts',
    'src/lib/product/runtime-media-library.ts',
  ],
]

/**
 * Vitest 配置
 *
 * - 环境:happy-dom(纯前端项目,需要 DOM API)
 * - IndexedDB:由 tests/setup.ts 加载 fake-indexeddb
 * - 别名:与 vite.config.ts 一致(@ 指向 src)
 * - 覆盖率:v8,按既有核心层和明确的高风险入口分域校验
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./tests/setup.ts'],
    // GitHub's shared runner is materially slower than local development under
    // the instrumented coverage workload. Preserve the fast local feedback budget,
    // while giving ordinary deterministic DB tests enough room in CI before a
    // genuine hang is reported.
    testTimeout: process.env.CI ? 20_000 : 5_000,
    // The suite contains several CPU-heavy 100/1000-step deterministic
    // simulations, IndexedDB lifecycles, long replays and UI cases. Capping
    // file workers prevents timer starvation and non-reproducible timeouts on
    // high-core developer machines without weakening individual test limits.
    maxWorkers: 4,
    include: [
      'tests/**/*.test.ts',
      'tests/**/*.test.tsx',
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      // New scopes list executable entry files only. Prompts, declaration-only
      // modules and UI are outside this increment.
      include: [...originalCoverageIncludes, ...riskScopes.flat()],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/lib/world-map/**',      // 纯视觉地图渲染算法
        'src/lib/ai/client.ts',      // 真实网络请求,需 E2E
        'src/lib/ai/prompt-seed*.ts',
        'src/lib/ai/prompt-seeds*.ts',
        'src/lib/ai/writing-styles.ts', // 大型静态声明不能抬高运行时代码覆盖率
        'src/**/*.d.ts',
      ],
      thresholds: {
        // 静态 Prompt 数据已排除；门槛约束真实 parser/runner/import/registry 运行时代码。
        ...originalGlobalThresholds,
        // Vitest's global map includes all added files. Also keep the original
        // denominator independently gated so new coverage cannot mask old drift.
        [coverageScope(originalCoverageIncludes)]: originalGlobalThresholds,
        ...Object.fromEntries(riskScopes.map(files => [coverageScope(files), riskScopeThresholds])),
        // 注册表是地基(单一事实源),要求更高
        'src/lib/registry/**/*.ts': {
          lines: 75,
          functions: 70,
          statements: 75,
          branches: 70,
        },
        'src/lib/ai/**/*.ts': {
          lines: 50,
          functions: 40,
          statements: 50,
          branches: 50,
        },
        'src/lib/import/**/*.ts': {
          lines: 35,
          functions: 35,
          statements: 35,
          branches: 55,
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
