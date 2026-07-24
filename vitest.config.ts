import { defineConfig } from 'vitest/config'
import path from 'path'

/**
 * Vitest 配置
 *
 * - 环境:happy-dom(纯前端项目,需要 DOM API)
 * - IndexedDB:由 tests/setup.ts 加载 fake-indexeddb
 * - 别名:与 vite.config.ts 一致(@ 指向 src)
 * - 覆盖率:v8,目标 60%(关键模块 80%)
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./tests/setup.ts'],
    include: [
      'tests/**/*.test.ts',
      'tests/**/*.test.tsx',
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      // 覆盖率聚焦【核心业务逻辑层】:数据/注册表/AI 解析与装配。
      // 排除 UI 层(components/pages/hooks)与纯视觉(world-map 渲染)——
      // 纯前端 UI 单测成本极高、价值低,业界惯例是对核心逻辑设高门槛、UI 用 E2E 另测。
      include: [
        'src/lib/registry/**/*.ts',
        'src/lib/db/**/*.ts',
        'src/lib/export/**/*.ts',
        'src/lib/import/**/*.ts',
        'src/lib/ai/adapters/**/*.ts',
        'src/lib/ai/*.ts',
      ],
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
        lines: 58,
        functions: 50,
        statements: 58,
        branches: 60,
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
