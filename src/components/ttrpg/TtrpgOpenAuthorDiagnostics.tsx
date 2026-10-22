import { useEffect, useRef, useState } from 'react'
import type { WorkspaceScope } from '../../lib/types'
import { downloadTextFile } from '../../lib/export/text-export'
import { listTtrpgOpenAuthorPlaytestsV1, readTtrpgOpenAuthorDiagnosticsV1,
  exportTtrpgOpenAuthorDiagnosticsV1, draftTtrpgOpenAuthorRevisionV1,
  type TtrpgOpenAuthorDiagnosticsV1 } from '../../lib/ttrpg/open-author-diagnostics'

export default function TtrpgOpenAuthorDiagnostics({ scope, productionId, onRevisionDraft }: {
  scope: WorkspaceScope; productionId: number; onRevisionDraft: (text: string) => boolean
}) {
  const [sessions,setSessions] = useState<Awaited<ReturnType<typeof listTtrpgOpenAuthorPlaytestsV1>> | null>(null)
  const [sessionId,setSessionId] = useState<number | null>(null)
  const [diagnostics,setDiagnostics] = useState<TtrpgOpenAuthorDiagnosticsV1 | null>(null)
  const [busy,setBusy] = useState(false), [error,setError] = useState(''), [notice,setNotice] = useState('')
  const generation = useRef({ value: 0 }).current
  useEffect(() => {
    generation.value++;setSessions(null);setSessionId(null);setDiagnostics(null);setError('');setNotice('');setBusy(false)
    return () => { generation.value++ }
  }, [scope.projectId,scope.worldId,scope.workId,productionId,generation])
  async function run(action: (current: () => boolean) => Promise<void>) {
    const token = ++generation.value, current = () => generation.value === token
    setBusy(true);setError('');setNotice('')
    try { await action(current) } catch (e) { if (current()) setError(String(e)) }
    finally { if (current()) setBusy(false) }
  }
  const locator = sessionId === null ? null : { scope,productionId,sessionId }
  return <section className="lf-paper" data-testid="ttrpg-open-author-diagnostics">
    <h3>试玩诊断与修订</h3>
    <p>仅检查本作品实际制作版本的试玩。诊断包含角色各自的质量门依据，请由作者保管。导入的游玩副本不提供完整作者诊断。</p>
    <button className="lf-action" disabled={busy} onClick={() => void run(async current => {
      setDiagnostics(null);setSessionId(null)
      const rows = await listTtrpgOpenAuthorPlaytestsV1({ scope,productionId })
      if (current()) { setSessions(rows);setSessionId(rows[0]?.sessionId ?? null) }
    })}>读取本作品的试玩记录</button>
    {sessions?.length === 0 && <p>没有属于本作品的开放跑团试玩记录。</p>}
    {Boolean(sessions?.length) && <>
      <label>选择试玩<select aria-label="作者诊断试玩记录" value={sessionId ?? ''} disabled={busy}
        onChange={e => { generation.value++;setSessionId(Number(e.target.value));setDiagnostics(null);setError('');setNotice('') }}>
        {sessions!.map(s => <option key={s.sessionId} value={s.sessionId}>{s.title} · 制作第 {s.buildNumber} 版 · {s.sourceKind === 'build' ? '制作预览' : '正式发布'}</option>)}
      </select></label>
      <button className="lf-action" disabled={busy || !locator} onClick={() => void run(async current => {
        if (!locator) return
        setDiagnostics(null)
        const result = await readTtrpgOpenAuthorDiagnosticsV1(locator)
        if (current()) setDiagnostics(result)
      })}>读取诊断</button>
    </>}
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {diagnostics && <>
      <p>制作第 {diagnostics.report.source.buildNumber} 版 · 世界回合 {diagnostics.report.worldTurn} · 记录 {diagnostics.report.head.sequence} · 阶段{diagnostics.report.stage.status === 'open' ? '进行中' : '已闭合'}</p>
      <details><summary>版本与来源</summary><pre>{JSON.stringify({ ...diagnostics.report.source, sessionKey: diagnostics.report.sessionKey, head: diagnostics.report.head },null,2)}</pre></details>
      {!diagnostics.report.latestEvaluations.length && <p>尚无实际质量门检查记录。读取诊断不会启动检查或推进游戏。</p>}
      {diagnostics.report.latestEvaluations.map(e => <article key={e.actorKey}>
        <h4>角色 {e.actorKey} 的最新检查</h4>
        <p>来源 {e.sourceRef.sessionKey}:{e.sourceRef.sequence}{e.inherited ? '（继承自父存档）' : ''}</p>
        <ul>{e.gates.map(g => <li key={g.key}><strong>{g.label}：{g.applicability === 'not-applicable' ? '不适用' : g.passed ? '通过' : '未通过'}</strong> · 连续失败 {g.consecutiveFailures} 次
          <details><summary>查看实际依据</summary><ul>{g.evidence.map((text,i) => <li key={i}>{text}</li>)}</ul><p>依据版本 {e.evaluationBasisHash}</p></details>
        </li>)}</ul>
        {e.requestAuthorReview.length > 0 && <p>连续失败已达到作者复核条件，请依据实际内容检查可行动路径。</p>}
      </article>)}
      {diagnostics.report.recoveries.map(r => <p key={`${r.sourceRef.sessionKey}:${r.sourceRef.sequence}`}>恢复 {r.recoveryKey}：{r.result}。{r.stopReason ?? r.reason ?? '已记录实际结果'} 来源 {r.sourceRef.sessionKey}:{r.sourceRef.sequence}。</p>)}
      {diagnostics.report.pendingOperations.map(o => <p key={o.operationKey}>待处理操作 {o.operationKey}：{o.status}，下一步 {o.nextStep?.kind ?? '等待确认'}。</p>)}
      <button className="lf-action" disabled={busy} onClick={() => void run(async current => {
        if (!locator) return
        const file = await exportTtrpgOpenAuthorDiagnosticsV1({ ...locator,expectedReceipt: diagnostics.receipt })
        if (current()) { downloadTextFile(file.content,file.filename,'application/json');setNotice('诊断已导出，包含全部检查和恢复历史。') }
      })}>导出诊断</button>
      <button className="lf-action" disabled={busy} onClick={() => void run(async current => {
        if (!locator) return
        const text = await draftTtrpgOpenAuthorRevisionV1({ ...locator,expectedReceipt: diagnostics.receipt })
        if (current()) {
          if (onRevisionDraft(text)) setNotice('已加入下方修订要求；检查并明确创建修订轮次后才开始新的制作。')
          else setError('现有修订要求加上诊断超过一万字。已保留原文，请导出诊断并整理修订要求。')
        }
      })}>加入修订要求</button>
      <p>诊断只记录已有证据，不自动修改作品、运行事实或授权窗口。</p>
    </>}
  </section>
}
