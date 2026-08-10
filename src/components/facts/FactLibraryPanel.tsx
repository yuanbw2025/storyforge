/**
 * NS-4 · 事实库面板 — 审阅事实账本候选、确认升 Canon / 否决。
 * 所有变更走 useFactLedgerStore（→ lib/fact-ledger 单一入口），面板不裸写 db。
 */
import { useEffect, useMemo, useState } from 'react'
import { Check, X, Database, Download, Upload } from 'lucide-react'
import type { Project } from '../../lib/types'
import { useFactLedgerStore } from '../../stores/fact-ledger'
import { getFactPredicate } from '../../lib/registry/fact-predicate-registry'
import type { FactStatus } from '../../lib/types/temporal-fact'
import { exportFactMemoryMarkdown } from '../../lib/fact-ledger/human-readable-io'
import KnowledgeLedgerPanel from './KnowledgeLedgerPanel'
import WorldConstitutionPanel from './WorldConstitutionPanel'
import {
  INITIAL_RECORD_TARGET_CLASS,
  initialRecordTargetAttributes,
  useInitialRecordTarget,
} from '../shared/initial-record-target'

type FactTab = FactStatus | 'exceptions'

const STATUS_TABS: { key: FactTab; label: string }[] = [
  { key: 'exceptions', label: '异常待复核' },
  { key: 'candidate', label: '待确认候选' },
  { key: 'confirmed', label: '已确认 Canon' },
  { key: 'superseded', label: '已被取代' },
  { key: 'rejected', label: '已否决' },
]

const EXCEPTION_STATUSES: FactStatus[] = ['stale', 'source-missing', 'invalid-range']

const STATUS_LABEL: Record<FactStatus, string> = {
  candidate: '候选',
  confirmed: 'Canon',
  superseded: '已取代',
  rejected: '已否决',
  stale: '证据过期',
  'source-missing': '来源/主体缺失',
  'invalid-range': '时序区间失效',
}

const STATUS_HINT: Partial<Record<FactStatus, string>> = {
  stale: '来源正文已修改，原证据引文不再成立；重新确认前不会注入生成。',
  'source-missing': '引用的角色/章节/来源被删除或无法映射；需要人工判断是否仍保留。',
  'invalid-range': 'validFrom/validTo 指向的章节已失效；需要人工重设或确认。',
}

export default function FactLibraryPanel({
  project,
  initialFactId,
}: {
  project: Project
  initialFactId?: number | null
}) {
  const { facts, loading, load, confirmFact, rejectFact, importCandidateDiff } = useFactLedgerStore()
  const [tab, setTab] = useState<FactTab>('exceptions')
  const [diffText, setDiffText] = useState('')
  const [ioMsg, setIoMsg] = useState('')
  const [libraryMode, setLibraryMode] = useState<'facts' | 'knowledge' | 'constitution'>('facts')

  useEffect(() => { if (project.id != null) void load(project.id) }, [project.id, load])

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const f of facts) c[f.status] = (c[f.status] ?? 0) + 1
    c.exceptions = EXCEPTION_STATUSES.reduce((sum, status) => sum + (c[status] ?? 0), 0)
    return c
  }, [facts])

  const rows = useMemo(() => tab === 'exceptions'
    ? facts.filter(f => EXCEPTION_STATUSES.includes(f.status))
    : facts.filter(f => f.status === tab), [facts, tab])
  const targetFact = useMemo(
    () => facts.find(fact => fact.id === initialFactId) ?? null,
    [facts, initialFactId],
  )

  useEffect(() => {
    if (!targetFact) return
    setLibraryMode('facts')
    setTab(EXCEPTION_STATUSES.includes(targetFact.status) ? 'exceptions' : targetFact.status)
  }, [targetFact])
  useInitialRecordTarget(
    initialFactId,
    libraryMode === 'facts' && rows.some(fact => fact.id === initialFactId),
  )

  const handleExport = async () => {
    if (project.id == null) return
    const markdown = await exportFactMemoryMarkdown(project.id)
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `storyforge-fact-memory-${project.id}.md`
    a.click()
    URL.revokeObjectURL(url)
    setIoMsg('已导出事实/派生记忆 Markdown。')
  }

  const handleImportDiff = async () => {
    if (project.id == null || !diffText.trim()) return
    try {
      const raw = JSON.parse(diffText)
      const result = await importCandidateDiff(project.id, raw)
      setIoMsg(`候选 diff 已导入：写入 ${result.written} 条，跳过重复 ${result.skippedDuplicate} 条，跳过无效 ${result.skippedInvalid} 条。`)
      if (result.written > 0) setDiffText('')
    } catch (err) {
      setIoMsg(`候选 diff 导入失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  if (libraryMode === 'knowledge') {
    return <KnowledgeLedgerPanel project={project} onShowFacts={() => setLibraryMode('facts')} />
  }
  if (libraryMode === 'constitution') {
    return <WorldConstitutionPanel project={project} onShowFacts={() => setLibraryMode('facts')} />
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between gap-3 mb-1">
        <div className="flex items-center gap-2">
          <Database className="w-5 h-5 text-sky-400" />
          <h1 className="text-lg font-bold text-text-primary">事实库（NS-4 长期一致性）</h1>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setLibraryMode('constitution')}
            className="px-3 py-1.5 text-xs rounded-md bg-amber-500/10 text-amber-300 hover:bg-amber-500/20">
            查看世界宪法
          </button>
          <button onClick={() => setLibraryMode('knowledge')}
            className="px-3 py-1.5 text-xs rounded-md bg-violet-500/10 text-violet-300 hover:bg-violet-500/20">
            查看角色认知
          </button>
        </div>
      </div>
      <p className="text-xs text-text-muted mb-4">
        在章节里点「提取事实」抽取候选；确认后的事实会在写后续章节时自动注入。正文修改、删章、删角色会进入异常待复核，不会继续污染生成上下文。
      </p>

      <div className="mb-4 p-3 rounded-lg border border-border bg-bg-elevated/60">
        <div className="flex flex-wrap gap-2 items-center mb-2">
          <button onClick={() => void handleExport()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-bg-base text-xs text-text-secondary hover:text-text-primary">
            <Download className="w-3.5 h-3.5" /> 导出事实/记忆 Markdown
          </button>
          <button onClick={() => void handleImportDiff()} disabled={!diffText.trim()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-sky-500/10 text-xs text-sky-300 hover:bg-sky-500/20 disabled:opacity-40">
            <Upload className="w-3.5 h-3.5" /> 导入候选 diff
          </button>
          {ioMsg && <span className="text-[11px] text-text-muted">{ioMsg}</span>}
        </div>
        <textarea value={diffText} onChange={e => setDiffText(e.target.value)}
          placeholder={'粘贴外部编辑后的候选 JSON，例如：\n{"facts":[{"subjectName":"林飞","predicate":"location","value":"北境","sourceQuote":"人工整理"}]}\n导入结果只会进入 candidate，必须再由作者确认。'}
          className="w-full min-h-[76px] px-3 py-2 text-xs rounded bg-bg-base border border-border text-text-primary placeholder:text-text-muted focus:outline-none focus:border-sky-500" />
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        {STATUS_TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 text-xs rounded-md transition-colors ${tab === t.key ? 'bg-sky-500/20 text-sky-300' : 'bg-bg-elevated text-text-muted hover:text-text-secondary'}`}>
            {t.label}{counts[t.key] ? `（${counts[t.key]}）` : ''}
          </button>
        ))}
      </div>

      {loading && <p className="text-sm text-text-muted">加载中…</p>}
      {!loading && rows.length === 0 && (
        <p className="text-sm text-text-muted py-8 text-center">暂无{STATUS_TABS.find(t => t.key === tab)?.label}。</p>
      )}

      <div className="space-y-2">
        {rows.map(f => {
          const spec = getFactPredicate(f.predicate)
          return (
            <div
              key={f.id}
              {...initialRecordTargetAttributes(f.id === initialFactId, f.id)}
              className={`flex items-start gap-3 p-3 bg-bg-elevated rounded-lg border border-border ${
                f.id === initialFactId ? INITIAL_RECORD_TARGET_CLASS : ''
              }`}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm text-text-primary">
                  <span className="font-medium">{f.subjectName}</span>
                  <span className="text-text-muted"> · {spec?.label ?? f.predicate}：</span>
                  <span>{f.value}</span>
                  <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-bg-base text-text-muted">{STATUS_LABEL[f.status]}</span>
                  {f.locked && <span className="ml-2 text-[10px] text-amber-400">🔒锁定</span>}
                </p>
                {STATUS_HINT[f.status] && <p className="text-xs text-amber-300/90 mt-1">{STATUS_HINT[f.status]}</p>}
                {f.sourceQuote && <p className="text-xs text-text-muted mt-1 truncate">证据：“{f.sourceQuote}”</p>}
              </div>
              {(['candidate', ...EXCEPTION_STATUSES] as FactStatus[]).includes(f.status) && f.id != null && (
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => void confirmFact(project.id!, f.id!)} title="确认为权威事实（Canon）"
                    className="p-1.5 text-emerald-400 hover:bg-emerald-500/15 rounded">
                    <Check className="w-4 h-4" />
                  </button>
                  <button onClick={() => void rejectFact(project.id!, f.id!)} title="否决"
                    className="p-1.5 text-rose-400 hover:bg-rose-500/15 rounded">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
