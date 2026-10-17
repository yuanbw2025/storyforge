import { useCallback, useEffect, useRef, useState } from 'react'
import { readTtrpgWorldPatchDeskV1, exportTtrpgWorldPatchCandidateV1, type TtrpgWorldPatchDeskInputV1 } from '../../lib/ttrpg/open-world-patch-service'
import { MAX_TTRPG_WORLD_PATCH_BYTES_V1, verifyTtrpgWorldPatchCandidateV1, type TtrpgWorldPatchCandidateV1 } from '../../lib/ttrpg/open-world-patch-contract'
import { downloadTextFile } from '../../lib/export/text-export'

type Desk = Awaited<ReturnType<typeof readTtrpgWorldPatchDeskV1>>
/** A reversible file handoff. Choosing, downloading or checking a file never changes world or session truth. */
export default function TtrpgOpenWorldPatchPanel(props: { input: TtrpgWorldPatchDeskInputV1; sequence: number; busy: boolean; perform: (job: () => Promise<void>) => Promise<void> }) {
  const [desk, setDesk] = useState<Desk>(null), [error, setError] = useState(''), [notice, setNotice] = useState(''), [expanded, setExpanded] = useState(false)
  const [includePrivate, setIncludePrivate] = useState(false), [includeGmOnly, setIncludeGmOnly] = useState(false), [selected, setSelected] = useState<string[]>([])
  const [checked, setChecked] = useState<TtrpgWorldPatchCandidateV1 | null>(null), [matches, setMatches] = useState(false), [page, setPage] = useState(0)
  const live = useRef(true), generation = useRef(0), basis = useRef('')
  const { scope: { projectId, worldId, workId }, sessionId, viewerKey } = props.input
  const input = useCallback(() => ({ scope: { projectId, worldId, workId }, sessionId, viewerKey, includePrivate, includeGmOnly }), [projectId, worldId, workId, sessionId, viewerKey, includePrivate, includeGmOnly])
  const load = useCallback(async () => {
    const token = ++generation.current
    setDesk(null)
    try {
      const next = await readTtrpgWorldPatchDeskV1(input())
      if (!live.current || token !== generation.current) return
      const nextBasis = next?.canExport ? next.reviewBasisHash : ''
      if (nextBasis !== basis.current) { setSelected([]); setPage(0); basis.current = nextBasis }
      setDesk(next); setError('')
    } catch (cause) { if (live.current && token === generation.current) { setDesk(null); setSelected([]); setError(cause instanceof Error ? cause.message : String(cause)) } }
  }, [input])
  useEffect(() => { live.current = true; void load(); return () => { live.current = false; generation.current += 1 } }, [load, props.sequence])
  const exportFile = () => props.perform(async () => {
    if (!desk?.canExport) return
    const token = generation.current
    setError(''); setNotice('')
    try {
      const file = await exportTtrpgWorldPatchCandidateV1({ ...input(), reviewBasisHash: desk.reviewBasisHash, selectedFactKeys: selected })
      if (!live.current || token !== generation.current) return
      downloadTextFile(file.content, file.filename, 'application/json')
      setNotice('已导出待作者审阅的补丁。世界版本和本局事实保持原样，未勾选项仍待审。')
    } catch (cause) { if (live.current && token === generation.current) setError(cause instanceof Error ? cause.message : String(cause)) }
  })
  const checkFile = async (file: File | undefined) => {
    if (!file) return
    const token = generation.current
    setChecked(null); setError(''); setMatches(false)
    try {
      if (file.size > MAX_TTRPG_WORLD_PATCH_BYTES_V1) throw new Error('补丁文件超过 32 MB，请选择原始审阅文件。')
      const result = await verifyTtrpgWorldPatchCandidateV1(await file.text())
      let matching = false
      if (desk?.canExport) { try { await verifyTtrpgWorldPatchCandidateV1(result, desk.source); matching = true } catch { /* Valid file from another release remains inspectable. */ } }
      if (live.current && token === generation.current) { setChecked(result); setMatches(matching) }
    } catch (cause) { if (live.current && token === generation.current) setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  if (!desk && !error) return null
  return <details className="sf-open-table-card" data-testid="ttrpg-world-patch" open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}><summary>世界补丁 · 交给作者审阅</summary>
    <p>选择本局已经确认的事实，交给世界作者决定是否创作新版本。传闻、个人推测、复盘记忆和未确认提案不会成为补丁事实。</p>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <button disabled={props.busy} onClick={() => void load()}>重新读取补丁资料</button>
    {desk && !desk.canExport && <p>{desk.unavailable}</p>}
    {desk?.canExport && <>
      <p>原世界：{desk.source.worldReference.worldCode} · 第 {desk.source.worldReference.releaseVersion} 版；冒险发布版本 {desk.source.releaseVersion}。团局切点 {desk.cutpoint.throughSequence}。</p>
      <p>刷新或资料变化后，请重新核对并勾选。导出含私人内容时，请作为私密审阅材料交付。</p>
      <fieldset disabled={props.busy}><legend>本次审阅范围</legend>
        <label><input type="checkbox" checked={includePrivate} onChange={event => { setDesk(null); setSelected([]); setIncludePrivate(event.target.checked) }} />明确包含本人有权读取的私人事实</label>
        {desk.canIncludeGmOnly && <label><input type="checkbox" checked={includeGmOnly} onChange={event => { setDesk(null); setSelected([]); setIncludeGmOnly(event.target.checked) }} />明确包含主持秘密，作为私密审阅材料</label>}
      </fieldset>
      {!desk.facts.length && <p>当前范围没有可交付的已确认事实。</p>}
      <fieldset disabled={props.busy} aria-label="选择补丁事实"><legend>逐条选择待作者审阅的事实</legend>
        {desk.facts.slice(page * 50, (page + 1) * 50).map(({ fact, sourceRef, oracleSourceRef }) => <article key={fact.factKey}>
          <label><input type="checkbox" aria-label={`交付事实：${fact.detail}`} checked={selected.includes(fact.factKey)} onChange={event => setSelected(keys => event.target.checked ? [...keys, fact.factKey] : keys.filter(key => key !== fact.factKey))} />{fact.detail}</label>
          <p>{fact.audience === 'gm-only' ? '主持秘密' : fact.audience === 'private' ? '私人事实' : '全队事实'} · {fact.subjectRef} / {fact.predicateKey} / {String(fact.canonicalValue)}</p>
          <details><summary>查看事实依据</summary><p>确认来源：{sourceRef.sessionKey} · {sourceRef.sequence}</p><p>Oracle 来源：{oracleSourceRef.sessionKey} · {oracleSourceRef.sequence}</p><p>原事实引用：{fact.sourceFactRefs.join('、') || '无'}</p></details>
          {desk.conflicts.filter(c => c.factKey === fact.factKey).map(c => <p key={c.against}>待作者处理：与冻结事实 {c.against} 的{c.reason === 'frozen-invariant-conflict' ? '不变量冲突' : '初始状态有差异'}，保留两方依据。</p>)}
        </article>)}
        {desk.facts.length > 50 && <nav aria-label="补丁事实分页"><button disabled={page === 0} onClick={() => setPage(n => n - 1)}>上一页</button><span>第 {page + 1} 页 / {Math.ceil(desk.facts.length / 50)} 页</span><button disabled={(page + 1) * 50 >= desk.facts.length} onClick={() => setPage(n => n + 1)}>下一页</button></nav>}
      </fieldset>
      <p>已选 {selected.length} 条，未选 {desk.facts.length - selected.length} 条保持待审。</p>
      <button disabled={props.busy || !selected.length} onClick={() => void exportFile()}>导出待作者审阅的世界补丁</button>
    </>}
    <section aria-label="检查已有补丁文件"><h3>检查另一台电脑上的补丁文件</h3>
      <label>选择补丁文件<input type="file" accept="application/json,.json" disabled={props.busy} onChange={event => { void checkFile(event.target.files?.[0]); event.target.value = '' }} /></label>
      <p>检查格式、内容校验和与原确认哈希。这只能证明文件内部一致性；作者仍须核对可信来源并明确采纳，文件不授予世界编辑权限。</p>
      {checked && <div role="status"><p>文件校验通过。{matches ? '来源匹配当前冒险的冻结版本。' : '尚未与当前冒险的可信来源匹配。'}</p>
        <p>原世界 {checked.source.worldReference.worldCode} · 第 {checked.source.worldReference.releaseVersion} 版；{checked.facts.length} 条待审事实，{checked.conflicts.length} 项冲突或差异。</p>
        {(checked.includePrivate || checked.includeGmOnly) && <p>该文件包含明确选择的私密审阅范围。</p>}
        {checked.facts.map(f => <p key={f.entry.fact.factKey}>{f.entry.fact.detail}</p>)}
      </div>}
    </section>
  </details>
}
