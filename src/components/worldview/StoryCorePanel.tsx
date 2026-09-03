import { useState, useEffect } from 'react'
import { Check, Loader2, Sparkles, Trash2 } from 'lucide-react'
import { useWorldviewStore } from '../../stores/worldview'
import { useWorldGroupStore } from '../../stores/world-group'
import PromptRunPanel from '../shared/PromptRunPanel'
import { InlineTextarea } from '../shared/InlineEdit'
import AIFieldModeTabs from '../shared/AIFieldModeTabs'
import { CTextarea } from '../shared/CompositionInput'
import { useMasterCopilot, type PendingMasterCandidate } from '../agent/useMasterCopilot'
import {
  formatStoryCoreGenerationRequestV1,
  type StoryCoreField,
} from '../../lib/agent/story-core-copilot'
import { STORY_CORE_GENERATABLE_FIELD_SPECS } from '../../lib/registry/field-registry'
import type { Project } from '../../lib/types'
import type { FieldGenerationMode } from '../../lib/ai/field-generation-context'
import {
  INITIAL_RECORD_TARGET_CLASS,
  initialRecordTargetAttributes,
  useInitialRecordTarget,
} from '../shared/initial-record-target'
import HarnessEvidencePanel from '../agent/HarnessEvidencePanel'

// ── 字段定义 ──────────────────────────────────────────────────

interface FieldDef {
  key: StoryCoreField
  emoji: string
  label: string
  description: string
  dimension: string
  saveKey: StoryCoreField
}

const FIELD_PRESENTATION: Record<StoryCoreField, Pick<FieldDef, 'emoji' | 'description' | 'dimension'>> = {
  logline: { emoji: '📜', description: '用一句话讲清楚你的故事是什么。', dimension: '一句话故事（logline）' },
  concept: { emoji: '💡', description: "独特设定或反差点：'如果……会怎么样？'", dimension: '故事概念（high concept）' },
  theme: { emoji: '🎯', description: '想探讨的人性/价值观主题。', dimension: '故事主题' },
  centralConflict: { emoji: '⚔️', description: '主角面对的最大矛盾（外在 + 内在）。', dimension: '核心冲突' },
  plotPattern: { emoji: '📊', description: '线性 / 莲花地图 / 多线并行 / 蒙太奇 等。', dimension: '故事模式' },
  mainPlot: { emoji: '🛤', description: '核心情节意图 — 主角的目标与阻碍；确认后可投影为多条可执行故事线。', dimension: '故事主线意图' },
  subPlots: { emoji: '🎼', description: '副线意图（情感线 / 配角线 / 暗线 / 悬念线），可投影为多条故事线。', dimension: '故事复线意图' },
}

export const STORY_CORE_PANEL_FIELDS: readonly FieldDef[] = STORY_CORE_GENERATABLE_FIELD_SPECS.map(spec => ({
  key: spec.field,
  label: spec.aiGeneration.label,
  saveKey: spec.field,
  ...FIELD_PRESENTATION[spec.field],
}))

const FIELDS = STORY_CORE_PANEL_FIELDS

// ── 主面板 ─────────────────────────────────────────────────────

interface Props {
  project: Project
  initialStoryCoreId?: number | null
}

export default function StoryCorePanel({ project, initialStoryCoreId }: Props) {
  const { storyCore, saveStoryCore, loadAll } = useWorldviewStore()
  const activeGroupId = useWorldGroupStore(s => s.activeGroupId)
  const copilot = useMasterCopilot({
    project,
    worldGroupId: project.enableMultiWorld ? activeGroupId : null,
  })

  const [values, setValues] = useState<Record<string, string>>({})
  const [activeKey, setActiveKey] = useState(FIELDS[0].key)
  const [runningKey, setRunningKey] = useState<StoryCoreField | null>(null)
  useInitialRecordTarget(initialStoryCoreId, storyCore?.id === initialStoryCoreId)

  useEffect(() => {
    loadAll(project.id!, project.enableMultiWorld ? activeGroupId : null)
  }, [project.id, project.enableMultiWorld, activeGroupId, loadAll])

  useEffect(() => {
    if (!storyCore) return
    setValues({
      logline:         storyCore.logline || '',
      concept:         storyCore.concept || '',
      theme:           storyCore.theme || '',
      centralConflict: storyCore.centralConflict || '',
      plotPattern:     storyCore.plotPattern || '',
      mainPlot:        storyCore.mainPlot || '',
      subPlots:        storyCore.subPlots || '',
    })
  }, [storyCore])

  const save = (key: string, v: string) => {
    const field = FIELDS.find(f => f.key === key)!
    saveStoryCore({ projectId: project.id!, [field.saveKey]: v })
  }

  const pendingStoryCoreCandidates = copilot.pendingCandidates.filter(candidate => (
    candidate.payload.skillId === 'world-origin.story-core'
  ))
  const pendingStoryCoreField = pendingStoryCoreCandidates[0]?.payload.storyCoreField
  const hasOtherPendingCandidates = copilot.pendingCandidates.some(candidate => (
    candidate.payload.skillId !== 'world-origin.story-core'
  ))

  useEffect(() => {
    if (pendingStoryCoreField) setActiveKey(pendingStoryCoreField)
  }, [pendingStoryCoreField])

  return (
    <div
      {...initialRecordTargetAttributes(storyCore?.id === initialStoryCoreId, storyCore?.id)}
      className={`flex gap-4 max-w-5xl rounded-xl ${
        storyCore?.id === initialStoryCoreId ? INITIAL_RECORD_TARGET_CLASS : ''
      }`}
    >
      {/* ── 左侧导航 ── */}
      <div className="w-fit min-w-32 max-w-40 shrink-0 space-y-0.5 pt-1">
        {FIELDS.map(f => {
          const active = activeKey === f.key
          const hasContent = !!values[f.key]
          const isFieldStreaming = copilot.busy && runningKey === f.key
          const hasPendingCandidate = pendingStoryCoreField === f.key
          return (
            <button
              key={f.key}
              onClick={() => setActiveKey(f.key)}
              className={`w-full flex items-center gap-2 px-2 py-2 rounded-lg text-left transition-all ${
                active
                  ? 'bg-accent/8 border-l-2 border-accent'
                  : 'hover:bg-bg-hover border-l-2 border-transparent'
              }`}
            >
              <span className="text-base shrink-0">{f.emoji}</span>
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-medium truncate ${active ? 'text-accent' : 'text-text-primary'}`}>
                  {f.label}
                </p>
                {hasContent && (
                  <p className="text-[10px] text-text-muted truncate">
                    {values[f.key].slice(0, 12)}…
                  </p>
                )}
              </div>
              {isFieldStreaming && !active && (
                <span className="w-2 h-2 rounded-full bg-accent animate-pulse shrink-0" />
              )}
              {hasPendingCandidate && !isFieldStreaming && (
                <span
                  className="w-2 h-2 rounded-full bg-warning shrink-0"
                  title="有待确认候选"
                  aria-label={`${f.label}有待确认候选`}
                />
              )}
            </button>
          )
        })}
      </div>

      {/* ── 右侧：所有字段同时渲染，hidden 控制显示 ── */}
      <div className="flex-1 min-w-0">
        {FIELDS.map(f => (
          <div key={f.key} className={activeKey === f.key ? '' : 'hidden'}>
            <FieldEditor
              field={f}
              value={values[f.key] || ''}
              onChange={v => {
                setValues(prev => ({ ...prev, [f.key]: v }))
                save(f.key, v)
              }}
              project={project}
              activeGroupId={activeGroupId}
              copilot={copilot}
              candidate={pendingStoryCoreCandidates.find(candidate => candidate.payload.storyCoreField === f.key)}
              otherPendingStoryCoreLabel={pendingStoryCoreCandidates.find(
                candidate => candidate.payload.storyCoreField !== f.key,
              )?.payload.label}
              hasOtherPendingCandidates={hasOtherPendingCandidates}
              onRunningChange={running => setRunningKey(running ? f.key : null)}
              onAdopted={async candidate => {
                await copilot.adoptCandidate(candidate)
                await loadAll(project.id!, project.enableMultiWorld ? activeGroupId : null)
              }}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

// ── 单字段编辑器（各自独立的 AI 流） ──────────────────────────

function FieldEditor({
  field,
  value,
  onChange,
  project,
  activeGroupId,
  copilot,
  candidate,
  otherPendingStoryCoreLabel,
  hasOtherPendingCandidates,
  onRunningChange,
  onAdopted,
}: {
  field: FieldDef
  value: string
  onChange: (v: string) => void
  project: Project
  activeGroupId: number | null
  copilot: ReturnType<typeof useMasterCopilot>
  candidate?: PendingMasterCandidate
  otherPendingStoryCoreLabel?: string
  hasOtherPendingCandidates: boolean
  onRunningChange: (running: boolean) => void
  onAdopted: (candidate: PendingMasterCandidate) => Promise<void>
}) {
  const [hint, setHint] = useState('')
  const [parameterValues, setParameterValues] = useState<Record<string, unknown>>({})
  const [systemOverride, setSystemOverride] = useState<string | null>(null)
  const [userOverride, setUserOverride] = useState<string | null>(null)
  const [mode, setMode] = useState<FieldGenerationMode>('expand')
  const handleGenerate = async () => {
    onRunningChange(true)
    try {
      const request = formatStoryCoreGenerationRequestV1({
        field: field.key,
        mode,
        hint,
      })
      await copilot.submitTargetedRequest(request, {
        agentId: 'world-origin',
        skillId: 'world-origin.story-core',
        instruction: request,
        promptExecution: {
          version: 1,
          moduleKey: 'story.generate',
          ...(Object.keys(parameterValues).length ? { parameterValues } : {}),
          ...(systemOverride === null ? {} : { systemOverride }),
          ...(userOverride === null ? {} : { userOverride }),
        },
      })
    } finally {
      onRunningChange(false)
    }
  }

  const blocked = copilot.loading
    || copilot.busy
    || copilot.pendingCandidates.length > 0
    || (project.enableMultiWorld === true && activeGroupId == null)

  return (
    <div className="space-y-4">
      {/* 标题 + 描述 */}
      <div>
        <h2 className="text-xl font-bold text-text-primary mb-0.5">
          {field.emoji} {field.label}
        </h2>
        <p className="text-sm text-text-muted">{field.description}</p>
      </div>

      {/* 内容区 — 行内编辑 */}
      <div className="bg-bg-surface border border-border rounded-lg p-4">
        <InlineTextarea
          value={value}
          onChange={onChange}
          placeholder={`点击填写${field.label}…`}
        />
      </div>

      {/* AI 生成区 */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <AIFieldModeTabs value={mode} onChange={setMode} />
          <input
            value={hint}
            onChange={e => setHint(e.target.value)}
            placeholder="补充提示（可选）"
            className="flex-1 px-2 py-1.5 bg-bg-surface border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent"
          />
          <button
            onClick={handleGenerate}
            disabled={blocked}
            className="flex items-center gap-1.5 px-3 py-2 bg-bg-elevated text-text-secondary text-sm rounded-md hover:text-accent disabled:opacity-50 transition-colors border border-border hover:border-accent/50"
          >
            {copilot.busy
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <Sparkles className="w-3.5 h-3.5" />}
            AI 生成
          </button>
        </div>

        <PromptRunPanel
          moduleKey="story.generate"
          parameterValues={parameterValues}
          onParamChange={setParameterValues}
          systemOverride={systemOverride}
          onSystemOverrideChange={setSystemOverride}
          userOverride={userOverride}
          onUserOverrideChange={setUserOverride}
        />

        {copilot.error && (
          <p className="rounded border border-error/30 bg-error/5 px-3 py-2 text-xs text-error">
            {copilot.error}
          </p>
        )}

        {hasOtherPendingCandidates && (
          <p className="rounded border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-text-secondary">
            主 Agent 还有其他待确认候选，请先在右侧副驾中处理。
          </p>
        )}

        {!candidate && otherPendingStoryCoreLabel && (
          <p className="rounded border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-text-secondary">
            “{otherPendingStoryCoreLabel}”还有待确认候选，请先处理后再生成其他字段。
          </p>
        )}

        {candidate && (
          <section className="border border-accent/30 bg-bg-surface p-4 rounded-lg">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-text-primary">待确认 · {candidate.payload.label}</h3>
              <span className="text-[11px] text-text-muted">
                {candidate.payload.contextEvidence
                  ? `约 ${candidate.payload.contextEvidence.estimatedInputTokens.toLocaleString()} tokens`
                  : `${candidate.payload.contextSources.length} 个输入来源`}
              </span>
            </div>
            <CTextarea
              aria-label={`${candidate.payload.label}候选内容`}
              value={candidate.event.content}
              disabled={copilot.busy}
              onChange={event => {
                void copilot.updateCandidate(candidate.event.id!, event.target.value)
              }}
              className="min-h-48 w-full resize-y font-mono text-xs leading-5"
            />
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
                <Trash2 className="h-3.5 w-3.5" />
                拒绝
              </button>
              <button
                type="button"
                disabled={copilot.busy}
                onClick={() => { void onAdopted(candidate) }}
                className="flex items-center gap-1 bg-accent px-3 py-1.5 text-xs text-white hover:opacity-90 rounded disabled:opacity-50"
              >
                {copilot.busy
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <Check className="h-3.5 w-3.5" />}
                采纳
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

// InlineTextarea 已移至 shared/InlineEdit.tsx（组合输入安全版）
