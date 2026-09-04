import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import App from './App'
import ErrorBoundary from './components/shared/ErrorBoundary'
import { DialogProvider } from './components/shared/Dialog'
import { ToastProvider } from './components/shared/Toast'
import { usePromptStore } from './stores/prompt'
import { useWorkflowStore } from './stores/workflow'
import { openCurrentSchema } from './lib/db/ensure-schema'
import { validateRegistry } from './lib/registry/validate'
import { applyStoryForgeTheme, resolveStoryForgeTheme } from './lib/theme'
import { registerStoryForgeServiceWorker } from './lib/pwa/register-service-worker'
import { installRuntimeDiagnostics } from './lib/diagnostics/local-diagnostic-report'
import './index.css'

// 从当前主题闭集恢复；未知值回到默认主题。
applyStoryForgeTheme(resolveStoryForgeTheme(localStorage.getItem('storyforge-theme')))
registerStoryForgeServiceWorker()
installRuntimeDiagnostics()

/**
 * FB-11 数据持久 · 启动期申请「持久化存储」。
 * 不申请时浏览器把 IndexedDB 当 best-effort,可在磁盘压力/关闭清理/隐私插件下
 * 直接驱逐整库 → 用户表现为"数据被重置"。persist() 在 Chrome 是静默授予(按使用度
 * 启发式,不弹窗),被拒或不支持都不影响主流程,故 fire-and-forget。
 */
async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persist) {
      const already = await navigator.storage.persisted()
      if (!already) {
        const granted = await navigator.storage.persist()
        console.info(`[bootstrap] persistent storage ${granted ? '已授予' : '未授予(浏览器启发式未满足,可稍后再试)'}`)
      }
    }
  } catch (e) {
    console.warn('[bootstrap] persist storage 申请失败(不影响运行):', e)
  }
}

async function bootstrap() {
  // 0. FB-11: 尽早申请持久化存储,降低 IndexedDB 被浏览器驱逐("重置")的概率。
  void requestPersistentStorage()

  // 0. 三注册表是启动硬门；不完整的读写与生命周期定义不得进入 UI。
  validateRegistry()

  // 1. 当前 schema 是应用启动硬门。任何其它数据库版本都必须停止启动，
  // 不能在打开失败后继续执行 Store 初始化并造成半可用界面。
  await openCurrentSchema()

  // 2. 初始化提示词模板（必要时 seed 系统模板）。
  try {
    await usePromptStore.getState().init()
  } catch (e) {
    console.error('[bootstrap] prompt store init failed:', e)
  }

  // 3. 初始化工作流（必要时 seed 系统工作流）。
  try {
    await useWorkflowStore.getState().init()
  } catch (e) {
    console.error('[bootstrap] workflow store init failed:', e)
  }

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <DialogProvider>
        <ErrorBoundary>
          <BrowserRouter basename="/storyforge">
            <ToastProvider>
              <App />
            </ToastProvider>
          </BrowserRouter>
        </ErrorBoundary>
      </DialogProvider>
    </React.StrictMode>,
  )
}

void bootstrap().catch((error: unknown) => {
  console.error('[bootstrap] application startup blocked:', error)
  const message = error instanceof Error ? error.message : String(error)
  const root = document.getElementById('root')
  if (!root) return
  ReactDOM.createRoot(root).render(
    <main className="min-h-screen bg-bg-base p-8 text-text-primary" role="alert">
      <div className="mx-auto max-w-2xl rounded-xl border border-error/40 bg-bg-surface p-6">
        <h1 className="text-lg font-semibold text-error">StoryForge 无法启动</h1>
        <p className="mt-3 text-sm leading-6">
          当前版本只支持由当前架构创建的数据，应用已在任何 Store 初始化之前停止。
        </p>
        <pre className="mt-4 overflow-auto rounded bg-bg-elevated p-3 text-xs">{message}</pre>
      </div>
    </main>,
  )
})
