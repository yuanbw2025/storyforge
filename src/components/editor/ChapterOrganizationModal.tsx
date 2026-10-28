import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Check,
  Database,
  Loader2,
  RefreshCw,
  Sparkles,
  X,
} from 'lucide-react'
import type {
  ChapterOrganizationDomain,
  ChapterOrganizationRun,
  ChapterOrganizationSelection,
} from '../../lib/agent/chapter-organization'
import { readChapterOrganizationSelectionV1 } from '../../lib/agent/chapter-organization-selection'
import { useBeforeUnload } from '../../hooks/useBeforeUnload'
import { acknowledgePendingEditFailureV1, capturePendingEditFailureV1, registerPendingDraftFlusherV1, type PendingEditFailureTokenV1 } from '../../lib/authoring/pending-edit-coordinator'

interface Props {
  run: ChapterOrganizationRun
  current: boolean
  busy: boolean
  error: string
  onSelectionChange: (selection: ChapterOrganizationSelection) => Promise<ChapterOrganizationRun>
  onApply: (selection: ChapterOrganizationSelection) => void
  onRerun: () => void
  onClose: () => void
}

const DOMAIN_META: Record<ChapterOrganizationDomain, { label: string; description: string }> = {
  state: { label: '角色状态', description: '确认后更新状态表' },
  facts: { label: '受控事实', description: '只进入事实候选，仍需在事实库确认 Canon' },
  inventory: { label: '物品流水', description: '确认后替换本章的物品提取记录' },
  timeline: { label: '故事年表', description: '确认后替换本章的剧情大事' },
  relations: { label: '角色关系', description: '只新增已登记角色之间的新关系' },
  foreshadows: { label: '伏笔推进', description: '只允许单向推进，不覆盖后来修改' },
  storyline: { label: '故事线演化', description: '推进、交汇与新线都需要作者确认后写入' },
}

const STATUS_LABEL = {
  pending: '待确认',
  adopted: '已写入',
  failed: '写入失败',
  skipped: '已跳过',
} as const

function selectedSet(selection: ChapterOrganizationSelection, key: keyof ChapterOrganizationSelection) {
  return new Set(selection[key] ?? [])
}

export default function ChapterOrganizationModal({
  run,
  current,
  busy,
  error,
  onApply,
  onSelectionChange,
  onRerun,
  onClose,
}: Props) {
  const { candidate } = run
  const initial = readChapterOrganizationSelectionV1(candidate)
  const [selection, setSelection] = useState(initial.selection)
  const [selectionError, setSelectionError] = useState(initial.error ?? '')
  const [savingSelection, setSavingSelection] = useState(false)
  const selectionRef = useRef(selection)
  const dirtyRef = useRef(false)
  const errorRef = useRef<unknown>(initial.error ? new Error(initial.error) : null)
  const failureRef = useRef<PendingEditFailureTokenV1 | undefined>(undefined)
  const inFlightRef = useRef<Promise<void> | null>(null)
  useBeforeUnload(savingSelection || !!selectionError)
  useEffect(() => registerPendingDraftFlusherV1(() => {
    if (inFlightRef.current) return inFlightRef.current
    if (errorRef.current) return Promise.reject(errorRef.current)
    if (dirtyRef.current) return Promise.reject(new Error('勾选尚未保存，请先重试或明确放弃。'))
  }), [])
  useEffect(() => {
    if (dirtyRef.current || inFlightRef.current) return
    const read = readChapterOrganizationSelectionV1(candidate)
    selectionRef.current = read.selection; setSelection(read.selection)
    errorRef.current = read.error ? new Error(read.error) : null; setSelectionError(read.error ?? '')
  }, [candidate])

  const total = useMemo(() => Object.values(selection).reduce((sum, indexes) => sum + (indexes?.length ?? 0), 0), [selection])
  const allResolved = Object.values(candidate.domainStatus).every(status => status === 'adopted' || status === 'skipped')
  const selectionBlocked = savingSelection || !!selectionError
  const saveSelection = (next: ChapterOrganizationSelection): Promise<void> => {
    if (inFlightRef.current) return inFlightRef.current
    dirtyRef.current = true; setSavingSelection(true); setSelectionError(''); errorRef.current = null
    const operation = (async () => {
      try {
        await onSelectionChange(next)
        dirtyRef.current = false; failureRef.current = undefined
      } catch (error) {
        errorRef.current = error; failureRef.current = capturePendingEditFailureV1(error)
        setSelectionError(error instanceof Error ? error.message : '勾选保存失败，请重试。')
        throw error
      } finally { setSavingSelection(false) }
    })()
    inFlightRef.current = operation
    const clear = () => { if (inFlightRef.current === operation) inFlightRef.current = null }
    operation.then(clear, clear)
    return operation
  }
  const toggle = (key: keyof ChapterOrganizationSelection, index: number) => {
    if (inFlightRef.current || errorRef.current || busy) return
    const selected = selectedSet(selectionRef.current, key)
    if (selected.has(index)) selected.delete(index); else selected.add(index)
    const next = { ...selectionRef.current, [key]: [...selected].sort((a, b) => a - b) }
    selectionRef.current = next; setSelection(next)
    void saveSelection(next).catch(() => undefined)
  }
  const discardSelection = () => {
    if (inFlightRef.current) return
    try {
      if (failureRef.current) acknowledgePendingEditFailureV1({ token: failureRef.current, decision: 'abandon-command' })
      dirtyRef.current = false; onClose()
    } catch (error) { setSelectionError(error instanceof Error ? error.message : '无法结束本次保存，请重试。') }
  }

  const renderSection = (input: {
    domain: ChapterOrganizationDomain
    key: keyof ChapterOrganizationSelection
    label?: string
    items: Array<{ title: string; detail: string; quote: string }>
  }) => {
    const status = candidate.domainStatus[input.domain]
    const selected = selectedSet(selection, input.key)
    return (
      <section className="rounded-xl border border-border bg-bg-base/60 overflow-hidden">
        <div className="flex items-start justify-between gap-3 border-b border-border/60 px-4 py-3">
          <div>
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-semibold text-text-primary">{input.label ?? DOMAIN_META[input.domain].label}</h4>
              <span className="rounded-full bg-bg-elevated px-2 py-0.5 text-[10px] text-text-muted">
                {input.items.length} 条
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-text-muted">{DOMAIN_META[input.domain].description}</p>
          </div>
          <span className={`shrink-0 rounded px-2 py-0.5 text-[10px] ${
            status === 'adopted' ? 'bg-emerald-500/10 text-emerald-400'
              : status === 'failed' ? 'bg-red-500/10 text-red-400'
                : 'bg-amber-500/10 text-amber-300'
          }`}>
            {STATUS_LABEL[status]}
          </span>
        </div>
        {candidate.domainErrors[input.domain] && (
          <p className="border-b border-red-500/20 bg-red-500/5 px-4 py-2 text-xs text-red-300">
            {candidate.domainErrors[input.domain]}
          </p>
        )}
        {input.items.length === 0 ? (
          <p className="px-4 py-3 text-xs text-text-muted">本章没有通过确定性证据校验的候选。</p>
        ) : (
          <div className="divide-y divide-border/50">
            {input.items.map((item, index) => (
              <label key={`${input.domain}-${index}`} className="flex cursor-pointer gap-3 px-4 py-3 hover:bg-bg-hover/40">
                <input
                  type="checkbox"
                  checked={selected.has(index)}
                  disabled={busy || selectionBlocked || !current || (status !== 'pending' && status !== 'failed')}
                  onChange={() => toggle(input.key, index)}
                  className="mt-1 accent-accent"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-text-primary">{item.title}</span>
                  {item.detail && <span className="mt-0.5 block text-xs text-text-secondary">{item.detail}</span>}
                  <span className="mt-1 block rounded bg-bg-elevated px-2 py-1 text-[11px] text-text-muted">
                    证据：“{item.quote}”
                  </span>
                </span>
              </label>
            ))}
          </div>
        )}
      </section>
    )
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-border bg-bg-surface shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <h3 className="flex items-center gap-2 text-lg font-bold text-text-primary">
              <Sparkles className="h-5 w-5 text-accent" />
              整理本章 · {candidate.chapterTitle}
            </h3>
            <p className="mt-1 text-xs text-text-muted">
              一次模型调用生成七类候选；未勾选内容不会写入项目。
            </p>
          </div>
          <button onClick={onClose} disabled={busy || selectionBlocked} aria-label="关闭整理本章"
            className="rounded p-1 text-text-muted hover:bg-bg-hover hover:text-text-primary disabled:opacity-40">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          {!current && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">正文已变化，这批候选已过期。</p>
                <p className="mt-0.5 text-xs text-amber-200/80">旧结果仍保留供核对，但不能写回。请重新整理当前正文。</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-2 rounded-xl border border-border bg-bg-base p-3 text-xs text-text-secondary sm:grid-cols-4">
            <span>约 {candidate.budget.usedTokens.toLocaleString()} / {candidate.budget.maxTokens.toLocaleString()} tokens</span>
            <span>{candidate.budget.calls} / {candidate.budget.maxCalls} 次模型调用</span>
            <span>正文指纹 {candidate.sourceTextHash.slice(0, 12)}…</span>
            {candidate.durable && (
              <span title={candidate.durable.contextManifestHash}>
                Run #{candidate.durable.runId} · durable
              </span>
            )}
          </div>

          {renderSection({
            domain: 'state',
            key: 'stateDiffs',
            items: candidate.stateDiffs.map(item => ({
              title: `${item.entityName} · ${item.field}`,
              detail: `${item.oldValue || '（空）'} → ${item.newValue}`,
              quote: item.sourceQuote,
            })),
          })}
          {renderSection({
            domain: 'facts',
            key: 'facts',
            items: candidate.facts.map(item => ({
              title: `${item.subjectName} · ${item.predicate}：${item.value}`,
              detail: item.objectName ? `对象：${item.objectName}` : '',
              quote: item.sourceQuote,
            })),
          })}
          {renderSection({
            domain: 'inventory',
            key: 'inventoryEvents',
            items: candidate.inventoryEvents.map(item => ({
              title: `${item.heldByName} ${item.action === 'gain' ? '获得' : '消耗'} ${item.itemName} ×${item.quantity}`,
              detail: item.note,
              quote: item.sourceQuote,
            })),
          })}
          {renderSection({
            domain: 'timeline',
            key: 'storyEvents',
            items: candidate.storyEvents.map(item => ({
              title: `${item.title} · 重要度 ${item.importance}`,
              detail: [item.storyTime, item.description].filter(Boolean).join(' · '),
              quote: item.sourceQuote,
            })),
          })}
          {renderSection({
            domain: 'relations',
            key: 'relations',
            items: candidate.relations.map(item => ({
              title: `${item.char1} ↔ ${item.char2} · ${item.label || item.type}`,
              detail: item.description,
              quote: item.sourceQuote,
            })),
          })}
          {renderSection({
            domain: 'foreshadows',
            key: 'foreshadowUpdates',
            items: candidate.foreshadowUpdates.map(item => ({
              title: `${item.name} · ${item.fromStatus} → ${item.toStatus}`,
              detail: item.note,
              quote: item.sourceQuote,
            })),
          })}
          {renderSection({
            domain: 'storyline',
            key: 'storylineProgress',
            label: '故事线推进',
            items: (candidate.storyline?.progress ?? []).map(item => ({
              title: `故事线 #${item.arcId} · ${item.status}`,
              detail: [item.currentStageId ? `阶段 ${item.currentStageId}` : '', item.progressNote].filter(Boolean).join(' · '),
              quote: item.evidenceQuote,
            })),
          })}
          {renderSection({
            domain: 'storyline',
            key: 'storylineCrossings',
            label: '故事线交汇',
            items: (candidate.storyline?.crossings ?? []).map(item => ({
              title: `故事线 #${item.arcIdA} × #${item.arcIdB}`,
              detail: item.note,
              quote: item.evidenceQuote,
            })),
          })}
          {renderSection({
            domain: 'storyline',
            key: 'newStoryArcs',
            label: '新故事线候选',
            items: (candidate.storyline?.newArcs ?? []).map(item => ({
              title: `候选${item.arcType === 'main' ? '主线' : '支线'} · ${item.name}`,
              detail: item.description,
              quote: item.evidenceQuote,
            })),
          })}

          {selectionError && <div role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">
            <p>{selectionError}</p>
            <p className="mt-1 text-xs">本次勾选尚未保存，确认写入已暂停。</p>
            <div className="mt-2 flex gap-3">
              <button type="button" disabled={savingSelection} onClick={() => { void saveSelection(selectionRef.current).catch(() => undefined) }}>{initial.error && !dirtyRef.current ? '清空无效勾选并重新选择' : '重试保存选择'}</button>
              <button type="button" disabled={savingSelection} onClick={discardSelection}>放弃未保存选择并关闭</button>
            </div>
          </div>}
          {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-4">
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <Database className="h-4 w-4" />
            {savingSelection ? '正在保存选择…' : '候选与已保存的勾选可在刷新后恢复'}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onRerun} disabled={busy || selectionBlocked}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm text-text-secondary hover:text-text-primary disabled:opacity-40">
              <RefreshCw className="h-4 w-4" /> 重新整理
            </button>
            <button onClick={() => onApply(selection)}
              disabled={busy || selectionBlocked || !current || allResolved}
              className="flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-40">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {busy ? '正在处理…' : total === 0 ? '本次不写入' : `确认写入所选（${total}）`}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
