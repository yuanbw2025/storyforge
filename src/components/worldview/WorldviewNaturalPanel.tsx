import { useState, useEffect } from 'react'
import { useWorldviewStore } from '../../stores/worldview'
import { useWorldGroupStore } from '../../stores/world-group'
import WorldGroupSwitcher from '../world-group/WorldGroupSwitcher'
import CodexPanel from '../codex/CodexPanel'
import CodexSearchBar from '../codex/CodexSearchBar'
import { InlineTextarea } from '../shared/InlineEdit'
import { useMasterCopilot, type PendingMasterCandidate } from '../agent/useMasterCopilot'
import WorldviewAgentControls from './WorldviewAgentControls'
import type { Project, NaturalResources } from '../../lib/types'
import type { WorldviewAgentField } from '../../lib/agent/worldview-field-copilot'

interface Props { project: Project }

// ── 字段定义（统一标签，兼容幻想与历史） ─────────────────────────

const FIELDS = [
  { key: 'worldStructure',   emoji: '🌐', label: '世界结构',   desc: '世界的物理层级——星球 / 大陆 / 行政区划 / 平行空间等' },
  { key: 'worldDimensions',  emoji: '📐', label: '疆域尺寸',   desc: '世界整体大小、核心区域的疆域范围' },
  { key: 'continentLayout',  emoji: '🗺', label: '地貌分布',   desc: '主要大陆 / 山脉 / 平原 / 盆地的分布与地形特征' },
  { key: 'mountainsRivers',  emoji: '⛰', label: '山川水系',   desc: '重要山脉、河流、湖泊、运河与水路' },
  { key: 'climateByRegion',  emoji: '🌦', label: '气候环境',   desc: '不同区域的气候类型、季节特征与自然灾害' },
] as const

type FieldKey = typeof FIELDS[number]['key'] | 'naturalResources'

const NATURAL_PANEL_KEY_BY_AGENT_FIELD: Partial<Record<WorldviewAgentField, FieldKey>> = {
  worldStructure: 'worldStructure',
  worldDimensions: 'worldDimensions',
  continentLayout: 'continentLayout',
  mountainsRivers: 'mountainsRivers',
  climateByRegion: 'climateByRegion',
  naturalResourceOverview: 'naturalResources',
}

// 每个方面(子页) → 其专属词条分类(builtInKey)。(重镇/城池已移到人文环境;自然资源单独处理)
const NATURAL_CODEX_KEYS: Record<string, string[] | undefined> = {
  worldStructure: ['natStructure'],
  worldDimensions: ['natDimension'],
  continentLayout: ['natTerrain'],
  mountainsRivers: ['natWater'],
  climateByRegion: ['natClimate'],
}

// ── 主面板 ─────────────────────────────────────────────────────

export default function WorldviewNaturalPanel({ project }: Props) {
  const { worldview, saveWorldview, loadAll } = useWorldviewStore()
  const activeGroupId = useWorldGroupStore(s => s.activeGroupId)
  const copilot = useMasterCopilot({
    project,
    worldGroupId: project.enableMultiWorld ? activeGroupId : null,
  })

  const [values, setValues] = useState<Record<string, string>>({})
  const [naturalResources, setNaturalResources] = useState<NaturalResources>({
    rareCreatures: '', herbs: '', minerals: '', others: '',
  })
  const [activeKey, setActiveKey] = useState<FieldKey>('worldStructure')
  const [runningField, setRunningField] = useState<WorldviewAgentField | null>(null)

  useEffect(() => {
    loadAll(project.id!, project.enableMultiWorld ? activeGroupId : null)
  }, [project.id, project.enableMultiWorld, activeGroupId, loadAll])

  useEffect(() => {
    if (!worldview) return
    setValues({
      worldStructure:   worldview.worldStructure || '',
      worldDimensions:  worldview.worldDimensions || '',
      continentLayout:  worldview.continentLayout || '',
      regionDimensions: worldview.regionDimensions || '',
      mountainsRivers:  worldview.mountainsRivers || '',
      climateByRegion:  worldview.climateByRegion || '',
      naturalResourceOverview: worldview.naturalResourceOverview || '',
    })
    setNaturalResources(worldview.naturalResources || {
      rareCreatures: '', herbs: '', minerals: '', others: '',
    })
  }, [worldview])

  const save = (patch: Partial<typeof worldview>) =>
    saveWorldview({ projectId: project.id!, ...patch })

  const pendingWorldviewCandidates = copilot.pendingCandidates.filter(candidate => (
    candidate.payload.skillId === 'world-origin.worldview-field'
  ))
  const pendingWorldviewField = pendingWorldviewCandidates[0]?.payload.worldviewField
  const pendingPanelKey = pendingWorldviewField
    ? NATURAL_PANEL_KEY_BY_AGENT_FIELD[pendingWorldviewField]
    : undefined
  const hasOtherPendingCandidates = copilot.pendingCandidates.some(candidate => (
    candidate.payload.skillId !== 'world-origin.worldview-field'
  ))
  const streamingKeys = new Set<string>()
  const runningPanelKey = runningField ? NATURAL_PANEL_KEY_BY_AGENT_FIELD[runningField] : undefined
  if (copilot.busy && runningPanelKey) streamingKeys.add(runningPanelKey)

  useEffect(() => {
    if (pendingPanelKey) setActiveKey(pendingPanelKey)
  }, [pendingPanelKey])

  return (
    <div className="flex flex-col w-full h-full space-y-4">
      {/* 顶部 */}
      <div className="pb-4 border-b border-border/40 px-6 pt-4 shrink-0">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-xl font-bold text-text-primary flex items-center gap-2">
            🏔️ 自然环境与地理
          </h2>
          {project.enableMultiWorld && <WorldGroupSwitcher />}
        </div>
        <p className="text-xs text-text-muted mt-0.5">
          定义世界的地理、气候与自然资源。如需声明真实与幻想的规则，请前往「⚖️ 真实与幻想」面板。
        </p>
        <div className="mt-3 max-w-xl">
          <CodexSearchBar
            categoryKeys={[...Object.values(NATURAL_CODEX_KEYS).flat().filter(Boolean) as string[], 'mineral', 'herb', 'beast']}
            onJump={(catKey) => {
              if (['mineral', 'herb', 'beast'].includes(catKey)) { setActiveKey('naturalResources'); return }
              const sub = Object.keys(NATURAL_CODEX_KEYS).find(k => NATURAL_CODEX_KEYS[k]?.includes(catKey))
              if (sub) setActiveKey(sub as FieldKey)
            }}
          />
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* ── 左侧边栏 ── */}
        <nav className="w-max min-w-32 max-w-44 flex-shrink-0 border-r border-border bg-bg-surface/50 overflow-y-auto">
          {[...FIELDS.map(f => ({ key: f.key, emoji: f.emoji, label: f.label })),
            { key: 'naturalResources' as const, emoji: '🌿', label: '自然资源' },
          ].map(f => {
            const isActive = activeKey === f.key
            const isFieldStreaming = streamingKeys.has(f.key)
            const hasPendingCandidate = pendingPanelKey === f.key
            return (
              <button
                key={f.key}
                onClick={() => setActiveKey(f.key)}
                className={`w-full text-left px-3 py-2.5 text-sm transition-colors border-l-2 flex items-center gap-1 ${
                  isActive
                    ? 'border-accent bg-accent/10 text-text-primary font-medium'
                    : 'border-transparent text-text-secondary hover:text-text-primary hover:bg-bg-elevated/50'
                }`}
              >
                <span className="flex-1">{f.emoji} {f.label}</span>
                {isFieldStreaming && !isActive && (
                  <span className="w-2 h-2 rounded-full bg-accent animate-pulse shrink-0" />
                )}
                {hasPendingCandidate && !isFieldStreaming && (
                  <span
                    aria-label={`${f.label}有待确认候选`}
                    title="有待确认候选"
                    className="w-2 h-2 rounded-full bg-warning shrink-0"
                  />
                )}
              </button>
            )
          })}
        </nav>

        {/* ── 右侧：所有字段同时渲染，hidden 控制显示 ── */}
        <div className="flex-1 overflow-y-auto p-6">
          {FIELDS.map(f => (
            <div key={f.key} className={activeKey === f.key ? '' : 'hidden'}>
              <SimpleFieldEditor
                field={f}
                value={values[f.key] || ''}
                onChange={v => {
                  setValues(prev => ({ ...prev, [f.key]: v }))
                  save({ [f.key]: v })
                }}
                project={project}
                agentField={f.key}
                activeGroupId={activeGroupId}
                copilot={copilot}
                candidate={pendingWorldviewCandidates.find(candidate => candidate.payload.worldviewField === f.key)}
                otherPendingWorldviewLabel={pendingWorldviewCandidates.find(candidate => candidate.payload.worldviewField !== f.key)?.payload.label}
                hasOtherPendingCandidates={hasOtherPendingCandidates}
                onRunningChange={running => setRunningField(running ? f.key : null)}
                onAdopted={async candidate => {
                  await copilot.adoptCandidate(candidate)
                  await loadAll(project.id!, project.enableMultiWorld ? activeGroupId : null)
                }}
              />
              {/* 全貌之下:本方面的专属词条(只显示对应那一类) */}
              {NATURAL_CODEX_KEYS[f.key] && (
                <div className="mt-6">
                  <h3 className="text-sm font-semibold text-text-primary mb-1">📚 {f.label} · 具体词条</h3>
                  <p className="text-xs text-text-muted mb-3">在上面写完整体「全貌」后，这里把「{f.label}」逐条细化登记，可自定义字段、打重要度星级，并进入 AI 生成上下文。</p>
                  <CodexPanel
                    project={project}
                    fixedCategoryKeys={NATURAL_CODEX_KEYS[f.key]}
                    extractionSourceText={values[f.key] || ''}
                    embedded
                  />
                </div>
              )}
            </div>
          ))}
          <div className={activeKey === 'naturalResources' ? 'space-y-4' : 'hidden'}>
            {/* 全貌(上):自然资源整体概述,带 AI 生成,与其它方面一致 */}
            <SimpleFieldEditor
              field={{ key: 'naturalResourceOverview', emoji: '🌿', label: '自然资源', desc: '矿产 / 灵材 / 动植物等自然产出的总体分布、丰饶程度与特点' }}
              value={values.naturalResourceOverview || ''}
              onChange={v => {
                setValues(prev => ({ ...prev, naturalResourceOverview: v }))
                save({ naturalResourceOverview: v })
              }}
              project={project}
              agentField="naturalResourceOverview"
              activeGroupId={activeGroupId}
              copilot={copilot}
              candidate={pendingWorldviewCandidates.find(candidate => candidate.payload.worldviewField === 'naturalResourceOverview')}
              otherPendingWorldviewLabel={pendingWorldviewCandidates.find(candidate => candidate.payload.worldviewField !== 'naturalResourceOverview')?.payload.label}
              hasOtherPendingCandidates={hasOtherPendingCandidates}
              onRunningChange={running => setRunningField(running ? 'naturalResourceOverview' : null)}
              onAdopted={async candidate => {
                await copilot.adoptCandidate(candidate)
                await loadAll(project.id!, project.enableMultiWorld ? activeGroupId : null)
              }}
            />
            {/* 自然资源:矿物/草药/异兽 三类词条 */}
            <div>
              <h3 className="text-sm font-semibold text-text-primary mb-1">📚 自然物产 · 具体词条</h3>
              <p className="text-xs text-text-muted mb-2">矿物灵材 / 灵植草药 / 灵兽异兽——逐条登记,可自定义字段、互相关联、打星,并进入 AI 生成上下文。</p>
              <CodexPanel
                project={project}
                fixedCategoryKeys={['mineral', 'herb', 'beast']}
                extractionSourceText={[
                  values.naturalResourceOverview,
                  naturalResources.minerals,
                  naturalResources.herbs,
                  naturalResources.rareCreatures,
                  naturalResources.others,
                ].filter(Boolean).join('\n\n')}
                embedded
              />
            </div>
            {/* 旧版自然资源(纯文本)——保留兼容 */}
            <details className="border-t border-border/60 pt-3">
              <summary className="text-xs text-text-muted cursor-pointer hover:text-text-secondary">旧版「自然资源」纯文本(兼容保留,可继续编辑)</summary>
              <div className="mt-2">
                <NaturalResourcesEditor
                  naturalResources={naturalResources}
                  setNaturalResources={setNaturalResources}
                  save={save}
                />
              </div>
            </details>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── 单字段编辑器（各自独立的 AI 流） ──────────────────────────

function SimpleFieldEditor({
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
  field: { key: string; emoji: string; label: string; desc: string }
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
    <div className="max-w-3xl space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-text-primary">{field.emoji} {field.label}</h3>
        <p className="mt-1 text-sm text-text-muted">{field.desc}</p>
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

// ── 自然资源编辑器 ─────────────────────────────────────────────

function NaturalResourcesEditor({ naturalResources, setNaturalResources, save }: {
  naturalResources: NaturalResources
  setNaturalResources: React.Dispatch<React.SetStateAction<NaturalResources>>
  save: (patch: Record<string, unknown>) => void
}) {
  const rows: { key: keyof NaturalResources; label: string; placeholder: string }[] = [
    { key: 'rareCreatures', label: '🦅 珍禽异兽 / 牲畜', placeholder: '例：玄龟 / 火凤 / 战马 / 耕牛 ...' },
    { key: 'herbs',         label: '🌿 灵药 / 粮食作物', placeholder: '例：千年雪莲 / 灵参 / 稻麦 ...' },
    { key: 'minerals',      label: '💎 矿石 / 金属',     placeholder: '例：玄铁 / 灵石 / 盐铁矿 ...' },
    { key: 'others',        label: '✨ 其他特产',         placeholder: '例：神木 / 蜀锦 / 茶叶 ...' },
  ]

  const update = (key: keyof NaturalResources, v: string) => {
    const next = { ...naturalResources, [key]: v }
    setNaturalResources(next)
    save({ naturalResources: next })
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-text-primary">🌿 自然资源</h3>
        <p className="mt-1 text-sm text-text-muted">珍禽异兽 / 灵药草药 / 矿石宝石 / 其他特产</p>
      </div>
      <div className="bg-bg-surface border border-border rounded-lg p-4 space-y-4">
        {rows.map(r => (
          <div key={r.key} className="flex items-start gap-3">
            <span className="text-sm text-text-secondary w-28 flex-shrink-0 pt-0.5">{r.label}</span>
            <div className="flex-1">
              <InlineTextarea value={naturalResources[r.key]} onChange={v => update(r.key, v)} placeholder={r.placeholder} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
