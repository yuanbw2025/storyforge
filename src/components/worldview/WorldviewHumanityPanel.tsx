import { useState, useEffect } from 'react'
import { BookOpen } from 'lucide-react'
import { useWorldviewStore } from '../../stores/worldview'
import { useWorldGroupStore } from '../../stores/world-group'
import WorldGroupSwitcher from '../world-group/WorldGroupSwitcher'
import { InlineTextarea } from '../shared/InlineEdit'
import { useMasterCopilot, type PendingMasterCandidate } from '../agent/useMasterCopilot'
import WorldviewAgentControls from './WorldviewAgentControls'
import type { Project } from '../../lib/types'
import type { WorldviewAgentField } from '../../lib/agent/worldview-field-copilot'
import CodexPanel from '../codex/CodexPanel'
import CodexSearchBar from '../codex/CodexSearchBar'

// ── 字段定义（统一标签，兼容幻想与历史） ─────────────────────────

interface FieldMeta {
  key: string       // skipKey for buildCtx
  field: WorldviewAgentField
  emoji: string
  label: string
  description: string
  /** 与独立管理面板重叠时的导航提示 */
  hint?: string
}

const FIELDS: FieldMeta[] = [
  { key: 'races',     field: 'races',                  emoji: '🧬', label: '种族与民族',     description: '不同种族 / 民族的特征、能力、历史与关系' },
  { key: 'factions',  field: 'factionLayout',          emoji: '⚔',  label: '势力分布',       description: '主要势力（门派 / 朝廷 / 商会 / 党派……）的格局和敌友关系' },
  { key: 'cities',    field: 'regionDimensions',       emoji: '🏰', label: '城池重镇',       description: '核心城市、军事重镇、商业都会的分布与格局' },
  { key: 'politics',  field: 'politicsOverview',       emoji: '🏛', label: '政治制度',       description: '政体、官制、法律、军事、外交、权力主体与阶层结构' },
  { key: 'economy',   field: 'economyOverview',        emoji: '💰', label: '经济制度',       description: '货币、税赋、贸易、产业、资源分配与主要经济参与者' },
  { key: 'culture',   field: 'cultureOverview',        emoji: '🎭', label: '文化制度',       description: '语言、宗教、教育、礼仪、节庆、艺术、习俗与禁忌' },
  { key: 'conflicts', field: 'internalConflicts',      emoji: '🔥', label: '矛盾冲突',       description: '社会内在矛盾 / 阶级冲突 / 个体与集体冲突 / 与外部世界的张力' },
  { key: 'items',     field: 'itemDesign',             emoji: '🗡', label: '道具与器物',     description: '武器 / 法器 / 工具 / 科技装备……物品的来源、品级、规则', hint: '这里写物品体系概述；具体道具在下方「📚 道具与器物 · 具体词条」逐条管理，主角实际获得与消耗的物品由创作区「🎒 物品栏」追踪。' },
]
const HISTORY_NAV = { key: 'history', emoji: '📜', label: '历史年表' }

// 每个方面(子页) → 其专属词条分类(builtInKey)。下方只显示该方面对应的词条。
const HUMANITY_CODEX_KEYS: Record<string, string[] | undefined> = {
  races: ['race'],
  factions: ['faction'],
  cities: ['city'],
  politics: ['humPolitics'],
  economy: ['humEconomy'],
  culture: ['humCulture'],
  conflicts: ['humConflict'],
  items: ['artifact'],
}

// ── 主面板 ─────────────────────────────────────────────────────

interface Props {
  project: Project
  onOpenHistory: () => void
}

export default function WorldviewHumanityPanel({ project, onOpenHistory }: Props) {
  const { worldview, saveWorldview, loadAll } = useWorldviewStore()
  const activeGroupId = useWorldGroupStore(s => s.activeGroupId)
  const copilot = useMasterCopilot({
    project,
    worldGroupId: project.enableMultiWorld ? activeGroupId : null,
  })

  const [values, setValues] = useState<Record<string, string>>({})
  const [activeKey, setActiveKey] = useState(HISTORY_NAV.key)
  const [runningField, setRunningField] = useState<WorldviewAgentField | null>(null)

  useEffect(() => {
    loadAll(project.id!, project.enableMultiWorld ? activeGroupId : null)
  }, [project.id, project.enableMultiWorld, activeGroupId, loadAll])

  useEffect(() => {
    if (!worldview) return
    setValues({
      history:   worldview.historyLine || '',
      events:    worldview.worldEvents || '',
      races:     worldview.races || '',
      factions:  worldview.factionLayout || '',
      cities:    worldview.regionDimensions || '',
      politics: worldview.politicsOverview || '',
      economy: worldview.economyOverview || '',
      culture: worldview.cultureOverview || '',
      legacySociety: worldview.politicsEconomyCulture || '',
      conflicts: worldview.internalConflicts || '',
      items:     worldview.itemDesign || '',
    })
  }, [worldview])

  const save = (fieldName: string, v: string) =>
    saveWorldview({ projectId: project.id!, [fieldName]: v })

  const pendingWorldviewCandidates = copilot.pendingCandidates.filter(candidate => (
    candidate.payload.skillId === 'world-origin.worldview-field'
  ))
  const pendingWorldviewField = pendingWorldviewCandidates[0]?.payload.worldviewField
  const pendingPanelKey = FIELDS.find(field => field.field === pendingWorldviewField)?.key
  const hasOtherPendingCandidates = copilot.pendingCandidates.some(candidate => (
    candidate.payload.skillId !== 'world-origin.worldview-field'
  ))
  const streamingKeys = new Set<string>()
  const runningPanelKey = FIELDS.find(field => field.field === runningField)?.key
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
            🏛️ 人文环境与社会
          </h2>
          {project.enableMultiWorld && <WorldGroupSwitcher />}
        </div>
        <p className="text-xs text-text-muted mt-0.5">
          定义世界的历史、势力、政经文化与社会矛盾。如需声明真实与幻想的规则，请前往「⚖️ 真实与幻想」面板。
        </p>
        {/* 词条搜索:跨本面板所有方面,点结果跳到对应子页 */}
        <div className="mt-3 max-w-xl">
          <CodexSearchBar
            categoryKeys={[
              ...new Set([
                ...Object.values(HUMANITY_CODEX_KEYS).flat().filter(Boolean),
                'humEra', 'humEvent', 'humSociety',
              ] as string[]),
            ]}
            onJump={(catKey) => {
              if (catKey === 'humEra' || catKey === 'humEvent') {
                setActiveKey('history')
                return
              }
              if (catKey === 'humSociety') {
                setActiveKey('politics')
                return
              }
              const sub = Object.keys(HUMANITY_CODEX_KEYS).find(k => HUMANITY_CODEX_KEYS[k]?.includes(catKey))
              if (sub) setActiveKey(sub)
            }}
          />
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* ── 左侧导航 ── */}
        <nav className="w-max min-w-32 max-w-44 flex-shrink-0 border-r border-border overflow-y-auto py-4 pr-1">
          {[HISTORY_NAV, ...FIELDS].map(f => {
            const isActive = f.key === activeKey
            const isFieldStreaming = streamingKeys.has(f.key)
            const hasPendingCandidate = pendingPanelKey === f.key
            return (
              <button
                key={f.key}
                onClick={() => setActiveKey(f.key)}
                className={`w-full text-left px-4 py-2.5 text-sm transition-colors border-l-2 flex items-center gap-1 ${
                  isActive
                    ? 'border-accent bg-accent/8 text-accent font-medium'
                    : 'border-transparent text-text-secondary hover:text-text-primary hover:bg-bg-elevated'
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
        <div className="flex-1 min-w-0 overflow-y-auto p-6">
          {activeKey === 'history' && (
            <div className="max-w-3xl space-y-5">
              <div>
                <h3 className="text-lg font-semibold text-text-primary">📜 历史年表</h3>
                <p className="mt-1 text-sm text-text-muted">
                  历史总述、纪年体系、正式事件和时代关键词统一由历史年表维护，避免两套入口互相覆盖。
                </p>
              </div>
              <button
                type="button"
                onClick={onOpenHistory}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-accent/10 text-accent hover:bg-accent/20 text-sm"
              >
                <BookOpen className="w-4 h-4" />
                打开正式历史年表
              </button>
              <details className="border border-border rounded-xl bg-bg-surface p-4">
                <summary className="cursor-pointer text-sm font-medium text-text-secondary">
                  旧版历史资料（保留兼容，不作为新历史主入口）
                </summary>
                <div className="mt-4 space-y-4">
                  <label className="block">
                    <span className="block text-xs text-text-muted mb-1">旧版世界历史线</span>
                    <InlineTextarea
                      value={values.history || ''}
                      onChange={value => {
                        setValues(prev => ({ ...prev, history: value }))
                        save('historyLine', value)
                      }}
                      placeholder="旧版历史资料"
                    />
                  </label>
                  <label className="block">
                    <span className="block text-xs text-text-muted mb-1">旧版世界大事记</span>
                    <InlineTextarea
                      value={values.events || ''}
                      onChange={value => {
                        setValues(prev => ({ ...prev, events: value }))
                        save('worldEvents', value)
                      }}
                      placeholder="旧版大事记资料"
                    />
                  </label>
                  <CodexPanel
                    project={project}
                    fixedCategoryKeys={['humEra', 'humEvent']}
                    extractionSourceText={`${values.history || ''}\n${values.events || ''}`}
                    embedded
                  />
                </div>
              </details>
            </div>
          )}
          {FIELDS.map(f => (
            <div key={f.key} className={activeKey === f.key ? '' : 'hidden'}>
              {/* 全貌（上）：现有字段本身就是这个方面的整体概述，带 AI 生成 */}
              <HumanityFieldEditor
                meta={f}
                value={values[f.key] || ''}
                onChange={v => {
                  setValues(prev => ({ ...prev, [f.key]: v }))
                  save(f.field, v)
                }}
                project={project}
                activeGroupId={activeGroupId}
                copilot={copilot}
                candidate={pendingWorldviewCandidates.find(candidate => candidate.payload.worldviewField === f.field)}
                otherPendingWorldviewLabel={pendingWorldviewCandidates.find(candidate => candidate.payload.worldviewField !== f.field)?.payload.label}
                hasOtherPendingCandidates={hasOtherPendingCandidates}
                onRunningChange={running => setRunningField(running ? f.field : null)}
                onAdopted={async candidate => {
                  await copilot.adoptCandidate(candidate)
                  await loadAll(project.id!, project.enableMultiWorld ? activeGroupId : null)
                }}
              />
              {/* 词条（下）：在全貌之下,把"本方面"细化为一个个具体条目(只显示对应那一类,可打星) */}
              {HUMANITY_CODEX_KEYS[f.key] && (
                <div className="mt-6">
                  <h3 className="text-sm font-semibold text-text-primary mb-1">📚 {f.label} · 具体词条</h3>
                  <p className="text-xs text-text-muted mb-3">在上面写完整体「全貌」后，这里把「{f.label}」逐条细化登记，可自定义字段、打重要度星级，并进入 AI 生成上下文。</p>
                  <CodexPanel
                    project={project}
                    fixedCategoryKeys={HUMANITY_CODEX_KEYS[f.key]}
                    extractionSourceText={values[f.key] || ''}
                    embedded
                  />
                </div>
              )}
              {f.key === 'politics' && (
                <details className="mt-6 border border-border rounded-xl bg-bg-surface p-4">
                  <summary className="cursor-pointer text-sm font-medium text-text-secondary">
                    旧版“政经文化”兼容资料
                  </summary>
                  <div className="mt-4 space-y-4">
                    <InlineTextarea
                      value={values.legacySociety || ''}
                      onChange={value => {
                        setValues(prev => ({ ...prev, legacySociety: value }))
                        save('politicsEconomyCulture', value)
                      }}
                      placeholder="旧版政经文化原文"
                    />
                    <CodexPanel
                      project={project}
                      fixedCategoryKeys={['humSociety']}
                      extractionSourceText={values.legacySociety || ''}
                      embedded
                    />
                  </div>
                </details>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── 单字段编辑器（各自独立的 AI 流） ──────────────────────────

function HumanityFieldEditor({
  meta,
  value,
  onChange,
  project,
  activeGroupId,
  copilot,
  candidate,
  otherPendingWorldviewLabel,
  hasOtherPendingCandidates,
  onRunningChange,
  onAdopted,
}: {
  meta: FieldMeta
  value: string
  onChange: (v: string) => void
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
    <div className="max-w-3xl space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-text-primary">{meta.emoji} {meta.label}</h3>
        <p className="mt-1 text-sm text-text-muted">{meta.description}</p>
        {meta.hint && (
          <p className="mt-1.5 text-xs text-accent/80 bg-accent/5 border border-accent/15 rounded px-2 py-1">
            💡 {meta.hint}
          </p>
        )}
      </div>

      <div className="bg-bg-surface border border-border rounded-xl p-4">
        <InlineTextarea value={value} onChange={onChange} placeholder={meta.description} />
      </div>
      <WorldviewAgentControls
        field={meta.field}
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
