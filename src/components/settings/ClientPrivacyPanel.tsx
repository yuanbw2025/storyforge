import { ClientLegalDocuments } from './ClientAgreement'
import { useState } from 'react'
import { diagnosticContextEnabled, setDiagnosticContextEnabled } from '../../lib/diagnostics/operation-trail'

/** Extra operation context requires a separate, default-off choice. */
export default function ClientPrivacyPanel() {
  const [enabled, setEnabled] = useState(diagnosticContextEnabled)
  const [error, setError] = useState('')
  return <><ClientLegalDocuments /><section aria-label="增强故障诊断" className="mt-4 rounded-lg border border-border p-4 text-sm">
    <label><input type="checkbox" checked={enabled} onChange={event => {
      const value = event.target.checked
      if (setDiagnosticContextEnabled(value)) { setEnabled(value); setError('') }
      else { setEnabled(false); setError('无法保存诊断选择，当前会话已停止收集。') }
    }} /> 附带最近操作轨迹（可选，默认关闭）</label>
    <p className="mt-2 text-text-muted">开启后，故障摘要可附带最近 5 分钟最多 20 项页面类别、操作代号及技术错误分类。不会记录输入内容、按钮文字、作品名称、手稿、模型回复、网址或密钥。自动发送仍按原故障上报选择；关闭会清除轨迹。</p>
    {error && <p role="alert">{error}</p>}
  </section></>
}
