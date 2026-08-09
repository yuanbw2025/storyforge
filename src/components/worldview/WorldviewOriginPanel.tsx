import { useState, useEffect } from 'react'
import { useWorldviewStore } from '../../stores/worldview'
import { useWorldGroupStore } from '../../stores/world-group'
import WorldGroupSwitcher from '../world-group/WorldGroupSwitcher'
import { InlineTextarea } from '../shared/InlineEdit'
import CodexPanel from '../codex/CodexPanel'
import CodexSearchBar from '../codex/CodexSearchBar'
import { useMasterCopilot, type PendingMasterCandidate } from '../agent/useMasterCopilot'
import WorldviewAgentControls from './WorldviewAgentControls'
import WorldviewOriginSidebar, {
  WORLDVIEW_ORIGIN_FIELDS,
  type WorldviewOriginFieldKey,
} from './WorldviewOriginSidebar'
import CultivationSystemsPanel from './CultivationSystemsPanel'
import type { Project, DivineDesign } from '../../lib/types'
import type { WorldviewAgentField } from '../../lib/agent/worldview-field-copilot'

const AGENT_FIELD_BY_ORIGIN_KEY: Record<WorldviewOriginFieldKey, WorldviewAgentField> = {
  origin: 'worldOrigin',
  power: 'powerHierarchy',
  divine: 'divineDesign',
}

interface Props {
  project: Project
}

// ── 主面板 ─────────────────────────────────────────────────────

/** v3 §2.1 — 世界观.世界起源（三个子模块） */
export default function WorldviewOriginPanel({ project }: Props) {
  const { worldview, saveWorldview, loadAll } = useWorldviewStore()
  const activeGroupId = useWorldGroupStore(s => s.activeGroupId)
  const copilot = useMasterCopilot({
    project,
    worldGroupId: project.enableMultiWorld ? activeGroupId : null,
  })

  const [active, setActive] = useState<WorldviewOriginFieldKey>('origin')
  const [worldOrigin, setWorldOrigin] = useState('')
  const [powerHierarchy, setPowerHierarchy] = useState('')
  const [divineDesign, setDivineDesign] = useState<DivineDesign>({
    hasDivinity: false,
    divineRank: '',
    divineNames: '',
    divineRules: '',
  })
  const [runningField, setRunningField] = useState<WorldviewAgentField | null>(null)

  // 多世界模式下按当前世界组加载，单世界传 null 走原逻辑
  useEffect(() => {
    loadAll(project.id!, project.enableMultiWorld ? activeGroupId : null)
  }, [project.id, project.enableMultiWorld, activeGroupId, loadAll])

  // 同步 store -> 本地 state
  useEffect(() => {
    if (!worldview) return
    setWorldOrigin(worldview.worldOrigin || '')
    setPowerHierarchy(worldview.powerHierarchy || '')
    setDivineDesign(worldview.divineDesign || {
      hasDivinity: false, divineRank: '', divineNames: '', divineRules: '',
    })
  }, [worldview])

  // 通用保存
  const save = (patch: Partial<typeof worldview>) =>
    saveWorldview({ projectId: project.id!, ...patch })

  const pendingWorldviewCandidates = copilot.pendingCandidates.filter(candidate => (
    candidate.payload.skillId === 'world-origin.worldview-field'
  ))
  const pendingWorldviewField = pendingWorldviewCandidates[0]?.payload.worldviewField
  const pendingOriginKey = (Object.entries(AGENT_FIELD_BY_ORIGIN_KEY) as Array<[
    WorldviewOriginFieldKey,
    WorldviewAgentField,
  ]>).find(([, field]) => field === pendingWorldviewField)?.[0]
  const hasOtherPendingCandidates = copilot.pendingCandidates.some(candidate => (
    candidate.payload.skillId !== 'world-origin.worldview-field'
  ))
  const streamingKeys = new Set<string>()
  const pendingKeys = new Set<string>()
  const runningOriginKey = (Object.entries(AGENT_FIELD_BY_ORIGIN_KEY) as Array<[
    WorldviewOriginFieldKey,
    WorldviewAgentField,
  ]>).find(([, field]) => field === runningField)?.[0]
  if (copilot.busy && runningOriginKey) streamingKeys.add(runningOriginKey)
  if (pendingOriginKey) pendingKeys.add(pendingOriginKey)

  useEffect(() => {
    if (pendingOriginKey) setActive(pendingOriginKey)
  }, [pendingOriginKey])

  return (
    <div className="flex flex-col w-full max-w-5xl space-y-4">
      {/* 顶部 */}
      <div className="pb-4 border-b border-border/40">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-xl font-bold text-text-primary flex items-center gap-2">
            🌌 世界起源与核心设定
          </h2>
          {project.enableMultiWorld && <WorldGroupSwitcher />}
        </div>
        <p className="text-xs text-text-muted mt-0.5">
          定义世界的起源、力量体系与信仰体系。如需声明真实与幻想的规则，请前往「⚖️ 真实与幻想」面板。
        </p>
        <div className="mt-3 max-w-xl">
          <CodexSearchBar
            categoryKeys={['originPower', 'originDeity']}
            onJump={(catKey) => setActive(catKey === 'originDeity' ? 'divine' : 'power')}
          />
        </div>
      </div>

      <div className="flex gap-4">
        {/* ── 左侧边栏 ── */}
        <WorldviewOriginSidebar
          active={active}
          streamingKeys={streamingKeys}
          pendingKeys={pendingKeys}
          onSelect={setActive}
        />

        {/* ── 右侧：所有字段同时渲染，hidden 控制显示 ── */}
        <div className="flex-1 min-w-0">
          {/* 世界来源 */}
          <div className={active === 'origin' ? '' : 'hidden'}>
            <TextFieldEditor
              field={WORLDVIEW_ORIGIN_FIELDS[0]}
              value={worldOrigin}
              onChange={v => { setWorldOrigin(v); save({ worldOrigin: v }) }}
              project={project}
              agentField="worldOrigin"
              activeGroupId={activeGroupId}
              copilot={copilot}
              candidate={pendingWorldviewCandidates.find(candidate => candidate.payload.worldviewField === 'worldOrigin')}
              otherPendingWorldviewLabel={pendingWorldviewCandidates.find(candidate => candidate.payload.worldviewField !== 'worldOrigin')?.payload.label}
              hasOtherPendingCandidates={hasOtherPendingCandidates}
              onRunningChange={running => setRunningField(running ? 'worldOrigin' : null)}
              onAdopted={async candidate => {
                await copilot.adoptCandidate(candidate)
                await loadAll(project.id!, project.enableMultiWorld ? activeGroupId : null)
              }}
            />
          </div>

          {/* 力量体系:全貌(上) + 具体词条(下) */}
          <div className={active === 'power' ? '' : 'hidden'}>
            <TextFieldEditor
              field={WORLDVIEW_ORIGIN_FIELDS[1]}
              value={powerHierarchy}
              onChange={v => { setPowerHierarchy(v); save({ powerHierarchy: v }) }}
              project={project}
              agentField="powerHierarchy"
              activeGroupId={activeGroupId}
              copilot={copilot}
              candidate={pendingWorldviewCandidates.find(candidate => candidate.payload.worldviewField === 'powerHierarchy')}
              otherPendingWorldviewLabel={pendingWorldviewCandidates.find(candidate => candidate.payload.worldviewField !== 'powerHierarchy')?.payload.label}
              hasOtherPendingCandidates={hasOtherPendingCandidates}
              onRunningChange={running => setRunningField(running ? 'powerHierarchy' : null)}
              onAdopted={async candidate => {
                await copilot.adoptCandidate(candidate)
                await loadAll(project.id!, project.enableMultiWorld ? activeGroupId : null)
              }}
            />
            <CultivationSystemsPanel project={project} />
            <div className="mt-6">
              <h3 className="text-sm font-semibold text-text-primary mb-1">📚 力量层级 · 具体词条</h3>
              <p className="text-xs text-text-muted mb-3">在上面写完力量体系「全貌」后，这里把各等级/层级逐条登记，可自定义字段、打重要度星级，并进入 AI 生成上下文。</p>
              <CodexPanel
                project={project}
                fixedCategoryKeys={['originPower']}
                extractionSourceText={powerHierarchy}
                embedded
              />
            </div>
          </div>

          {/* 神明与信仰:全貌(上) + 具体词条(下) */}
          <div className={active === 'divine' ? '' : 'hidden'}>
            <DivineFieldEditor
              field={WORLDVIEW_ORIGIN_FIELDS[2]}
              divineDesign={divineDesign}
              onDivineChange={async (next) => {
                setDivineDesign(next)
                await save({ divineDesign: next })
              }}
              project={project}
              activeGroupId={activeGroupId}
              copilot={copilot}
              candidate={pendingWorldviewCandidates.find(candidate => candidate.payload.worldviewField === 'divineDesign')}
              otherPendingWorldviewLabel={pendingWorldviewCandidates.find(candidate => candidate.payload.worldviewField !== 'divineDesign')?.payload.label}
              hasOtherPendingCandidates={hasOtherPendingCandidates}
              onRunningChange={running => setRunningField(running ? 'divineDesign' : null)}
              onAdopted={async candidate => {
                await copilot.adoptCandidate(candidate)
                await loadAll(project.id!, project.enableMultiWorld ? activeGroupId : null)
              }}
            />
            <div className="mt-6">
              <h3 className="text-sm font-semibold text-text-primary mb-1">📚 神明信仰 · 具体词条</h3>
              <p className="text-xs text-text-muted mb-3">在上面写完信仰体系「全貌」后，这里把各神明/信仰逐条登记，可自定义字段、打重要度星级，并进入 AI 生成上下文。</p>
              <CodexPanel
                project={project}
                fixedCategoryKeys={['originDeity']}
                extractionSourceText={[
                  divineDesign.divineNames,
                  divineDesign.divineRank,
                  divineDesign.divineRules,
                ].filter(Boolean).join('\n\n')}
                embedded
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── 文本字段编辑器（世界来源 / 力量体系） ────────────────────────

function TextFieldEditor({
  field,
  value,
  onChange,
  project,
  agentField,
  activeGroupId,
  copilot,
  candidate,
  otherPendingWorldviewLabel,
  hasOtherPendingCandidates,
  onRunningChange,
  onAdopted,
}: {
  field: typeof WORLDVIEW_ORIGIN_FIELDS[number]
  value: string
  onChange: (v: string) => void
  project: Project
  agentField: WorldviewAgentField
  activeGroupId: number | null
  copilot: ReturnType<typeof useMasterCopilot>
  candidate?: PendingMasterCandidate
  otherPendingWorldviewLabel?: string
  hasOtherPendingCandidates: boolean
  onRunningChange: (running: boolean) => void
  onAdopted: (candidate: PendingMasterCandidate) => Promise<void>
}) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-text-primary flex items-center gap-2">
          <span>{field.icon}</span> {field.label}
        </h2>
        <p className="text-xs text-text-muted mt-0.5">{field.desc}</p>
      </div>

      <div className="bg-bg-surface border border-border rounded-lg p-4">
        <InlineTextarea value={value} onChange={onChange} placeholder={field.desc} />
      </div>
      <WorldviewAgentControls
        field={agentField}
        project={project}
        activeGroupId={activeGroupId}
        copilot={copilot}
        candidate={candidate}
        otherPendingWorldviewLabel={otherPendingWorldviewLabel}
        hasOtherPendingCandidates={hasOtherPendingCandidates}
        onRunningChange={onRunningChange}
        onAdopted={onAdopted}
      />
    </div>
  )
}

// ── 神明与信仰编辑器（人工字段 + 受治理结构化候选） ────────────────

function DivineFieldEditor({
  field,
  divineDesign,
  onDivineChange,
  project,
  activeGroupId,
  copilot,
  candidate,
  otherPendingWorldviewLabel,
  hasOtherPendingCandidates,
  onRunningChange,
  onAdopted,
}: {
  field: typeof WORLDVIEW_ORIGIN_FIELDS[number]
  divineDesign: DivineDesign
  onDivineChange: (next: DivineDesign) => Promise<void>
  project: Project
  activeGroupId: number | null
  copilot: ReturnType<typeof useMasterCopilot>
  candidate?: PendingMasterCandidate
  otherPendingWorldviewLabel?: string
  hasOtherPendingCandidates: boolean
  onRunningChange: (running: boolean) => void
  onAdopted: (candidate: PendingMasterCandidate) => Promise<void>
}) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-text-primary flex items-center gap-2">
          <span>{field.icon}</span> {field.label}
        </h2>
        <p className="text-xs text-text-muted mt-0.5">{field.desc}</p>
      </div>

      {/* 存在神明/信仰 checkbox */}
      <label className="flex items-center gap-2 text-sm cursor-pointer">
        <input
          type="checkbox"
          checked={divineDesign.hasDivinity}
          onChange={e => {
            onDivineChange({ ...divineDesign, hasDivinity: e.target.checked })
          }}
          className="accent-accent"
        />
        <span className="text-text-secondary">存在神明或宗教信仰</span>
      </label>

      {divineDesign.hasDivinity && (
        <div className="space-y-0 divide-y divide-border/40">
          <div className="flex gap-4 py-3 first:pt-0">
            <span className="w-24 shrink-0 text-xs text-text-muted pt-0.5 text-right">信仰层级</span>
            <div className="flex-1 min-w-0">
              <InlineTextarea
                value={divineDesign.divineRank}
                onChange={v => onDivineChange({ ...divineDesign, divineRank: v })}
                placeholder="例：主神 / 次神 / 半神 / 国教 / 民间信仰 ..."
              />
            </div>
          </div>
          <div className="flex gap-4 py-3">
            <span className="w-24 shrink-0 text-xs text-text-muted pt-0.5 text-right">名号与职司</span>
            <div className="flex-1 min-w-0">
              <InlineTextarea
                value={divineDesign.divineNames}
                onChange={v => onDivineChange({ ...divineDesign, divineNames: v })}
                placeholder="例：天帝 · 创世神；关帝信仰；妈祖信仰 ..."
              />
            </div>
          </div>
          <div className="flex gap-4 py-3">
            <span className="w-24 shrink-0 text-xs text-text-muted pt-0.5 text-right">规则与禁忌</span>
            <div className="flex-1 min-w-0">
              <InlineTextarea
                value={divineDesign.divineRules}
                onChange={v => onDivineChange({ ...divineDesign, divineRules: v })}
                placeholder="例：不可直接干涉凡间 / 避讳字 / 祭祀风俗 ..."
              />
            </div>
          </div>
        </div>
      )}

      <WorldviewAgentControls
        field="divineDesign"
        project={project}
        activeGroupId={activeGroupId}
        copilot={copilot}
        candidate={candidate}
        otherPendingWorldviewLabel={otherPendingWorldviewLabel}
        hasOtherPendingCandidates={hasOtherPendingCandidates}
        onRunningChange={onRunningChange}
        onAdopted={onAdopted}
        buttonLabel="AI 生成信仰体系"
      />
    </div>
  )
}
