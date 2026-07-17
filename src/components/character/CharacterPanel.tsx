import { useState, useEffect } from 'react'
import {
  Plus, Sparkles, ChevronDown,
} from 'lucide-react'
import { CInput } from '../shared/CompositionInput'
import { useCharacterStore } from '../../stores/character'
import { useWorldGroupStore } from '../../stores/world-group'
import { useAIConfigStore } from '../../stores/ai-config'
import { useAIStream } from '../../hooks/useAIStream'
import { createAISessionKey } from '../../stores/ai-generation-session'
import { buildCharacterPrompt } from '../../lib/ai/adapters/character-adapter'
import { parseCharacterOutput } from '../../lib/ai/parse-character-output'
import { adopt } from '../../lib/registry/adopt'
import { assembleContext } from '../../lib/registry/assemble-context'
import AIStreamOutput from '../shared/AIStreamOutput'
import PromptRunPanel from '../shared/PromptRunPanel'
import type {
  Project, Character, CharacterMoralAxis, CharacterOrderAxis, CharacterRoleWeight,
} from '../../lib/types'
import CharacterDimensionPicker from './CharacterDimensionPicker'
import { CHARACTER_DIMENSIONS, type CharacterDimensionKey } from '../../lib/character/character-dimensions'
import CharacterAxesPicker from './CharacterAxesPicker'
import CharacterDetailCard from './CharacterDetailCard'
import {
  MORAL_AXIS_LABELS,
  ORDER_AXIS_LABELS,
  ROLE_WEIGHT_LABELS,
  filterCharactersByRoleWeight,
} from '../../lib/character/character-axes'

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
}

// ── 主面板 ─────────────────────────────────────────────────────

export default function CharacterPanel({ project, view = 'generator' }: Props) {
  const { characters, loadAll, addCharacter, updateCharacter, deleteCharacter } = useCharacterStore()
  const { groups, activeGroupId } = useWorldGroupStore()
  const { config: aiConfig } = useAIConfigStore()
  const [selected, setSelected] = useState<number | null>(null)
  const [hint, setHint] = useState('')
  const [parsing, setParsing] = useState(false)
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
  // 多世界：角色世界过滤器（'all' | 'cross' | 世界组 id）
  const [worldFilter, setWorldFilter] = useState<'all' | 'cross' | number>('all')
  const ai = useAIStream(createAISessionKey(
    project.id!,
    'character.generate',
    project.enableMultiWorld ? String(worldFilter) : 'project',
  ))

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
    const enrichedHint = [hint, rosterGap, dimInstruction].filter(Boolean).join('\n')
    // 多世界：按当前选中/活跃世界读取上下文（此前写死单世界）
    const targetWorld = project.enableMultiWorld
      ? (typeof worldFilter === 'number' ? worldFilter : activeGroupId)
      : null
    const assembled = await assembleContext({
      projectId: project.id!,
      worldGroupId: targetWorld,
      provider: aiConfig.provider,
      model: aiConfig.model,
      sourceKeys: ['worldview', 'storyCore', 'powerSystem', 'codex', 'characters', 'creativeRules', 'worldRules', 'historical', 'locations'],
    })
    const worldCtx = assembled.text
    const opts = {
      parameterValues: Object.keys(parameterValues).length > 0 ? parameterValues : undefined,
      overrides: (systemOverride != null || userOverride != null) ? {
        systemPrompt: systemOverride ?? undefined,
        userPromptTemplate: userOverride ?? undefined,
      } : undefined,
    }
    const messages = buildCharacterPrompt(project.name, project.genre ?? '', worldCtx, existing, enrichedHint, opts)
    ai.start(messages, undefined, { category: 'character.generate', projectId: project.id! })
  }

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
                disabled={ai.isStreaming}
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

      {/* AI 解析中提示 */}
      {view === 'generator' && parsing && (
        <div className="flex items-center gap-2 px-4 py-3 bg-accent/5 border border-accent/20 rounded-lg text-sm text-accent animate-pulse">
          <Sparkles className="w-4 h-4 shrink-0" />
          AI 正在将角色内容分字段整理，请稍候…
        </div>
      )}

      {/* AI 输出 */}
      {view === 'generator' && (ai.output || ai.isStreaming || ai.error) && (
        <AIStreamOutput
          output={ai.output}
          isStreaming={ai.isStreaming}
          error={ai.error} tokenUsage={ai.tokenUsage}
          onStop={ai.stop}
          onAccept={async (text: string) => {
            ai.reset()
            setParsing(true)
            const parsed = await parseCharacterOutput(text, aiConfig)
            setParsing(false)
            const nameMatch = text.match(/(?:\*\*|#{1,3}\s*|【)([^*#\n【】]{1,20})(?:\*\*|】)/)
            const fallbackName = nameMatch?.[1]?.trim() || 'AI 生成角色'
            // 落库全部维度（含 A 扩充的 13 维）：维度字段从 CHARACTER_DIMENSIONS 统一回填，
            // 否则 B 维度勾选器选了新维度、AI 也生成了，却在这里丢失。空串会被 adopt 跳过、不覆盖。
            const dimData = Object.fromEntries(
              CHARACTER_DIMENSIONS.map(d => [d.key, (parsed?.[d.key] as string) || '']),
            )
            const result = await adopt({
              projectId: project.id!,
              worldGroupId: newCharHomeWorld(),
              target: 'characters',
              mode: 'add',
              data: {
                name:          parsed?.name          || fallbackName,
                roleWeight:    parsed?.roleWeight    || 'main',
                moralAxis:     parsed?.moralAxis     || 'neutral',
                orderAxis:     parsed?.orderAxis     || 'neutral',
                relationships: parsed?.relationships || '',
                ...dimData,
                background:    parsed?.background     || text,  // 兜底：解析失败也保住全文
              },
            })
            await loadAll(project.id!)
            if (result.written[0]?.id != null) setSelected(result.written[0].id)
          }}
          onRetry={handleAIGenerate}
          moduleKey="character.generate"
        />
      )}

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
                  onClick={() => setSelected(active ? null : c.id!)}
                  className={`w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-left transition-all ${
                    active
                      ? 'bg-accent/8 border-l-2 border-accent'
                      : 'hover:bg-bg-hover border-l-2 border-transparent'
                  }`}
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
                projectId={project.id!}
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
