import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, BookOpenCheck, CheckSquare, Square, X } from 'lucide-react'
import type { CodexImportCategoryOption } from '../../../lib/import/codex-classification'
import type { CodexImportCandidate } from '../../../lib/types/import-session-data'
import type { CodexEntry, WorkspaceScope } from '../../../lib/types'
import { db } from '../../../lib/db/schema'
import { resolveScope, readOwnedRows } from '../../../lib/workspace/scope'
import { useProjectStore } from '../../../stores/project'
import {
  detectCodexSameNameConflictsV1,
  CODEX_SAME_NAME_RULE_V1,
  type CodexSameNameConflictItemV1,
} from '../../../lib/import/dedup'

interface Props {
  filename: string
  candidates: readonly CodexImportCandidate[]
  categories: readonly CodexImportCategoryOption[]
  onConfirm: (candidates: CodexImportCandidate[]) => Promise<void>
  onCancel: () => void
}

export default function CodexImportReviewModal({
  filename,
  candidates,
  categories,
  onConfirm,
  onCancel,
}: Props) {
  const [drafts, setDrafts] = useState(() => candidates.map(candidate => ({
    ...candidate,
    fields: { ...candidate.fields },
    tags: [...candidate.tags],
    evidence: [...candidate.evidence],
  })))
  const [selected, setSelected] = useState(() => new Set(candidates.map((_, index) => index)))
  const [submitting, setSubmitting] = useState(false)
  /** 032-L1-d-CODEX：候选与目标世界既有同分类词条的同名清单（只读展示）。 */
  const [sameNameConflicts, setSameNameConflicts] = useState<CodexSameNameConflictItemV1[]>([])
  const selectedCount = selected.size
  const categoryByRef = useMemo(
    () => new Map(categories.map(category => [category.ref, category])),
    [categories],
  )

  /**
   * 032-L1-d-CODEX：只读同名对照。
   *
   * - scope 由既有工作区身份解析（currentProjectId → resolveScope），沿用既有
   *   ownership 校验，不弱化 authority；不做任何写库动作。
   * - existing 侧读取该 scope 的真实词条行；多世界项目在世界组未确定时保守跳过，
   *   避免跨世界误报。
   * - incoming 侧 categoryRef 必须能在本面板已加载的分类目录里解析到 categoryId，
   *   否则如实跳过（不猜测 builtin/custom 结构）。
   */
  useEffect(() => {
    let active = true
    const compute = async () => {
      try {
        const projectId = useProjectStore.getState().currentProjectId
        if (projectId == null) { setSameNameConflicts([]); return }
        const project = await db.projects.get(projectId)
        if (!active) return
        // 世界组语义未定（多世界）时不给提示：宁缺勿误报。
        if (!project || project.enableMultiWorld) { setSameNameConflicts([]); return }
        const scope: WorkspaceScope = await resolveScope({ projectId })
        if (!active) return
        const entries = await readOwnedRows<CodexEntry>(scope, 'codexEntries', { owner: 'world' })
        if (!active) return
        setSameNameConflicts(detectCodexSameNameConflictsV1({
          existingEntries: entries.map(entry => ({ id: entry.id, categoryId: entry.categoryId, name: entry.name, worldGroupId: entry.worldGroupId ?? null })),
          incomingCandidates: drafts.map(draft => ({
            categoryRef: draft.categoryRef,
            categoryId: categoryByRef.get(draft.categoryRef)?.categoryId ?? null,
            name: draft.name,
          })),
          worldGroupId: null,
        }))
      } catch {
        // 纯展示提示：读取失败保持空清单，绝不阻断审查/确认流程。
        if (active) setSameNameConflicts([])
      }
    }
    void compute()
    return () => { active = false }
    // drafts 改名后重算，使提示跟随作者编辑；分类目录变化同样重算。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drafts, categories])

  const updateDraft = (index: number, patch: Partial<CodexImportCandidate>) => {
    setDrafts(current => current.map((draft, draftIndex) =>
      draftIndex === index ? { ...draft, ...patch } : draft))
  }

  const toggle = (index: number) => {
    setSelected(current => {
      const next = new Set(current)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  const submit = async () => {
    if (submitting || selectedCount === 0) return
    setSubmitting(true)
    try {
      await onConfirm(drafts.filter((_, index) => selected.has(index)))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4">
      <div className="bg-bg-surface border border-border rounded-2xl max-w-4xl w-full max-h-[92vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <div className="flex items-center gap-2 text-text-primary font-semibold">
              <BookOpenCheck className="w-5 h-5 text-accent" />
              审查 Codex 词条候选
            </div>
            <div className="text-xs text-text-muted mt-1">
              {filename} · AI 只做分类建议，点击确认前不会写入词条库
            </div>
          </div>
          <button onClick={onCancel} className="p-1.5 rounded hover:bg-bg-hover">
            <X className="w-4 h-4 text-text-muted" />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-border bg-bg-base flex items-center justify-between gap-3">
          <div className="text-xs text-text-secondary">
            已选择 {selectedCount} / {drafts.length} 条。分类、名称、摘要和描述都可在确认前修改。
          </div>
          <button
            onClick={() => setSelected(selectedCount === drafts.length
              ? new Set()
              : new Set(drafts.map((_, index) => index)))}
            className="flex items-center gap-1.5 px-2 py-1 text-xs text-accent hover:bg-accent/10 rounded"
          >
            {selectedCount === drafts.length
              ? <CheckSquare className="w-3.5 h-3.5" />
              : <Square className="w-3.5 h-3.5" />}
            {selectedCount === drafts.length ? '取消全选' : '全选'}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {sameNameConflicts.length > 0 && (
            <div role="status" className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs leading-relaxed">
              <div className="flex items-start gap-1.5 mb-1.5 text-warning">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                <span className="font-medium">检测到 {sameNameConflicts.length} 处同名词条（目标世界同分类下已存在）</span>
              </div>
              <ul className="space-y-1 mb-2">
                {sameNameConflicts.map((conflict, index) => (
                  <li key={`${conflict.categoryRef}-${conflict.incomingName}-${index}`} className="text-text-secondary">
                    <span className="text-text-primary font-medium">候选词条「{conflict.incomingName}」</span>
                    <span className="text-text-muted"> → 已有同名词条「{conflict.existingName}」（同一分类）</span>
                  </li>
                ))}
              </ul>
              <p className="text-text-muted">{CODEX_SAME_NAME_RULE_V1}</p>
            </div>
          )}
          {drafts.map((candidate, index) => {
            const category = categoryByRef.get(candidate.categoryRef)
            const checked = selected.has(index)
            return (
              <div
                key={index}
                className={`border rounded-xl p-3 space-y-3 ${
                  checked ? 'border-accent/50 bg-accent/5' : 'border-border opacity-60'
                }`}
              >
                <div className="flex items-start gap-3">
                  <button
                    onClick={() => toggle(index)}
                    className="mt-1 text-accent"
                    aria-label={`${checked ? '取消选择' : '选择'} ${candidate.name}`}
                  >
                    {checked
                      ? <CheckSquare className="w-4 h-4" />
                      : <Square className="w-4 h-4" />}
                  </button>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 flex-1">
                    <label className="text-[11px] text-text-muted">
                      词条名称
                      <input
                        value={candidate.name}
                        onChange={event => updateDraft(index, { name: event.target.value })}
                        className="mt-1 w-full px-2.5 py-2 bg-bg-base border border-border rounded text-sm text-text-primary"
                      />
                    </label>
                    <label className="text-[11px] text-text-muted">
                      分类
                      <select
                        value={category ? candidate.categoryRef : ''}
                        onChange={event => updateDraft(index, { categoryRef: event.target.value })}
                        className="mt-1 w-full px-2.5 py-2 bg-bg-base border border-border rounded text-sm text-text-primary"
                      >
                        {!category && <option value="">原分类已不可用，请重新选择</option>}
                        {categories.map(option => (
                          <option key={option.ref} value={option.ref}>
                            {option.domain === 'natural' ? '自然' : option.domain === 'humanity' ? '人文' : '起源'}
                            {' · '}{option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className={`text-[11px] px-2 py-1 rounded ${
                    candidate.confidence >= 0.75
                      ? 'bg-success/10 text-success'
                      : 'bg-warning/10 text-warning'
                  }`}>
                    置信度 {Math.round(candidate.confidence * 100)}%
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pl-7">
                  <label className="text-[11px] text-text-muted">
                    一句话简介
                    <textarea
                      value={candidate.summary}
                      onChange={event => updateDraft(index, { summary: event.target.value })}
                      rows={2}
                      className="mt-1 w-full px-2.5 py-2 bg-bg-base border border-border rounded text-xs text-text-primary resize-y"
                    />
                  </label>
                  <label className="text-[11px] text-text-muted">
                    详细描述
                    <textarea
                      value={candidate.description}
                      onChange={event => updateDraft(index, { description: event.target.value })}
                      rows={2}
                      className="mt-1 w-full px-2.5 py-2 bg-bg-base border border-border rounded text-xs text-text-primary resize-y"
                    />
                  </label>
                </div>

                <div className="pl-7 text-[11px] text-text-muted space-y-1">
                  <div>
                    标签：{candidate.tags.join('、') || '无'}
                    {Object.keys(candidate.fields).length > 0
                      ? ` · 结构化字段：${Object.keys(candidate.fields).join('、')}`
                      : ''}
                  </div>
                  <div className="bg-bg-base border border-border rounded p-2 text-text-secondary">
                    <span className="text-text-muted">逐字证据：</span>
                    {candidate.evidence.map((evidence, evidenceIndex) => (
                      <span key={`${evidence.chunkIndex}:${evidenceIndex}`}>
                        {evidenceIndex > 0 && '；'}
                        第 {evidence.chunkIndex + 1} 块“{evidence.quote}”
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        <div className="px-5 py-3 border-t border-border bg-bg-base flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
            <AlertTriangle className="w-3.5 h-3.5 text-warning" />
            同名已有词条只补空字段，不覆盖作者的非空内容。
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onCancel}
              disabled={submitting}
              className="px-4 py-2 text-sm border border-border rounded text-text-secondary hover:bg-bg-hover disabled:opacity-50"
            >
              暂不导入
            </button>
            <button
              onClick={submit}
              disabled={submitting || selectedCount === 0 || drafts.some((draft, index) =>
                selected.has(index) && (!draft.name.trim() || !categoryByRef.has(draft.categoryRef)))}
              className="px-4 py-2 text-sm bg-accent text-white rounded hover:bg-accent-hover disabled:opacity-50"
            >
              {submitting ? '正在写入…' : `确认导入 ${selectedCount} 条`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
