import { useState } from 'react'
import { buildFailureSummary } from '../../lib/diagnostics/build-failure-summary'
import { failureFeedbackLink, FAILURE_FEEDBACK_URL, type FailureSummary } from '../../lib/diagnostics/failure-summary'
import { resetRuntimeDiagnostics } from '../../lib/diagnostics/runtime-errors'

/** Works without a Router, project, database, or global dialog provider. */
export default function FailureFeedbackPanel() {
  const [report, setReport] = useState<FailureSummary | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const prepare = async () => {
    setBusy(true); setMessage('')
    try { setReport(await buildFailureSummary()) }
    catch { setMessage('诊断摘要暂不可用，仍可打开官方反馈页手动填写。') }
    finally { setBusy(false) }
  }
  return <section className="mt-5 w-full max-w-3xl rounded-xl border border-border bg-bg-surface p-4 text-left" aria-label="问题与故障反馈">
    <h3 className="text-sm font-semibold text-text-primary">问题与故障反馈</h3>
    <p className="mt-2 text-xs leading-6 text-text-muted">遇到 Bug、页面报错或启动失败，可以先查看诊断摘要再反馈。浏览器允许存储时，最近 7 天最多 20 条错误留在本机；空间或权限不足时只保留当前会话。不会自动发送，也不读取手稿、提示词、API Key 或完整浏览记录。</p>
    <div className="mt-3 flex flex-wrap gap-3 text-sm">
      <button type="button" disabled={busy} onClick={() => void prepare()} className="rounded border border-border px-3 py-2 disabled:opacity-50">{busy ? '正在整理…' : '查看故障摘要并反馈'}</button>
      <a href={FAILURE_FEEDBACK_URL} target="_blank" rel="noopener noreferrer" className="rounded border border-border px-3 py-2">直接反馈问题</a>
      <button type="button" onClick={() => { resetRuntimeDiagnostics(); setReport(null); setMessage('浏览器中的本地错误记录已清空；作品和模型配置未改变。') }} className="rounded border border-border px-3 py-2">清空本地错误记录</button>
    </div>
    {message && <p role="status" className="mt-3 text-xs text-text-muted">{message}</p>}
    {report && <div className="mt-4 space-y-3 text-xs leading-6">
      <p>下面是将带到官方反馈表单的技术摘要。表单不会自动提交；请补充复现步骤，检查并删除不想公开的内容，确认后再发送。反馈将进入项目公开 Issue。</p>
      <pre aria-label="故障摘要预览" className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-bg-base p-3">{JSON.stringify(report, null, 2)}</pre>
      {report.launcher?.kind === 'interrupted' && <p>上次启动器可能未正常结束，也可能是断电或强制关闭；记录时间是本次检测时间，不是已知的崩溃时刻，也不证明发生了程序崩溃。</p>}
      <a href={failureFeedbackLink(report)} target="_blank" rel="noopener noreferrer" className="inline-block rounded bg-accent px-3 py-2 text-white">带摘要打开官方反馈表单</a>
    </div>}
  </section>
}
