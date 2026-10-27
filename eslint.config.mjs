// ESLint 扁平配置(AUDIT-3 · §11.5 决策③)
//
// 策略:规则严重度仍按风险分 error/warn/off,但 npm script 使用 --max-warnings=0，
// 当前零 warning 基线进入 CI；新增 warning 也会阻断，防止观察期债务回潮。
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  {
    ignores: [
      'dist', 'dist-client-verification', 'dist-android', 'android', 'release', 'dist-showcase', 'dist-adventure-player', 'dev-dist', 'coverage', 'node_modules', '.vite-e2e-cache',
      '**/.vitepress/cache/**', '**/.vitepress/dist/**',
      '**/*.config.{js,ts,mjs,cjs}', 'scripts/**', 'public/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Historical Node diagnostic sources keep their original bytes and lint
    // rules; declare only the runtime globals those archived probes used.
    files: [
      'tests/acceptance/narrative-world/raw/nw2e-checkpoint-20261015-v6/nw2e-record-hash-probe.mjs',
      'tests/acceptance/narrative-world/raw/nw2e-checkpoint-20261015-v7/run.mjs',
    ],
    languageOptions: {
      globals: {
        performance: 'readonly', process: 'readonly', console: 'readonly',
        TextEncoder: 'readonly', URL: 'readonly',
      },
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        window: 'readonly', document: 'readonly', navigator: 'readonly',
        console: 'readonly', fetch: 'readonly', localStorage: 'readonly',
        sessionStorage: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly',
        setInterval: 'readonly', clearInterval: 'readonly', Blob: 'readonly',
        URL: 'readonly', crypto: 'readonly', indexedDB: 'readonly',
      },
    },
    rules: {
      // ── 高价值:保持 error ──
      'react-hooks/rules-of-hooks': 'error',

      // ── 观察期降噪(项目现状,先 warn / off,后续收紧)──
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-explicit-any': 'off', // 纯前端 Dexie/动态结构大量 as any,本就需要
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_',
      }],
      '@typescript-eslint/no-empty-object-type': 'warn',
      '@typescript-eslint/no-unsafe-function-type': 'warn',
      'no-empty': 'warn',
      'no-constant-condition': 'warn',
      'no-useless-escape': 'warn',
      'prefer-const': 'warn',
      'no-control-regex': 'off',
      'no-irregular-whitespace': 'warn', // 中文项目偶有全角空格,观察期 warn
      '@typescript-eslint/no-unused-expressions': 'warn',
      '@typescript-eslint/ban-ts-comment': 'warn',
    },
  },
)
