import FeedbackInbox from './FeedbackInbox'
import { createFeedbackToken } from '../../lib/feedback/followup-storage'
import { useRef, useState } from 'react'
import { buildFailureSummary } from '../../lib/diagnostics/build-failure-summary'
import type { FailureSummary } from '../../lib/diagnostics/failure-summary'
import { clientMetadata, feedbackDiagnostics, submitClientFeedback, type ClientFeedback } from '../../lib/feedback/client-support'
import { feedbackImageBytes, MAX_FEEDBACK_IMAGES, MAX_FEEDBACK_TOTAL_BYTES, readFeedbackImage, type FeedbackImage } from '../../lib/feedback/attachments'

type Kind = ClientFeedback['kind']
const emptyDraft = () => ({ title: '', description: '', steps: '', expected: '', module: '', browser: '', actual: '', model: '', requestType: '功能改进', workflow: '', workaround: '', references: '', extra: '', attachments: [] as FeedbackImage[] })
const control = 'mt-1 w-full rounded border border-border bg-bg-base p-2'
const button = 'rounded border border-border px-3 py-2 disabled:opacity-50'
export default function FailureFeedbackPanel() {
  const [kind, setKind] = useState<Kind>('bug')
  const [open, setOpen] = useState(false)
  const [followupChoices, setFollowupChoices] = useState({ bug: false, feature: false })
  const wantsFollowup = followupChoices[kind]
  const [drafts, setDrafts] = useState({ bug: emptyDraft(), feature: emptyDraft() })
  const draft = drafts[kind]
  const update = (value: Partial<ReturnType<typeof emptyDraft>>) => setDrafts(current => ({ ...current, [kind]: { ...current[kind], ...value } }))
  const [report, setReport] = useState<FailureSummary | null>(null)
  const [busy, setBusy] = useState(false)
  const [includeDiagnostics, setIncludeDiagnostics] = useState(false)
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [reading, setReading] = useState(false)
  const locked = useRef(false)
  const readingFiles = useRef(false)
  const preparing = useRef(false)
  const submission = useRef<Partial<Record<Kind, { signature: string; body: ClientFeedback }>>>({})
  const show = (next: Kind) => { if (locked.current || readingFiles.current) return; setKind(next); setOpen(true); setMessage('') }
  const prepare = async () => {
    if (locked.current || preparing.current) return
    preparing.current = true
    setKind('bug'); setOpen(true); setBusy(true); setMessage('正在整理本机故障摘要…')
    try {
      const summary = await buildFailureSummary()
      setReport(summary); setIncludeDiagnostics(true)
      setMessage(summary.errors.length ? `已整理 ${summary.errors.length} 条错误记录，请查看表单内的故障摘要预览。` : '故障摘要已生成，目前没有本地错误记录；仍可填写并报告 Bug。')
    } catch { setMessage('故障摘要生成失败。可以重试整理，也可以直接填写 Bug；表单内容已保留。') }
    finally { preparing.current = false; setBusy(false) }
  }
  const addImages = async (files: File[]) => {
    if (!files.length || locked.current || readingFiles.current) return
    readingFiles.current = true; setReading(true); setMessage('')
    const target = kind
    try {
      if (draft.attachments.length + files.length > MAX_FEEDBACK_IMAGES) throw new Error('最多附带 3 张截图。')
      if (draft.attachments.reduce((sum, row) => sum + feedbackImageBytes(row), 0) + files.reduce((sum, file) => sum + file.size, 0) > MAX_FEEDBACK_TOTAL_BYTES) throw new Error('截图合计不能超过 4 MB。')
      const images = await Promise.all(files.map((file, i) => readFeedbackImage(file, draft.attachments.length + i)))
      setDrafts(current => ({ ...current, [target]: { ...current[target], attachments: [...current[target].attachments, ...images] } }))
      setMessage('截图已添加到本机草稿，提交反馈时才会发送。')
    } catch (error) { setMessage(error instanceof Error ? error.message : '截图读取失败，原有草稿已保留。') }
    finally { readingFiles.current = false; setReading(false) }
  }
  const send = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (locked.current || readingFiles.current || preparing.current || !event.currentTarget.reportValidity()) return
    locked.current = true; setSending(true); setMessage('')
    const { title, description, steps, expected, attachments, ...details } = draft
    const contents = { kind, title: title.trim(), description: description.trim(), steps: kind === 'bug' ? steps.trim() : '', expected: expected.trim(), details: { ...details, requestType: kind === 'feature' ? details.requestType : '' },
      client: clientMetadata(), ...(attachments.length ? { attachments } : {}),
      ...(kind === 'bug' && includeDiagnostics && report ? { diagnostics: feedbackDiagnostics(report.errors) } : {}) }
    const signature = JSON.stringify({ contents, wantsFollowup })
    if (submission.current[kind]?.signature !== signature) submission.current[kind] = { signature, body: { version: 1, id: crypto.randomUUID(), ...contents, ...(wantsFollowup ? { followup: { token: createFeedbackToken() } } : {}) } }
    try {
      const receipt = await submitClientFeedback(submission.current[kind]!.body)
      setMessage(`提交成功，回执编号：${receipt}。反馈${attachments.length ? `和 ${attachments.length} 张截图` : ''}已进入维护者收件箱。`)
      setDrafts(current => ({ ...current, [kind]: emptyDraft() }))
      setOpen(false)
      if (kind === 'bug') { setReport(null); setIncludeDiagnostics(false) }
      setFollowupChoices(current => ({ ...current, [kind]: false }))
      delete submission.current[kind]
    } catch (error) { setMessage(error instanceof Error && !['TimeoutError', 'TypeError'].includes(error.name) ? error.message : '网络中断或超时，提交结果未确认。内容与截图已保留，可以用同一编号重试。') }
    finally { locked.current = false; setSending(false) }
  }
  const disabled = sending || reading || busy
  return <section className="mt-5 w-full max-w-3xl rounded-xl border border-border bg-bg-surface p-4 text-left" aria-label="问题与故障反馈">
    <h3 className="text-sm font-semibold text-text-primary">问题与建议</h3>
    <p className="mt-2 text-[13px] leading-6 text-text-muted">报告 Bug 或提出功能建议。反馈由维护者私下处理，保存 90 天。请检查文字与截图，移除手稿、API Key 和其他私人信息。只有点击“提交反馈”才会发送本表单。</p>
    <div className="mt-3 flex flex-wrap gap-3 text-sm">
      <button type="button" disabled={disabled} onClick={() => show('bug')} className={button}>报告 Bug</button>
      <button type="button" disabled={disabled} onClick={() => show('feature')} className={button}>功能建议</button>
      <button type="button" disabled={disabled} onClick={() => void prepare()} className={button}>{busy ? '正在整理故障摘要…' : '查看故障摘要并反馈'}</button>
    </div>
    <div className="mt-3"><FeedbackInbox /></div>
    {message && <p role="status" aria-live="polite" className="mt-3 text-[13px] text-text-muted">{message}</p>}
    {open && <form onSubmit={event => void send(event)} onPaste={event => {
      const images = [...event.clipboardData.items].filter(item => item.kind === 'file' && item.type.startsWith('image/')).map(item => item.getAsFile()).filter((file): file is File => !!file)
      if (images.length) { event.preventDefault(); void addImages(images) }
    }} className="mt-4 space-y-3 text-sm" aria-label={kind === 'bug' ? '报告 Bug 表单' : '功能建议表单'} aria-busy={disabled}>
      <fieldset disabled={disabled} className="space-y-3">
        <legend className="font-medium">{kind === 'bug' ? '报告 Bug' : '功能建议'}</legend>
        <label className="block">标题<input aria-label="标题" required minLength={2} maxLength={160} value={draft.title} onChange={event => update({ title: event.target.value })} className={control} /></label>
        <label className="block">涉及模块<input aria-label="涉及模块" required maxLength={120} placeholder="例如：世界引擎 / 自然地理" value={draft.module} onChange={event => update({ module: event.target.value })} className={control} /></label>
        {kind === 'feature' && <label className="block">建议类型<select aria-label="建议类型" value={draft.requestType} onChange={event => update({ requestType: event.target.value })} className={control}><option>功能改进</option><option>新增功能</option><option>体验优化</option><option>其他</option></select></label>}
        <label className="block">{kind === 'bug' ? '问题描述' : '建议与使用场景'}<textarea aria-label={kind === 'bug' ? '问题描述' : '建议与使用场景'} required minLength={5} maxLength={5000} rows={4} value={draft.description} onChange={event => update({ description: event.target.value })} className={control} /></label>
        {kind === 'bug' && <>
          <label className="block">复现步骤或触发场景<textarea aria-label="复现步骤或触发场景" required maxLength={3000} rows={3} placeholder="无法稳定复现时，请描述发生前的操作。" value={draft.steps} onChange={event => update({ steps: event.target.value })} className={control} /></label>
          <label className="block">实际结果<textarea aria-label="实际结果" required maxLength={2000} rows={2} value={draft.actual} onChange={event => update({ actual: event.target.value })} className={control} /></label>
          <label className="block">浏览器及版本（可选）<input aria-label="浏览器及版本（可选）" maxLength={120} value={draft.browser} onChange={event => update({ browser: event.target.value })} className={control} /></label>
          <label className="block">模型名称（可选，请勿填写密钥或服务地址）<input aria-label="模型名称（可选，请勿填写密钥或服务地址）" maxLength={160} value={draft.model} onChange={event => update({ model: event.target.value })} className={control} /></label>
        </>}
        <label className="block">{kind === 'bug' ? '期望结果' : '希望怎样改进'}<textarea aria-label={kind === 'bug' ? '期望结果' : '希望怎样改进'} required maxLength={2000} rows={2} value={draft.expected} onChange={event => update({ expected: event.target.value })} className={control} /></label>
        {kind === 'feature' && <details><summary>更多背景（可选）</summary>{(['workflow', 'workaround', 'references'] as const).map((key, i) => <label key={key} className="mt-2 block">{['期望的使用方式', '目前的替代办法', '参考产品或案例'][i]}<textarea aria-label={['期望的使用方式', '目前的替代办法', '参考产品或案例'][i]} maxLength={2000} rows={2} value={draft[key]} onChange={event => update({ [key]: event.target.value })} className={control} /></label>)}</details>}
        <label className="block">补充信息（可选）<textarea aria-label="补充信息（可选）" maxLength={2000} rows={2} value={draft.extra} onChange={event => update({ extra: event.target.value })} className={control} /></label>
        <div className="space-y-2">
          <label className="block">截图（可选，可在表单中粘贴图片）<input aria-label="截图（可选，可在表单中粘贴图片）" type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple onChange={event => { void addImages([...event.target.files ?? []]); event.target.value = '' }} className={control} /></label>
          <p className="text-[13px] text-text-muted">最多 3 张，单张 2 MB，合计 4 MB。选择或粘贴后可预览、移除；取消会保留本页草稿。</p>
          <ul className="flex flex-wrap gap-3">{draft.attachments.map((image, index) => <li key={index} className="max-w-44 rounded border border-border p-2"><img src={`data:${image.mime};base64,${image.data}`} alt={`待发送截图 ${index + 1}`} className="max-h-32 max-w-full object-contain" /><button type="button" className={button} onClick={() => update({ attachments: draft.attachments.filter((_, i) => i !== index) })} aria-label={`移除截图 ${index + 1}`}>移除</button></li>)}</ul>
        </div>
        {kind === 'bug' && <>
          <label className="flex items-center gap-2"><input type="checkbox" checked={includeDiagnostics} onChange={event => { setIncludeDiagnostics(event.target.checked); if (event.target.checked && !report) void prepare() }} />附带下方预览的脱敏错误记录</label>
          {report && <div className="space-y-2 text-[13px] leading-6"><p>{report.errors.length ? `共 ${report.errors.length} 条本地错误记录。` : '没有本地错误记录。'}预览中的启动器信息仅用于本机查看；反馈附带所选错误记录。</p><pre aria-label="故障摘要预览" className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-bg-base p-3">{JSON.stringify(report, null, 2)}</pre>{report.launcher?.kind === 'interrupted' && <p>启动器可能被断电或强制关闭；检测时间不能证明崩溃发生的时刻。</p>}</div>}
        </>}
        <p className="text-[13px] text-text-muted">自动附带应用版本、操作系统类别和客户端类型。</p>
        <label className="block"><input type="checkbox" checked={wantsFollowup} onChange={event => setFollowupChoices(current => ({ ...current, [kind]: event.target.checked }))} />接收本条反馈的处理进展</label>
        <p className="text-xs text-text-muted">选择后在本机保存独立跟进凭据，最长 90 天；下次打开应用可补收。不会开启自动错误上报，也不会把反馈原文放进通知。清除浏览器数据后无法自动找回旧凭据。</p>
        <div className="flex flex-wrap gap-3"><button type="submit" disabled={includeDiagnostics && kind === 'bug' && !report} className="rounded bg-accent px-4 py-2 text-white disabled:opacity-50">{sending ? '正在提交…' : '提交反馈'}</button><button type="button" className={button} onClick={() => { setOpen(false); setMessage('已取消填写，本页草稿和截图已保留，未发送新的反馈。') }}>取消</button></div>
      </fieldset>
    </form>}
  </section>
}
