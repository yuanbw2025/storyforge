import { CTextarea } from '../shared/CompositionInput'
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Check, Loader2, Microscope, Plus, RotateCcw, Sparkles, Trash2, X } from 'lucide-react'
import { useCreativeRulesStore } from '../../stores/project-singletons'
import { useWorldGroupStore } from '../../stores/world-group'
import { useReferenceStore } from '../../stores/reference'
import {
  formatCreativeRulesGenerationRequestV1,
  parseCreativeRulesCandidateDraftV1,
  type CreativeRulesField,
} from '../../lib/agent/creative-rules-copilot'
import { useMasterCopilot, type PendingMasterCandidate } from '../agent/useMasterCopilot'
import type { Project, NarrativePOV, WorkspaceScope } from '../../lib/types'
import type { SystemFictionElementsV1 } from '../../lib/types/creative-rules'
import { createSystemFictionElementsV1, parseSystemFictionElementsV1 } from '../../lib/prose/system-fiction-contract'
import SystemFictionElementsEditor from './SystemFictionElementsEditor'
import {
  INITIAL_RECORD_TARGET_CLASS,
  initialRecordTargetAttributes,
  useInitialRecordTarget,
} from '../shared/initial-record-target'
import HarnessEvidencePanel from '../agent/HarnessEvidencePanel'
import { useActiveWork } from '../../hooks/useActiveWork'

const POV_OPTIONS: { value: NarrativePOV; label: string; desc: string }[] = [
  { value: 'first-person', label: '第一人称', desc: '以"我"的视角叙述' },
  { value: 'third-limited', label: '第三人称有限', desc: '跟随某个角色的视角' },
  { value: 'third-omniscient', label: '第三人称全知', desc: '上帝视角，可看到所有角色内心' },
  { value: 'multi-pov', label: '多视角', desc: '在多个角色视角间切换' },
]

interface Props {
  project: Project
  initialRulesId?: number | null
}

export default function CreativeRulesPanel({ project, initialRulesId }: Props) {
  return <ScopedCreativeRulesPanel key={`${project.id}:${project.activeWorldId}:${project.activeWorkId}`} project={project} initialRulesId={initialRulesId} />
}

function ScopedCreativeRulesPanel({ project, initialRulesId }: Props) {
  const activeWork = useActiveWork(project)
  const { creativeRules: cachedRules, loadAll, save } = useCreativeRulesStore()
  const scope = useMemo<WorkspaceScope | null>(() => (
    project.id != null && project.activeWorldId != null && project.activeWorkId != null
      ? { projectId: project.id, worldId: project.activeWorldId, workId: project.activeWorkId }
      : null
  ), [project.id, project.activeWorldId, project.activeWorkId])
  const creativeRules = cachedRules?.projectId === scope?.projectId && cachedRules?.workId === scope?.workId ? cachedRules : null
  const { references, loadAll: loadRefs } = useReferenceStore()
  const activeGroupId = useWorldGroupStore(state => state.activeGroupId)
  const copilot = useMasterCopilot({
    project,
    worldGroupId: project.enableMultiWorld ? activeGroupId : null,
  })
  const [writingStyle, setWritingStyle] = useState('')
  const [narrativePOV, setNarrativePOV] = useState<NarrativePOV>('third-limited')
  const [atmosphere, setAtmosphere] = useState('')
  const [prohibitions, setProhibitions] = useState<string[]>([])
  const [consistencyRules, setConsistencyRules] = useState<string[]>([])
  const [specialRequirements, setSpecialRequirements] = useState('')
  const [citedRefIds, setCitedRefIds] = useState<number[]>([])
  const [elements, setElements] = useState(createSystemFictionElementsV1)
  const [elementsDirty, setElementsDirty] = useState(false)
  const elementsDirtyRef = useRef(false)
  const [ready, setReady] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savingElements, setSavingElements] = useState(false)
  useInitialRecordTarget(initialRulesId, creativeRules?.id === initialRulesId)

  useEffect(() => {
    if (!scope) return
    let active = true
    void Promise.all([loadAll(scope), loadRefs(scope.projectId)]).then(() => {
      if (active) setReady(true)
    }).catch(error => {
      if (active) setSaveError(error instanceof Error ? error.message : '资料加载失败，请重试')
    })
    return () => { active = false }
  }, [scope, loadAll, loadRefs])

  useEffect(() => {
    if (creativeRules) {
      setWritingStyle(creativeRules.writingStyle || '')
      setNarrativePOV(creativeRules.narrativePOV || 'third-limited')
      setAtmosphere(creativeRules.atmosphere)
      setSpecialRequirements(creativeRules.specialRequirements || '')
      try { setProhibitions(JSON.parse(creativeRules.prohibitions || '[]')) } catch { setProhibitions([]) }
      try { setConsistencyRules(JSON.parse(creativeRules.consistencyRules || '[]')) } catch { setConsistencyRules([]) }
      try { setCitedRefIds(JSON.parse(creativeRules.citedReferenceIds || '[]')) } catch { setCitedRefIds([]) }
      if (!elementsDirtyRef.current) {
        try { setElements(creativeRules.systemFictionElements === undefined ? createSystemFictionElementsV1() : parseSystemFictionElementsV1(creativeRules.systemFictionElements)) }
        catch (error) { setSaveError(error instanceof Error ? error.message : '系统文元素无法读取，原数据已保留') }
      }
    }
  }, [creativeRules])

  const saveField = useCallback(async (data: Record<string, unknown>) => {
    if (!scope || !ready) return
    try {
      await save({ projectId: scope.projectId, ...data }, scope)
      setSaveError(null)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '保存失败，当前输入已保留')
    }
  }, [scope, ready, save])

  const changeElements = (next: SystemFictionElementsV1) => {
    elementsDirtyRef.current = true
    setElementsDirty(true)
    setElements(next)
  }
  const saveElements = async () => {
    if (!scope || !ready) return
    setSavingElements(true)
    try {
      const validated = parseSystemFictionElementsV1(elements)
      await save({ projectId: scope.projectId, systemFictionElements: validated }, scope)
      elementsDirtyRef.current = false
      setElementsDirty(false)
      setSaveError(null)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '保存失败，当前输入已保留')
    } finally { setSavingElements(false) }
  }

  const pendingRulesCandidates = copilot.pendingCandidates.filter(candidate => (
    candidate.payload.skillId === 'world-origin.creative-rules'
  ))
  const hasOtherPendingCandidates = copilot.pendingCandidates.some(candidate => (
    candidate.payload.skillId !== 'world-origin.creative-rules'
  ))
  const generationBlocked = !ready || !scope || elementsDirty || copilot.loading
    || copilot.busy
    || copilot.pendingCandidates.length > 0
    || (project.enableMultiWorld === true && activeGroupId == null)

  const generateField = async (target: CreativeRulesField) => {
    const instruction = formatCreativeRulesGenerationRequestV1({ field: target })
    await copilot.submitTargetedRequest(
      `${instruction} 为“${activeWork?.title ?? '当前作品'}”提供可执行建议。`,
      {
        id: `creative-rules-${target}`,
        agentId: 'world-origin',
        skillId: 'world-origin.creative-rules',
        instruction,
      },
    )
  }

  const candidateFor = (field: CreativeRulesField) => pendingRulesCandidates.find(candidate => (
    candidate.payload.creativeRulesField === field
  ))

  const adoptCandidate = async (candidate: PendingMasterCandidate) => {
    const adopted = await copilot.adoptCandidate(candidate)
    if (adopted && scope) await loadAll(scope)
  }

  /* ---- 列表操作通用 ---- */
  const handleAddToList = (
    list: string[],
    setList: React.Dispatch<React.SetStateAction<string[]>>,
    field: string,
  ) => {
    const updated = [...list, '']
    setList(updated)
    saveField({ [field]: JSON.stringify(updated) })
  }

  const handleUpdateListItem = (
    list: string[],
    setList: React.Dispatch<React.SetStateAction<string[]>>,
    _field: string,
    index: number,
    value: string,
  ) => {
    const updated = [...list]
    updated[index] = value
    setList(updated)
    // 仅 blur 时保存，这里先更新本地
  }

  const handleBlurListItem = (
    list: string[],
    field: string,
  ) => {
    saveField({ [field]: JSON.stringify(list) })
  }

  const handleRemoveListItem = (
    list: string[],
    setList: React.Dispatch<React.SetStateAction<string[]>>,
    field: string,
    index: number,
  ) => {
    const updated = list.filter((_, i) => i !== index)
    setList(updated)
    saveField({ [field]: JSON.stringify(updated) })
  }

  /* ---- 列表渲染 ---- */
  const renderList = (
    title: string,
    placeholder: string,
    list: string[],
    setList: React.Dispatch<React.SetStateAction<string[]>>,
    field: string,
  ) => (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-2">
        <label className="text-sm font-medium text-text-secondary">{title} ({list.length})</label>
        <button
          onClick={() => handleAddToList(list, setList, field)}
          className="flex items-center gap-1 px-2 py-1 text-xs text-accent hover:bg-accent/10 rounded transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          添加
        </button>
      </div>
      {list.length === 0 ? (
        <p className="text-text-muted text-xs py-3 text-center border border-dashed border-border rounded-lg">暂无内容</p>
      ) : (
        <div className="space-y-1.5">
          {list.map((item, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <input
                value={item}
                onChange={e => handleUpdateListItem(list, setList, field, idx, e.target.value)}
                onBlur={() => handleBlurListItem(list, field)}
                placeholder={placeholder}
                className="flex-1 px-2 py-1.5 bg-bg-surface border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent"
              />
              <button
                onClick={() => handleRemoveListItem(list, setList, field, idx)}
                className="p-1 text-text-muted hover:text-red-400 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )

  return (
    <div
      {...initialRecordTargetAttributes(creativeRules?.id === initialRulesId, creativeRules?.id)}
      className={`max-w-4xl rounded-xl ${
        creativeRules?.id === initialRulesId ? INITIAL_RECORD_TARGET_CLASS : ''
      }`}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-text-primary">📐 创作规则</h2>
        {copilot.recoveryAvailable && pendingRulesCandidates.length === 0 && (
          <button
            type="button"
            onClick={() => { void copilot.resume() }}
            disabled={copilot.loading || copilot.busy}
            className="flex items-center gap-1.5 px-2.5 py-1.5 border border-border text-text-secondary text-xs rounded disabled:opacity-40 hover:text-accent"
          >
            <RotateCcw className="w-3.5 h-3.5" /> 恢复未完成生成
          </button>
        )}
      </div>

      {copilot.error && (
        <p className="mb-4 rounded border border-error/30 bg-error/5 px-3 py-2 text-xs text-error">
          {copilot.error}
        </p>
      )}

      {saveError && <p role="alert" className="mb-4 rounded border border-error/30 px-3 py-2 text-xs text-error">{saveError}</p>}

      <section aria-label="系统文元素配置" className="mb-6 space-y-3 rounded-lg border border-border p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-text-primary">系统文元素</h3>
          <button type="button" onClick={() => { void generateField('systemFictionElements') }} disabled={generationBlocked} className="flex items-center gap-1 text-xs text-accent disabled:opacity-50">
            <Sparkles className="h-3 w-3" /> AI 建议
          </button>
        </div>
        <p className="text-xs text-text-secondary">题材与呈现风格：{activeWork?.genres.join('、') || '在作品概况设置题材'}。文风和氛围使用下方现有字段；不会切换已激活的提示词模板。</p>
        <SystemFictionElementsEditor value={elements} onChange={changeElements} disabled={!ready || savingElements} />
        <div className="flex items-center justify-end gap-3">
          <span role="status" className="text-xs text-text-muted">{elementsDirty ? '元素尚未保存' : creativeRules?.systemFictionElements ? '元素已保存' : '尚未设置，可按需填写'}</span>
          <button type="button" onClick={() => { void saveElements() }} disabled={!ready || !elementsDirty || savingElements} className="rounded bg-accent px-3 py-1.5 text-xs text-white disabled:opacity-50">{savingElements ? '保存中…' : '保存元素'}</button>
        </div>
        <CreativeRulesCandidate candidate={candidateFor('systemFictionElements')} copilot={copilot} onAdopt={adoptCandidate} />
      </section>

      {hasOtherPendingCandidates && (
        <p className="mb-4 rounded border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-text-secondary">
          当前世界还有其它待确认候选，请先处理后再生成创作规则。
        </p>
      )}

      {/* 写作风格 */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-1">
          <label className="text-sm font-medium text-text-secondary">写作风格</label>
          <button
            onClick={() => generateField('writingStyle')}
            disabled={generationBlocked}
            className="flex items-center gap-1 px-2 py-1 text-xs text-accent hover:bg-accent/10 rounded transition-colors disabled:opacity-50"
          >
            <Sparkles className="w-3 h-3" /> AI 建议
          </button>
        </div>
        <CTextarea
          value={writingStyle}
          onChange={e => setWritingStyle(e.target.value)}
          onBlur={() => saveField({ writingStyle })}
          placeholder="描述期望的写作风格，如：简洁凌厉、文笔华丽、幽默诙谐、冷峻写实..."
          className="w-full h-24 p-3 bg-bg-surface border border-border rounded-lg text-text-primary text-sm resize-y focus:outline-none focus:border-accent"
        />
        <CreativeRulesCandidate
          candidate={candidateFor('writingStyle')}
          copilot={copilot}
          onAdopt={adoptCandidate}
        />
      </div>

      {/* 叙事视角 */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-text-secondary mb-2">叙事视角</label>
        <div className="grid grid-cols-2 gap-2">
          {POV_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => {
                setNarrativePOV(opt.value)
                saveField({ narrativePOV: opt.value })
              }}
              className={`p-3 rounded-lg border text-left transition-all ${
                narrativePOV === opt.value
                  ? 'border-accent bg-accent/10'
                  : 'border-border bg-bg-surface hover:border-text-muted'
              }`}
            >
              <div className="text-sm font-medium text-text-primary">{opt.label}</div>
              <div className="text-xs text-text-muted mt-0.5">{opt.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* 基调和氛围 */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-1">
          <label className="text-sm font-medium text-text-secondary">基调和氛围</label>
          <button
            onClick={() => generateField('atmosphere')}
            disabled={generationBlocked}
            className="flex items-center gap-1 px-2 py-1 text-xs text-accent hover:bg-accent/10 rounded transition-colors disabled:opacity-50"
          >
            <Sparkles className="w-3 h-3" /> AI 建议
          </button>
        </div>
        <CTextarea
          value={atmosphere}
          onChange={e => setAtmosphere(e.target.value)}
          onBlur={() => saveField({ atmosphere })}
          placeholder="描述作品的整体基调和氛围，如：黑暗压抑、热血激昂、温馨治愈..."
          className="w-full h-20 p-3 bg-bg-surface border border-border rounded-lg text-text-primary text-sm resize-y focus:outline-none focus:border-accent"
        />
        <CreativeRulesCandidate
          candidate={candidateFor('atmosphere')}
          copilot={copilot}
          onAdopt={adoptCandidate}
        />
      </div>

      {/* 禁止事项 */}
      {renderList('禁止事项', '如：不能出现现代用语', prohibitions, setProhibitions, 'prohibitions')}

      {/* 一致性规则 */}
      {renderList('一致性规则', '如：修炼体系必须遵循金木水火土五行', consistencyRules, setConsistencyRules, 'consistencyRules')}

      {/* 引用手法 —— Phase 20 */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-medium text-text-secondary flex items-center gap-1.5">
            <Microscope className="w-3.5 h-3.5 text-accent" />
            引用手法
          </label>
          <span className="text-[10px] text-text-muted">
            勾选后，AI 写作时会参考这些作品的分析方法论
          </span>
        </div>
        {(() => {
          const analyzedRefs = references.filter(r => r.analysisStatus === 'done')
          if (analyzedRefs.length === 0) {
            return (
              <p className="text-text-muted text-xs py-3 text-center border border-dashed border-border rounded-lg">
                暂无已分析的参考作品。请先在「项目参考 → 深度分析」上传文件并完成分析。
              </p>
            )
          }
          return (
            <div className="space-y-1">
              {analyzedRefs.map(ref => {
                const checked = citedRefIds.includes(ref.id!)
                return (
                  <button
                    key={ref.id}
                    onClick={() => {
                      const next = checked
                        ? citedRefIds.filter(id => id !== ref.id!)
                        : [...citedRefIds, ref.id!]
                      setCitedRefIds(next)
                      saveField({ citedReferenceIds: JSON.stringify(next) })
                    }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-all border ${
                      checked
                        ? 'border-accent/40 bg-accent/8'
                        : 'border-border hover:border-text-muted bg-bg-surface'
                    }`}
                  >
                    <div className={`w-4 h-4 rounded flex items-center justify-center shrink-0 border transition-colors ${
                      checked ? 'bg-accent border-accent' : 'border-border'
                    }`}>
                      {checked && <Check className="w-3 h-3 text-white" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-text-primary">{ref.title}</span>
                      {ref.author && <span className="text-xs text-text-muted ml-1.5">— {ref.author}</span>}
                    </div>
                    {ref.totalChars && (
                      <span className="text-[10px] text-text-muted shrink-0">
                        {(ref.totalChars / 10000).toFixed(1)}万字
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          )
        })()}
      </div>

      {/* 特殊创作要求 */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-1">
          <label className="text-sm font-medium text-text-secondary">特殊创作要求</label>
          <button
            onClick={() => generateField('specialRequirements')}
            disabled={generationBlocked}
            className="flex items-center gap-1 px-2 py-1 text-xs text-accent hover:bg-accent/10 rounded transition-colors disabled:opacity-50"
          >
            <Sparkles className="w-3 h-3" /> AI 建议
          </button>
        </div>
        <CTextarea
          value={specialRequirements}
          onChange={e => setSpecialRequirements(e.target.value)}
          onBlur={() => saveField({ specialRequirements })}
          placeholder="其他需要 AI 遵守的特殊创作要求..."
          className="w-full h-24 p-3 bg-bg-surface border border-border rounded-lg text-text-primary text-sm resize-y focus:outline-none focus:border-accent"
        />
        <CreativeRulesCandidate
          candidate={candidateFor('specialRequirements')}
          copilot={copilot}
          onAdopt={adoptCandidate}
        />
      </div>
    </div>
  )
}

function CreativeRulesCandidate({
  candidate,
  copilot,
  onAdopt,
}: {
  candidate?: PendingMasterCandidate
  copilot: ReturnType<typeof useMasterCopilot>
  onAdopt: (candidate: PendingMasterCandidate) => Promise<void>
}) {
  if (!candidate) return null
  let parsed: ReturnType<typeof parseCreativeRulesCandidateDraftV1> | null = null
  try {
    parsed = parseCreativeRulesCandidateDraftV1(candidate.event.content)
  } catch {
    // Keep the raw editor available so a malformed restored candidate can be repaired or rejected.
  }
  const updateValue = (value: string | SystemFictionElementsV1) => {
    if (!candidate.payload.creativeRulesField) return
    void copilot.updateCandidate(candidate.event.id!, JSON.stringify({
      field: candidate.payload.creativeRulesField,
      value,
    }, null, 2))
  }
  return (
    <section className="mt-2 border border-accent/30 bg-bg-surface p-3 rounded-lg">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-xs font-semibold text-text-primary">待确认 · {candidate.payload.label}</span>
        <span className="text-[11px] text-text-muted">
          {candidate.payload.contextEvidence
            ? `约 ${candidate.payload.contextEvidence.estimatedInputTokens.toLocaleString()} tokens`
            : `${candidate.payload.contextSources.length} 个输入来源`}
        </span>
      </div>
      {parsed?.field === 'systemFictionElements' ? (
        <SystemFictionElementsEditor value={parsed.value} onChange={updateValue} disabled={copilot.busy} label="系统文元素候选" />
      ) : parsed ? (
        <CTextarea
          aria-label={`${candidate.payload.label}候选内容`}
          value={parsed.value}
          disabled={copilot.busy}
          onChange={event => updateValue(event.target.value)}
          className="min-h-28 w-full resize-y text-sm leading-5"
        />
      ) : (
        <>
          <p className="mb-2 text-xs text-error">候选结构已损坏，可修复严格 JSON 后再确认，或直接拒绝。</p>
          <CTextarea
            aria-label={`${candidate.payload.label}候选原始内容`}
            value={candidate.event.content}
            disabled={copilot.busy}
            onChange={event => { void copilot.updateCandidate(candidate.event.id!, event.target.value) }}
            className="min-h-32 w-full resize-y font-mono text-xs leading-5"
          />
        </>
      )}
      <HarnessEvidencePanel
        contextEvidence={candidate.payload.contextEvidence}
        lifecycle={candidate.lifecycle}
        promptExecutionEvidence={candidate.payload.promptExecutionEvidence}
      />
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          disabled={copilot.busy}
          onClick={() => { void copilot.rejectCandidate(candidate) }}
          className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-text-muted hover:bg-bg-hover hover:text-text-primary rounded disabled:opacity-50"
        >
          <Trash2 className="h-3.5 w-3.5" /> 拒绝
        </button>
        <button
          type="button"
          disabled={copilot.busy || !parsed}
          onClick={() => { void onAdopt(candidate) }}
          className="flex items-center gap-1 bg-accent px-3 py-1.5 text-xs text-white hover:opacity-90 rounded disabled:opacity-50"
        >
          {copilot.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          确认写入
        </button>
      </div>
    </section>
  )
}
