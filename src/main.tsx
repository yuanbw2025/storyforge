import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import ErrorBoundary from './components/shared/ErrorBoundary'
import { ToastProvider } from './components/shared/Toast'
import { usePromptStore } from './stores/prompt'
import { useWorkflowStore } from './stores/workflow'
import { ensureSchema, REQUIRED_TABLES_V26 } from './lib/db/ensure-schema'
import { validateRegistry } from './lib/registry/validate'
import { migrateMasterDataToReferences } from './lib/reference-analysis/migrate-master-data'
import './index.css'

// 从 localStorage 恢复主题（兼容旧主题名迁移）
let savedTheme = localStorage.getItem('storyforge-theme') || 'forge'
const THEME_MIGRATE: Record<string, string> = {
  work: 'forge', midnight: 'forge', ocean: 'forge', graphite: 'forge',
  mist: 'paper', parchment: 'paper',
}
if (THEME_MIGRATE[savedTheme]) {
  savedTheme = THEME_MIGRATE[savedTheme]
  localStorage.setItem('storyforge-theme', savedTheme)
}
document.documentElement.setAttribute('data-theme', savedTheme)

async function bootstrap() {
  // 0. Phase 1.1b: 注册表完整性校验。开发环境 throw(立刻发现漏登记),生产环境只告警。
  try {
    validateRegistry({ throwOnError: import.meta.env.DEV })
  } catch (e) {
    console.error('[bootstrap] registry validation failed:', e)
  }

  // 1. Schema 健康自检：开发环境可自动 reset，生产环境绝不自动删库。
  try {
    await ensureSchema(REQUIRED_TABLES_V26, { allowReset: import.meta.env.DEV })
  } catch (e) {
    console.error('[bootstrap] schema check failed:', e)
  }

  // 2. Phase 1：初始化提示词模板（必要时 seed 系统模板）
  try {
    await usePromptStore.getState().init()
  } catch (e) {
    console.error('[bootstrap] prompt store init failed:', e)
  }

  // 3. Phase 16：初始化工作流（必要时 seed 系统工作流）
  try {
    await useWorkflowStore.getState().init()
  } catch (e) {
    console.error('[bootstrap] workflow store init failed:', e)
  }

  // 4. Phase 20：迁移作品学习数据到项目参考（一次性，幂等）
  try {
    await migrateMasterDataToReferences()
  } catch (e) {
    console.error('[bootstrap] master→ref migration failed:', e)
  }

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ErrorBoundary>
        <BrowserRouter basename="/storyforge">
          <ToastProvider>
            <App />
          </ToastProvider>
        </BrowserRouter>
      </ErrorBoundary>
    </React.StrictMode>,
  )
}

bootstrap()
