import { useCallback, useEffect, useState } from 'react'
import { useAIConfigStore } from '../../stores/ai-config'
import { codexRequest, isLocalCodexHost, type CodexModel, type CodexReceipt, type CodexStatus } from '../../lib/ai/codex-transport'

export default function CodexConnectionCard() {
  const model = useAIConfigStore(s => s.config.model)
  const setConfig = useAIConfigStore(s => s.setConfig)
  const [status, setStatus] = useState<CodexStatus | null>(null)
  const [models, setModels] = useState<CodexModel[]>([])
  const [records, setRecords] = useState<CodexReceipt[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loginUrl, setLoginUrl] = useState('')
  const [disconnected, setDisconnected] = useState(false)
  const refresh = useCallback(async () => {
    setBusy(true); setError(''); setDisconnected(false)
    try {
      const account = await codexRequest<CodexStatus>('/status')
      setStatus(account)
      const recent = await codexRequest<{ records: CodexReceipt[] }>('/requests')
      setRecords(recent.records)
      if (account.state === 'ready') {
        setLoginUrl('')
        setModels((await codexRequest<{ models: CodexModel[] }>('/models')).models)
      } else setModels([])
    } catch (e) { setStatus(null); setModels([]); setError(e instanceof Error ? e.message : '连接失败') }
    finally { setBusy(false) }
  }, [])
  useEffect(() => { if (isLocalCodexHost()) void refresh() }, [refresh])
  async function action(kind: 'login' | 'disconnect') {
    setBusy(true); setError('')
    try {
      if (kind === 'login') {
        const { url } = await codexRequest<{ url: string }>('/login', {})
        setLoginUrl(url)
      } else {
        await codexRequest('/disconnect', {})
        setDisconnected(true); setStatus(null); setLoginUrl(''); setRecords([])
      }
    } catch (e) { setError(e instanceof Error ? e.message : '操作失败') }
    finally { setBusy(false) }
  }
  const button = 'rounded border border-border px-3 py-1.5 text-xs hover:border-accent disabled:opacity-40'
  return <section aria-label="Codex 本机连接" className="space-y-3 rounded-lg border border-border bg-bg-base p-4 text-sm text-text-secondary">
    <p className="font-medium text-text-primary">复用本机 Codex 登录</p>
    <p className="text-xs">已在本机 Codex 使用 ChatGPT 登录时，通常无需再次登录。StoryForge 会检测实际登录状态；仅用 Codex 打开项目不会自动建立连接。请求消耗你的 Codex 套餐额度，额度不足时停止，不会切换付费 API。</p>
    {!isLocalCodexHost() ? <p role="status">请在本机启动 StoryForge（npm run dev，或构建后 npm run preview）。保持原来的浏览器地址和端口；不同地址不会共享本地手稿。</p> : <>
      <p role="status">{busy ? '正在连接…' : disconnected ? '连接已停止；本机 Codex 账号仍保持登录。下次检测或生成时会重新连接。' : status?.state === 'ready' ? `已登录：${status.label} · ${status.plan || 'ChatGPT'}${status.version ? ` · ${status.version}` : ''}` : status?.state === 'wrong-auth' ? status.message : status?.state === 'login-required' ? '未检测到 ChatGPT 登录。请使用本机 Codex 登录，或点击下方官方登录入口。' : '尚未连接'}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={button} disabled={busy} onClick={() => void refresh()}>检测连接 / 刷新模型与记录</button>
        {status && status.state !== 'ready' && <button type="button" className={button} disabled={busy} onClick={() => void action('login')}>使用 ChatGPT 登录</button>}
        {status?.state === 'ready' && <button type="button" className={button} disabled={busy} onClick={() => void action('disconnect')}>停止连接</button>}
      </div>
      {loginUrl && <p><a href={loginUrl} target="_blank" rel="noreferrer" className="text-accent underline">打开 OpenAI 官方登录页</a>；完成后点击“检测连接”。登录由本机 Codex 管理，可能影响其当前登录账号。</p>}
      <label className="block">Codex 模型
        <select aria-label="Codex 模型" className="mt-1 w-full rounded border border-border bg-bg-surface p-2" value={model} onChange={e => setConfig({ model: e.target.value })}>
          <option value="">请选择本机目录中的模型</option>
          {model && !models.some(m => m.id === model) && <option value={model}>{model}（待验证）</option>}
          {models.map(m => <option key={m.id} value={m.id}>{m.label} · {m.id}{m.isDefault ? '（Codex 默认）' : ''}</option>)}
        </select>
      </label>
      <p className="text-xs text-text-muted">仅支持文本生成和结构化候选，暂不支持带 API 金额统计的模型评测。文件、终端、搜索及外部工具均禁用。温度和 API 输出 token 上限不适用于此连接；上下文预算仍由 StoryForge 控制。单次最长 20 分钟，同一服务顺序处理请求，最多排队 32 条。</p>
      {records.length > 0 && <details>
        <summary className="cursor-pointer">最近请求（本机保留 24 小时，最多 100 条）</summary>
        <p className="my-2 text-xs">刷新页面或断线后先检查此处，避免重复生成。这里是传输记录；复制的内容仍需按原创作流程审查和采纳。</p>
        <div className="max-h-96 space-y-2 overflow-auto">{records.map(r => <article key={r.id} className="rounded border border-border p-2 text-xs">
          <p>{new Date(r.createdAt).toLocaleString()} · {r.model} · {({ accepted: '准备中', running: '生成中', completed: '已完成', failed: '未发送 / 失败', cancelled: '已取消', unknown: '结果未知' })[r.status]}</p>
          <p className="break-all text-text-muted">{r.id}</p>
          {r.error && <p>{r.error}</p>}
          {['accepted', 'running'].includes(r.status) && <button type="button" className={button} onClick={() => { void codexRequest(`/requests/${r.id}/cancel`, {}).then(refresh).catch(e => setError(String(e))) }}>取消请求</button>}
          {r.text && <details><summary>查看未采纳的返回内容</summary><textarea readOnly aria-label="Codex 请求返回内容" value={r.text} className="mt-1 h-32 w-full rounded bg-bg-surface p-2" /></details>}
        </article>)}</div>
      </details>}
    </>}
    {error && <p role="alert" className="text-red-400">{error}</p>}
  </section>
}
