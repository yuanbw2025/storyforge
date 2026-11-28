import { useEffect, useRef, useState } from 'react'
import type { HistoricalKeyword, Project } from '../../lib/types'
import { HISTORICAL_ERA_LABELS, KEYWORD_CATEGORY_LABELS } from '../../lib/types/history'
import { createHistoryKeywordDraftV1, selectHistoryKeywordDraftV1, deleteHistoryKeywordDraftV1, readHistoryKeywordDraftsV1, saveHistoryKeywordDraftsV1, type HistoryKeywordDraftSetV1, type HistoryKeywordDraftReadV1, type HistoryKeywordDraftV1 } from '../../lib/history/keyword-drafts'
import { createHistoryKeywordsFromDraftsV1 } from '../../lib/history/keyword-draft-creation'
import { registerPendingDraftFlusherV1, flushPendingEditsV1 } from '../../lib/authoring/pending-edit-coordinator'
import { useBeforeUnload } from '../../hooks/useBeforeUnload'
import { useDialog } from '../shared/Dialog'
import { CInput, CTextarea } from '../shared/CompositionInput'
import HistoryCandidateDialog from './HistoryCandidateDialog'

export default function HistoryKeywordDrafts({ project, worldGroupId, keywords, onCreated, onOpen, onClose }: {
  project: Project; worldGroupId: number | null; keywords: HistoricalKeyword[]; onCreated: () => Promise<unknown>; onOpen: (id: number) => void; onClose: () => void
}) {
  const origin = { scope: { projectId: project.id!, worldId: project.activeWorldId!, workId: project.activeWorkId! }, worldGroupId }
  const dialog = useDialog()
  const [value, setValue] = useState<HistoryKeywordDraftSetV1 | null>(null), [activeId, setActiveId] = useState<string | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [allowSameNames, setAllowSameNames] = useState(false)
  const [, refresh] = useState(0)
  const loadSequence = useRef(0)
  const current = useRef(value), saved = useRef<HistoryKeywordDraftReadV1 | null>(null), writing = useRef<Promise<HistoryKeywordDraftReadV1> | null>(null), composing = useRef(false), mounted = useRef(true)
  const changed = !!value && JSON.stringify(value) !== JSON.stringify(saved.current?.value)
  useBeforeUnload(changed || busy)
  const update = (next: HistoryKeywordDraftSetV1) => { current.current = next; setValue(next); setError('') }
  const load = async () => {
    const request = ++loadSequence.current
    const result = await readHistoryKeywordDraftsV1(origin)
    if (!mounted.current || request !== loadSequence.current) return
    saved.current = result; update(result.value)
    setActiveId(result.value.drafts.find(row => !row.deleted)?.draftId ?? null)
  }
  useEffect(() => {
    mounted.current = true
    void load().catch(cause => { if (mounted.current) setError(String(cause)) })
    return () => { mounted.current = false }
  // A parent scope key remounts this editor for each Work/World/partition.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const save = async (): Promise<HistoryKeywordDraftReadV1> => {
    if (composing.current) throw new Error('请先完成当前中文输入，草稿仍保留在此页。')
    if (writing.current) await writing.current
    if (!current.current || !saved.current) throw new Error('草稿尚未读取，请稍后再操作。')
    if (JSON.stringify(current.current) === JSON.stringify(saved.current.value)) return saved.current
    const operation = saveHistoryKeywordDraftsV1({ ...origin, expectedRevision: saved.current.revision, value: current.current })
    writing.current = operation
    try {
      const result = await operation
      saved.current = result
      if (mounted.current) refresh(tick => tick + 1)
      return result
    } finally { if (writing.current === operation) writing.current = null }
  }
  const saveRef = useRef(save); saveRef.current = save
  useEffect(() => registerPendingDraftFlusherV1(async () => { if (current.current && saved.current) await saveRef.current() }), [])
  const guarded = async (action: () => Promise<unknown> | void) => {
    if (busy) return
    setBusy(true); setError('')
    try { await action() } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { if (mounted.current) setBusy(false) }
  }
  const close = () => { void guarded(async () => { await flushPendingEditsV1(); onClose() }) }
  const draft = value?.drafts.find(row => row.draftId === activeId)
  const formal = draft ? keywords.find(row => Reflect.get(row, 'ragDocumentId') === draft.draftId) : undefined
  const choose = (id: string | null) => { if (composing.current) { setError('请先完成当前中文输入，再切换草稿。'); return } setActiveId(id) }
  const edit = (patch: Partial<HistoryKeywordDraftV1>) => { if (draft && value) update({ ...value, drafts: value.drafts.map(row => row.draftId === draft.draftId ? { ...row, ...patch } : row) }) }
  const selected = value?.drafts.filter(row => row.selected && !row.deleted).length ?? 0
  return <HistoryCandidateDialog label="关键词草稿" onClose={close}>
    <div className="mb-3 flex items-center justify-between"><h2>关键词草稿</h2><button onClick={close} aria-label="关闭关键词草稿">关闭</button></div>
    <p className="mb-3 text-xs text-text-muted">每个关键词分别整理；取消选择保留文字，删除草稿可撤销。保存草稿后可在刷新时恢复，明确新建后才进入正式设定。</p>
    {error && <div role="alert" className="mb-3 text-xs text-error">{error}<button className="ml-2 underline" onClick={() => { void guarded(async () => {
      if (await dialog.confirm({ title: '重新读取已存草稿？', message: '这会放弃此页尚未保存的修改，保留本机已经保存的版本。', confirmText: '放弃本页修改并重读', tone: 'danger' })) { if (writing.current) await writing.current.catch(() => undefined); await load() }
    }) }}>重新读取已存版本</button></div>}
    {!value ? <p role="status">正在读取草稿…</p> : <div onCompositionStartCapture={() => { composing.current = true }} onCompositionEndCapture={() => { composing.current = false }}>
      <div className="mb-3 flex flex-wrap gap-3 text-xs"><button disabled={busy} onClick={() => { if (composing.current) { setError('请先完成当前中文输入，再添加草稿。'); return } const next = createHistoryKeywordDraftV1(); update({ ...value, drafts: [...value.drafts, next] }); choose(next.draftId) }} className="text-accent">添加关键词草稿</button><button disabled={busy} onClick={() => update({ ...value, drafts: value.drafts.map(row => ({ ...row, selected: false })) })}>取消本次全部选择</button></div>
      <div className="grid min-w-0 gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
        <div className="space-y-2">{value.drafts.filter(row => !row.deleted).map((row, index) => <div key={row.draftId} className="flex items-center gap-2">
          <input type="checkbox" aria-label={`选择草稿${index + 1}：${row.keyword || '未命名'}`} checked={row.selected} disabled={busy || keywords.some(item => Reflect.get(item, 'ragDocumentId') === row.draftId)} onChange={event => update(selectHistoryKeywordDraftV1(value, row.draftId, event.target.checked))}/>
          <button aria-pressed={activeId === row.draftId} className="min-w-0 truncate text-left text-sm" onClick={() => choose(row.draftId)}>{row.keyword || `未命名草稿 ${index + 1}`}</button></div>)}
          {value.drafts.some(row => row.deleted) && <details className="text-xs"><summary>已删除草稿（可撤销）</summary>{value.drafts.filter(row => row.deleted).map(row => <div key={row.draftId}>{row.keyword || '未命名'}<button className="ml-2 text-accent" onClick={() => { update(deleteHistoryKeywordDraftV1(value, row.draftId, false)); setActiveId(row.draftId) }}>撤销删除</button></div>)}</details>}
        </div>
        {draft && !draft.deleted ? <fieldset key={draft.draftId} disabled={busy || !!formal} className="min-w-0 space-y-3">
          <label className="block text-xs">关键词名称<CInput aria-label="草稿关键词名称" className="mt-1 w-full" value={draft.keyword} onChange={event => edit({ keyword: event.target.value })}/></label>
          <div className="grid gap-2 sm:grid-cols-2"><label className="text-xs">分类<select aria-label="草稿分类" value={draft.category} onChange={event => edit({ category: event.target.value as HistoryKeywordDraftV1['category'] })} className="mt-1 w-full rounded border border-border bg-bg-base p-2">{Object.entries(KEYWORD_CATEGORY_LABELS).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="text-xs">时期<CInput aria-label="草稿时期" value={HISTORICAL_ERA_LABELS[draft.era as keyof typeof HISTORICAL_ERA_LABELS] ?? draft.era} onChange={event => edit({ era: Object.entries(HISTORICAL_ERA_LABELS).find(([, label]) => label === event.target.value)?.[0] ?? event.target.value })} list="history-draft-eras" className="mt-1 w-full"/><datalist id="history-draft-eras">{Object.entries(HISTORICAL_ERA_LABELS).map(([key,label]) => <option key={key} value={label}/>)}</datalist></label></div>
          <div className="grid gap-2 sm:grid-cols-2"><label className="text-xs">时间范围<CInput aria-label="草稿时间范围" value={draft.customTimeRange} onChange={event => edit({ customTimeRange: event.target.value })} className="mt-1 w-full"/></label><label className="text-xs">地点<CInput aria-label="草稿地点" value={draft.location} onChange={event => edit({ location: event.target.value })} className="mt-1 w-full"/></label></div>
          <label className="block text-xs">条目内容<CTextarea aria-label="草稿条目内容" value={draft.description} onChange={event => edit({ description: event.target.value })} rows={5} className="mt-1 w-full"/></label>
          <label className="block text-xs">自己的想法与创作方向<CTextarea aria-label="草稿创作方向" value={draft.conceptNote} onChange={event => edit({ conceptNote: event.target.value })} rows={3} className="mt-1 w-full"/></label>
          <button className="text-xs text-error" onClick={() => { if (composing.current) { setError('请先完成当前中文输入，再删除草稿。'); return } update(deleteHistoryKeywordDraftV1(value, draft.draftId, true)); setActiveId(null) }}>删除此草稿</button>
        </fieldset> : <p className="text-xs text-text-muted">添加或选择一个关键词草稿。</p>}
      </div>
      {formal?.id && <button className="mt-3 text-xs text-accent" onClick={() => { void guarded(async () => { await flushPendingEditsV1(); onOpen(formal.id!); onClose() }) }}>已加入设定，打开正式词条</button>}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3 text-xs"><span role="status">{busy ? '正在保存…' : changed ? '此页有未保存草稿' : '草稿已保存到本机，尚未自动加入设定'}</span><div className="flex flex-wrap items-center gap-3"><label><input type="checkbox" checked={allowSameNames} onChange={event => setAllowSameNames(event.target.checked)}/> 同名时明确保留独立新条目</label><button disabled={busy} onClick={() => { void guarded(save) }}>保存草稿</button><button disabled={busy || !selected} className="rounded bg-accent px-3 py-2 text-white disabled:opacity-40" onClick={() => { void guarded(async () => {
        const stored = await save(); if (stored.revision == null) throw new Error('请先保存关键词草稿。')
        const result = await createHistoryKeywordsFromDraftsV1({ ...origin, expectedRevision: stored.revision, allowSameNames })
        saved.current = result; update(result.value); await onCreated(); setAllowSameNames(false)
      }) }}>新建所选词条（{selected}）</button></div></div>
    </div>}
  </HistoryCandidateDialog>
}
