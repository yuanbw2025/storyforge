import { IS_SHOWCASE } from './lib/showcase/policy'
import { installRuntimeDiagnostics, recordRuntimeDiagnosticError } from './lib/diagnostics/runtime-errors'
import { failureFeedbackLink } from './lib/diagnostics/failure-summary'
import { buildFailureSummary } from './lib/diagnostics/build-failure-summary'

// Keep app/store imports behind the isolation boundary; static imports run too early.
async function start() {
  if (!IS_SHOWCASE) installRuntimeDiagnostics()
  if (IS_SHOWCASE) {
    const { installShowcaseBoundary } = await import('./lib/showcase/bootstrap')
    installShowcaseBoundary()
  }
  await import('./main')
}
void start().catch((error: unknown) => {
  if (!IS_SHOWCASE) recordRuntimeDiagnosticError(error, 'bootstrap')
  const root = document.getElementById('root')
  if (root) root.textContent = IS_SHOWCASE
    ? '无法打开体验空间。请允许本站使用浏览器存储后刷新，或返回官网获取本地版。'
    : 'StoryForge 加载失败，请刷新页面。作品数据没有被清理。'
  if (root && !IS_SHOWCASE) {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = '查看故障摘要并反馈'
    button.onclick = async () => {
      const link = document.createElement('a')
      link.href = 'https://docs.storyforge-lab.com/feedback/bug'
      link.target = '_blank'; link.rel = 'noopener noreferrer'
      link.textContent = '带摘要打开官方反馈表单（不会自动提交）'
      try {
        const report = await buildFailureSummary()
        const preview = document.createElement('pre')
        preview.textContent = JSON.stringify(report, null, 2)
        link.href = failureFeedbackLink(report)
        root.append(preview)
      } catch { link.textContent = '打开官方反馈表单（诊断摘要暂不可用）' }
      root.append(link); button.remove()
    }
    root.append(button)
  }
})
