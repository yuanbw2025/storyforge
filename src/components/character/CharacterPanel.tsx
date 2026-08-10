import { useState, useEffect } from 'react'
import {
  Check, Plus, Sparkles, ChevronDown, Loader2, Trash2,
} from 'lucide-react'
import { CInput } from '../shared/CompositionInput'
import { useCharacterStore } from '../../stores/character'
import { useWorldGroupStore } from '../../stores/world-group'
import { useMasterCopilot, type PendingMasterCandidate } from '../agent/useMasterCopilot'
import PromptRunPanel from '../shared/PromptRunPanel'
import { CTextarea } from '../shared/CompositionInput'
import type {
  Project, Character, CharacterMoralAxis, CharacterOrderAxis, CharacterRoleWeight,
} from '../../lib/types'
import CharacterDimensionPicker from './CharacterDimensionPicker'
import { CHARACTER_DIMENSIONS, type CharacterDimensionKey } from '../../lib/character/character-dimensions'
import CharacterAxesPicker from './CharacterAxesPicker'
import CharacterDetailCard from './CharacterDetailCard'
import { formatCharacterGenerationRequestV1, parseCharacterCandidateDraft } from '../../lib/agent/character-copilot'
import {
  MORAL_AXIS_LABELS,
  ORDER_AXIS_LABELS,
  ROLE_WEIGHT_LABELS,
  filterCharactersByRoleWeight,
} from '../../lib/character/character-axes'
import {
  INITIAL_RECORD_TARGET_CLASS,
  initialRecordTargetAttributes,
  useInitialRecordTarget,
} from '../shared/initial-record-target'

// ── 常量 ───────────────────────────────────────────────────────

// 首字圆的柔和色板（按角色 index 循环取色）
const GLYPH_COLORS = [
  'bg-[#C17D5E]/15 text-[#C17D5E]',   // 陶土
  'bg-[#7BA08A]/15 text-[#7BA08A]',   // 青竹
  'bg-[#8B7BB0]/15 text-[#8B7BB0]',   // 紫藤
  'bg-[#B08B6B]/15 text-[#B08B6B]',   // 琥珀
  'bg-[#6B8EB0]/15 text-[#6B8EB0]',   // 墨蓝
  'bg-[#B06B7B]/15 text-[#B06B7B]',   // 玫红
]

interface Props {
  project: Project
  view?: 'generator' | 'main'
  initialCharacterId?: number | null
}

// ── 主面板 ─────────────────────────────────────────────────────

export default function CharacterPanel({ project, view = 'generator', initialCharacterId }: Props) {
  const { characters, loadAll, addCharacter, updateCharacter, deleteCharacter } = useCharacterStore()
  const { groups, activeGroupId } = useWorldGroupStore()
  // 多世界：角色世界过滤器（'all' | 'cross' | 世界组 id）
  const [worldFilter, setWorldFilter] = useState<'all' | 'cross' | number>('all')
  const copilot = useMasterCopilot({
    project,
    worldGroupId: project.enableMultiWorld
      ? (typeof worldFilter === 'number' ? worldFilter : activeGroupId)
      : null,
  })
  const [selected, setSelected] = useState<number | null>(null)
  const [hint, setHint] = useState('')
  const [showRolePicker, setShowRolePicker] = useState(false)
  const [draftAxes, setDraftAxes] = useState<{
    roleWeight: CharacterRoleWeight | null
    moralAxis: CharacterMoralAxis | null
    orderAxis: CharacterOrderAxis | null
  }>({ roleWeight: null, moralAxis: null, orderAxis: null })
  const [parameterValues, setParameterValues] = useState<Record<string, unknown>>({})
  // B：AI 生成时选哪些维度（默认全选；可按戏份预设/增减）
  const [genDims, setGenDims] = useState<Set<CharacterDimensionKey>>(() => new Set(CHARACTER_DIMENSIONS.map(d => d.key)))
  const [showDimPicker, setShowDimPicker] = useState(false)
  const [systemOverride, setSystemOverride] = useState<string | null>(null)
  const [userOverride, setUserOverride] = useState<string | null>(null)
  useEffect(() => { loadAll(project.id!) }, [project.id, loadAll])

  // 多世界过滤：跨世界角色在任意世界都显示
  const worldFilteredChars = !project.enableMultiWorld || worldFilter === 'all'
    ? characters
    : worldFilter === 'cross'
      ? characters.filter(c => c.isCrossWorld)
      : characters.filter(c => c.isCrossWorld || c.homeWorldGroupId === worldFilter)
  const displayedChars = view === 'main'
    ? filterCharactersByRoleWeight(worldFilteredChars, 'main')
    : worldFilteredChars

  const selectedChar = characters.find(c => c.id === selected)

  useEffect(() => {
    if (!characters.some(character => character.id === initialCharacterId)) return
    setWorldFilter('all')
    setSelected(initialCharacterId ?? null)
  }, [characters, initialCharacterId])
  useInitialRecordTarget(
    initialCharacterId,
    displayedChars.some(character => character.id === initialCharacterId),
  )

  // 多世界模式下新建角色时归属的世界（过滤器选了具体世界则用它，否则用当前活跃世界）
  const newCharHomeWorld = (): number | null => {
    if (!project.enableMultiWorld) return null
    if (typeof worldFilter === 'number') return worldFilter
    if (worldFilter === 'cross') return null
    return activeGroupId
  }

  const handleAdd = async () => {
    if (!draftAxes.roleWeight || !draftAxes.moralAxis || !draftAxes.orderAxis) return
    setShowRolePicker(false)
    const id = await addCharacter({
      projectId: project.id!, name: '新角色',
      roleWeight: draftAxes.roleWeight,
      moralAxis: draftAxes.moralAxis,
      orderAxis: draftAxes.orderAxis,
      shortDescription: '', appearance: '', personality: '',
      background: '', motivation: '', abilities: '', relationships: '', arc: '',
      homeWorldGroupId: newCharHomeWorld(),
      isCrossWorld: project.enableMultiWorld && worldFilter === 'cross',
    })
    setDraftAxes({ roleWeight: null, moralAxis: null, orderAxis: null })
    setSelected(id)
  }

  const handleUpdate = (field: keyof Character, value: string) => {
    if (selectedChar?.id) updateCharacter(selectedChar.id, { [field]: value })
  }

  const handleAIGenerate = async () => {
    // 统计阵容缺口
    const weightCounts: Record<CharacterRoleWeight, number> = {
      main: 0, secondary: 0, npc: 0, extra: 0,
    }
    characters.forEach(c => { weightCounts[c.roleWeight]++ })
    const rosterGap = `当前阵容：主要 ${weightCounts.main}、次要 ${weightCounts.secondary}、NPC ${weightCounts.npc}、路人 ${weightCounts.extra}`
    const existing = characters.map(c =>
      `${c.name}（${ROLE_WEIGHT_LABELS[c.roleWeight]} · ${ORDER_AXIS_LABELS[c.orderAxis]}${MORAL_AXIS_LABELS[c.moralAxis]}）`,
    ).join('、')
    // B：维度指令——始终告诉 AI 要设计哪些维度(基础提示词只覆盖老字段,新维度靠这里点名才会生成)。
    // 全选→"完整设计全部"；部分→"只设计这些、其余留空"。走 CHARACTER_DIMENSIONS 单源,不动脆弱的基础模板。
    const allKeys = CHARACTER_DIMENSIONS.map(d => d.key)
    const selectedLabels = CHARACTER_DIMENSIONS.filter(d => genDims.has(d.key)).map(d => d.label).join('、')
    const dimInstruction = genDims.size === 0
      ? ''
      : genDims.size < allKeys.length
        ? `本次只需设计以下维度，其余维度一律留空：${selectedLabels}`
        : `请尽量完整设计以下全部维度（有内容才写，没有的留空，不要编造硬凑）：${selectedLabels}`
    if (project.enableMultiWorld && (worldFilter === 'cross' || activeGroupId == null)) return
    const enrichedHint = [hint, rosterGap, dimInstruction, `已有角色：${existing || '无'}`]
      .filter(Boolean)
      .join('\n')
    await copilot.submitRequest(formatCharacterGenerationRequestV1({
      hint: enrichedHint,
      parameterValues: Object.keys(parameterValues).length ? parameterValues : undefined,
      systemOverride,
      userOverride,
    }))
  }

  const pendingCharacterCandidates = copilot.pendingCandidates.filter(candidate => (
    candidate.payload.agentId === 'character' && candidate.payload.skillId === 'character.create'
  ))
  const hasOtherPendingCandidates = copilot.pendingCandidates.some(candidate => (
    candidate.payload.agentId !== 'character' || candidate.payload.skillId !== 'character.create'
  ))

  return (
    <div className="space-y-3">
      {/* 工具栏 */}
      <div className="flex items-center gap-3 flex-wrap">
        {view === 'generator' && (
          <>
            <div className="relative">
              <button
                onClick={() => setShowRolePicker(!showRolePicker)}
                className="flex items-center gap-1.5 px-3 py-2 bg-accent text-white text-sm rounded-md hover:bg-accent-hover transition-colors"
              >
                <Plus className="w-4 h-4" /> 新建角色 <ChevronDown className="w-3 h-3 ml-0.5" />
              </button>
              {showRolePicker && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowRolePicker(false)} />
                  <div className="absolute top-full left-0 mt-1 z-50 bg-bg-surface border border-border rounded-lg shadow-lg p-3 w-[430px]">
                    <CharacterAxesPicker {...draftAxes} onChange={setDraftAxes} compact />
                    <button
                      onClick={handleAdd}
                      disabled={!draftAxes.roleWeight || !draftAxes.moralAxis || !draftAxes.orderAxis}
                      className="mt-3 w-full px-3 py-2 bg-accent text-white text-sm rounded disabled:opacity-40"
                    >
                      创建并分流
                    </button>
                  </div>
                </>
              )}
            </div>
            <div className="flex items-center gap-2 flex-1">
              <CInput
                value={hint}
                onChange={e => setHint(e.target.value)}
                placeholder="角色要求（可选）"
                className="w-48 px-2 py-1.5 bg-bg-surface border border-border rounded text-xs text-text-primary focus:outline-none focus:border-accent"
              />
              <div className="relative">
                <button
                  onClick={() => setShowDimPicker(!showDimPicker)}
                  className="flex items-center gap-1 px-2.5 py-2 bg-bg-surface text-text-secondary text-xs rounded-md hover:text-accent transition-colors border border-border"
                  title="选择 AI 这次要设计哪些维度"
                >
                  维度 {genDims.size}/{CHARACTER_DIMENSIONS.length} <ChevronDown className="w-3 h-3" />
                </button>
                {showDimPicker && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowDimPicker(false)} />
                    <div className="absolute top-full left-0 mt-1 z-50 bg-bg-surface border border-border rounded-lg shadow-lg p-3 w-[420px]">
                      <CharacterDimensionPicker selected={genDims} onChange={setGenDims} />
                    </div>
                  </>
                )}
              </div>
              <button
                onClick={handleAIGenerate}
                disabled={copilot.loading || copilot.busy || copilot.pendingCandidates.length > 0
                  || (project.enableMultiWorld && (activeGroupId == null || worldFilter === 'cross'))}
                className="flex items-center gap-1.5 px-3 py-2 bg-bg-elevated text-text-secondary text-sm rounded-md hover:text-accent disabled:opacity-50 transition-colors border border-border hover:border-accent/50"
              >
                <Sparkles className="w-3.5 h-3.5" /> AI 设计角色
              </button>
            </div>
          </>
        )}
        <span className="text-xs text-text-muted ml-auto">
          {view === 'main' ? '主要角色' : '角色生成'} · {displayedChars.length}
        </span>
      </div>

      {/* 多世界：世界过滤器 */}
      {project.enableMultiWorld && groups.length > 1 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={() => setWorldFilter('all')}
            className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
              worldFilter === 'all'
                ? 'bg-accent text-white border-accent'
                : 'bg-bg-base text-text-secondary border-border hover:border-accent/50'
            }`}
          >
            全部
          </button>
          {groups.map(g => (
            <button
              key={g.id}
              onClick={() => setWorldFilter(g.id!)}
              className={`flex items-center gap-1 px-2.5 py-1 text-xs rounded-full border transition-colors ${
                worldFilter === g.id
                  ? 'bg-accent text-white border-accent'
                  : 'bg-bg-base text-text-secondary border-border hover:border-accent/50'
              }`}
            >
              <span>{g.icon || '🌐'}</span>{g.name}
            </button>
          ))}
          <button
            onClick={() => setWorldFilter('cross')}
            className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
              worldFilter === 'cross'
                ? 'bg-accent text-white border-accent'
                : 'bg-bg-base text-text-secondary border-border hover:border-accent/50'
            }`}
          >
            🌐 跨世界
          </button>
        </div>
      )}

      {/* 调参浮窗 */}
      {view === 'generator' && (
        <PromptRunPanel
          moduleKey="character.generate"
          parameterValues={parameterValues}
          onParamChange={setParameterValues}
          systemOverride={systemOverride}
          onSystemOverrideChange={setSystemOverride}
          userOverride={userOverride}
          onUserOverrideChange={setUserOverride}
        />
      )}

      {view === 'generator' && hasOtherPendingCandidates && (
        <p className="rounded border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-text-secondary">
          主 Agent 还有其他待确认候选，请先在右侧副驾中处理。
        </p>
      )}

      {view === 'generator' && copilot.error && (
        <p className="rounded border border-error/30 bg-error/5 px-3 py-2 text-xs text-error">
          {copilot.error}
        </p>
      )}

      {view === 'generator' && pendingCharacterCandidates.map(candidate => (
        <CharacterCandidateCard
          key={candidate.event.id}
          candidate={candidate}
          copilot={copilot}
          onAdopted={async () => {
            let name = ''
            try { name = parseCharacterCandidateDraft(candidate.event.content).name } catch { /* gate reports invalid draft */ }
            const beforeIds = new Set(useCharacterStore.getState().characters.map(character => character.id))
            await copilot.adoptCandidate(candidate)
            await loadAll(project.id!)
            const adopted = useCharacterStore.getState().characters.find(character => (
              character.name === name && !beforeIds.has(character.id)
            ))
            if (adopted?.id != null) setSelected(adopted.id)
          }}
        />
      ))}

      {/* 主体：左侧列表 + 右侧详情 */}
      {displayedChars.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-text-muted gap-3">
          <div className="text-4xl opacity-20">📖</div>
          <p className="text-sm">
            {view === 'main' ? '还没有主要角色，可在「角色生成」中创建或调整戏份。' : '还没有角色，点击「新建角色」开始创作'}
          </p>
        </div>
      ) : (
        <div className="flex gap-4">
          {/* 左侧角色列表 */}
          <div className="w-40 shrink-0 space-y-0.5">
            {displayedChars.map((c, i) => {
              const active = selected === c.id
              const colorClass = GLYPH_COLORS[i % GLYPH_COLORS.length]
              return (
                <button
                  key={c.id}
                  {...initialRecordTargetAttributes(c.id === initialCharacterId, c.id)}
                  onClick={() => setSelected(active ? null : c.id!)}
                  className={`w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-left transition-all ${
                    active
                      ? 'bg-accent/8 border-l-2 border-accent'
                      : 'hover:bg-bg-hover border-l-2 border-transparent'
                  } ${c.id === initialCharacterId ? INITIAL_RECORD_TARGET_CLASS : ''}`}
                >
                  <span className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${colorClass}`}>
                    {c.name.charAt(0)}
                  </span>
                  <div className="min-w-0">
                    <p className={`text-sm font-medium truncate ${active ? 'text-accent' : 'text-text-primary'}`}>{c.name}</p>
                    <p className="text-[10px] text-text-muted truncate">
                      {c.shortDescription?.slice(0, 10) || `${ROLE_WEIGHT_LABELS[c.roleWeight]} · ${MORAL_AXIS_LABELS[c.moralAxis]}`}
                    </p>
                  </div>
                </button>
              )
            })}
          </div>

          {/* 右侧详情卡 */}
          <div className="flex-1 min-w-0">
            {selectedChar ? (
              <CharacterDetailCard
                char={selectedChar}
                glyphColor={GLYPH_COLORS[characters.findIndex(c => c.id === selectedChar.id) % GLYPH_COLORS.length]}
                project={project}
                onUpdateField={handleUpdate}
                onPatch={patch => updateCharacter(selectedChar.id!, patch)}
                onReload={() => loadAll(project.id!)}
                onDelete={() => { deleteCharacter(selectedChar.id!); setSelected(null) }}
                multiWorld={!!project.enableMultiWorld}
                worldGroups={groups}
              />
            ) : (
              <div className="flex items-center justify-center h-64 text-text-muted text-sm">
                ← 选择一个角色查看详情
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function CharacterCandidateCard({
  candidate,
  copilot,
  onAdopted,
}: {
  candidate: PendingMasterCandidate
  copilot: ReturnType<typeof useMasterCopilot>
  onAdopted: () => Promise<void>
}) {
  return (
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
        aria-label="角色候选内容"
        value={candidate.event.content}
        disabled={copilot.busy}
        onChange={event => { void copilot.updateCandidate(candidate.event.id!, event.target.value) }}
        className="min-h-72 w-full resize-y font-mono text-xs leading-5"
      />
      {candidate.payload.contextEvidence && (
        <details className="mt-2 border border-border/60 bg-bg-base px-3 py-2 text-[11px] text-text-muted rounded">
          <summary className="cursor-pointer text-text-secondary">本次实际输入证据</summary>
          <p className="mt-2 break-words">
            已纳入：{candidate.payload.contextEvidence.included.join('、') || '无'}
          </p>
          {candidate.payload.contextEvidence.trimmed.length > 0 && (
            <p className="mt-1 text-warning">
              因预算移除：{candidate.payload.contextEvidence.trimmed.join('、')}
            </p>
          )}
        </details>
      )}
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
          onClick={() => { void onAdopted() }}
          className="flex items-center gap-1 bg-accent px-3 py-1.5 text-xs text-white hover:opacity-90 rounded disabled:opacity-50"
        >
          {copilot.busy
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : <Check className="h-3.5 w-3.5" />}
          采纳
        </button>
      </div>
    </section>
  )
}
