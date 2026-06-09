import { CInput, CTextarea } from '../shared/CompositionInput'
import { useState, useEffect } from 'react'
import { Plus, Trash2, ArrowRight, Sparkles, Loader2, LayoutList, LayoutGrid } from 'lucide-react'
import { useForeshadowStore } from '../../stores/foreshadow'
import { useChapterStore } from '../../stores/chapter'
import { useOutlineStore } from '../../stores/outline'
import { useAIConfigStore } from '../../stores/ai-config'
import { useAIStream } from '../../hooks/useAIStream'
import { buildForeshadowSuggestPrompt, buildForeshadowStructurePrompt, parseForeshadowStructured } from '../../lib/ai/adapters/foreshadow-adapter'
import { chat } from '../../lib/ai/client'
import { adopt } from '../../lib/registry/adopt'
import { assembleContext } from '../../lib/registry/assemble-context'
import AIStreamOutput from '../shared/AIStreamOutput'
import PromptRunPanel from '../shared/PromptRunPanel'
import ForeshadowKanban from './ForeshadowKanban'
import type { Project, Foreshadow, ForeshadowStatus, ForeshadowType } from '../../lib/types'

const STATUS_LABELS: Record<ForeshadowStatus, { label: string; color: string }> = {
  planned: { label: '📋 计划中', color: 'text-text-muted' },
  planted: { label: '🌱 已埋设', color: 'text-warning' },
  echoed: { label: '🔔 已呼应', color: 'text-info' },
  resolved: { label: '✅ 已回收', color: 'text-success' },
}

const TYPE_LABELS: Record<ForeshadowType, string> = {
  chekhov: '🔫 契诃夫之枪', prophecy: '🔮 预言暗示', symbol: '🎭 象征伏笔',
  character: '👤 角色伏笔', dialogue: '💬 对话伏笔', environment: '🌿 环境伏笔',
  timeline: '⏰ 时间线', 'red-herring': '🐟 红鲱鱼', parallel: '🔄 平行伏笔', callback: '↩️ 回调伏笔',
}

const STATUS_FLOW: ForeshadowStatus[] = ['planned', 'planted', 'echoed', 'resolved']

interface Props { project: Project }

export default function ForeshadowPanel({ project }: Props) {
  const { foreshadows, loadAll, addForeshadow, updateForeshadow, deleteForeshadow, updateStatus } = useForeshadowStore()
  const { chapters } = useChapterStore()
  const { nodes: outlineNodes } = useOutlineStore()
  const { config } = useAIConfigStore()
  const ai = useAIStream()
  const [filterStatus, setFilterStatus] = useState<ForeshadowStatus | 'all'>('all')
  const [selected, setSelected] = useState<number | null>(null)
  const [showAI, setShowAI] = useState(false)
  const [viewMode, setViewMode] = useState<'list' | 'kanban'>('list')
  const [parameterValues, setParameterValues] = useState<Record<string, unknown>>({})
  const [systemOverride, setSystemOverride] = useState<string | null>(null)
  const [userOverride, setUserOverride] = useState<string | null>(null)
  const [adopting, setAdopting] = useState(false)
  const [adoptMsg, setAdoptMsg] = useState<string | null>(null)

  useEffect(() => { loadAll(project.id!) }, [project.id, loadAll])

  // 采纳 AI 伏笔建议：用 AI 把自由文本结构化 → 批量写入伏笔表
  const handleAdoptForeshadows = async (text: string) => {
    if (!text.trim()) return
    setAdopting(true)
    setAdoptMsg(null)
    try {
      const raw = await chat(buildForeshadowStructurePrompt(text), config)
      const items = parseForeshadowStructured(raw)
      if (items.length === 0) {
        setAdoptMsg('未能解析出伏笔条目，请重试或手动添加')
        return
      }
      const result = await adopt({
        projectId: project.id!,
        target: 'foreshadows',
        mode: 'add-many',
        data: items.map(it => ({
          name: it.name,
          type: it.type,
          status: 'planned',
          description: it.description,
          plantChapterId: null,
          echoChapterIds: [],
          resolveChapterId: null,
          notes: '',
        })),
      })
      await loadAll(project.id!)
      setAdoptMsg(`已写入 ${result.written.length} 条伏笔${result.skipped.length ? `，跳过 ${result.skipped.length} 条` : ''}`)
      setShowAI(false)
    } catch (err) {
      setAdoptMsg(`采纳失败：${err instanceof Error ? err.message : '未知错误'}`)
    } finally {
      setAdopting(false)
    }
  }

  const filtered = filterStatus === 'all' ? foreshadows : foreshadows.filter(f => f.status === filterStatus)
  const selectedF = foreshadows.find(f => f.id === selected)

  const handleAdd = async () => {
    const id = await addForeshadow({
      projectId: project.id!, name: '新伏笔', type: 'chekhov', status: 'planned',
      description: '', plantChapterId: null, echoChapterIds: '[]', resolveChapterId: null, notes: '',
    })
    setSelected(id)
  }

  const handleUpdate = (field: keyof Foreshadow, value: string | number | null) => {
    if (selectedF?.id) updateForeshadow(selectedF.id, { [field]: value })
  }

  const handleNextStatus = (f: Foreshadow) => {
    const idx = STATUS_FLOW.indexOf(f.status)
    if (idx < STATUS_FLOW.length - 1 && f.id) {
      updateStatus(f.id, STATUS_FLOW[idx + 1])
    }
  }

  // 获取章节名称
  const getChapterLabel = (chapterId: number) => {
    const ch = chapters.find(c => c.id === chapterId)
    if (!ch) return `章节#${chapterId}`
    const node = outlineNodes.find(n => n.id === ch.outlineNodeId)
    return node?.title || ch.title || `章节#${chapterId}`
  }

  // 解析 echoChapterIds
  const getEchoIds = (f: Foreshadow): number[] => {
    try { return JSON.parse(f.echoChapterIds || '[]') } catch { return [] }
  }

  // 切换呼应章节
  const toggleEchoChapter = (chapterId: number) => {
    if (!selectedF) return
    const ids = getEchoIds(selectedF)
    const newIds = ids.includes(chapterId)
      ? ids.filter(id => id !== chapterId)
      : [...ids, chapterId]
    handleUpdate('echoChapterIds', JSON.stringify(newIds))
  }

  // AI 建议伏笔
  const handleAISuggest = async () => {
    if (!config.apiKey) return
    setShowAI(true)
    const assembled = await assembleContext({
      projectId: project.id!,
      worldGroupId: null,
      provider: config.provider,
      model: config.model,
      sourceKeys: ['worldview', 'storyCore', 'powerSystem', 'codex', 'characters', 'creativeRules', 'worldRules', 'historical', 'locations'],
    })
    const charIdx = assembled.included.indexOf('characters')
    const worldCtx = assembled.text
    const charCtx = charIdx >= 0 ? assembled.segments[charIdx]?.content ?? '' : ''
    const existingForeshadows = foreshadows.map(f => `${f.name}（${TYPE_LABELS[f.type]}，${STATUS_LABELS[f.status].label}）：${f.description.slice(0, 100)}`).join('\n')
    const opts = {
      parameterValues: Object.keys(parameterValues).length > 0 ? parameterValues : undefined,
      overrides: (systemOverride != null || userOverride != null) ? {
        systemPrompt: systemOverride ?? undefined,
        userPromptTemplate: userOverride ?? undefined,
      } : undefined,
    }
    const messages = buildForeshadowSuggestPrompt(project.name, project.genre, worldCtx, charCtx, existingForeshadows, opts)
    ai.start(messages)
  }

  return (
    <div className="space-y-4 max-w-6xl">
      {/* 顶部工具栏 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={handleAdd}
            className="flex items-center gap-1.5 px-3 py-2 bg-accent text-white text-sm rounded-md hover:bg-accent-hover transition-colors">
            <Plus className="w-4 h-4" /> 添加伏笔
          </button>
          <button onClick={handleAISuggest}
            disabled={ai.isStreaming || !config.apiKey}
            className="flex items-center gap-1 px-2 py-2 bg-bg-elevated text-accent text-sm rounded-md hover:bg-bg-hover transition-colors disabled:opacity-40"
            title="AI 建议伏笔">
            {ai.isStreaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
          </button>
        </div>
        {/* 视图切换 */}
        <div className="flex items-center gap-1 bg-bg-elevated rounded-lg p-0.5">
          <button
            onClick={() => setViewMode('list')}
            className={`flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-md transition ${
              viewMode === 'list' ? 'bg-bg-surface text-accent shadow-sm' : 'text-text-muted hover:text-text-primary'
            }`}
            title="列表视图"
          >
            <LayoutList className="w-3.5 h-3.5" /> 列表
          </button>
          <button
            onClick={() => setViewMode('kanban')}
            className={`flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-md transition ${
              viewMode === 'kanban' ? 'bg-bg-surface text-accent shadow-sm' : 'text-text-muted hover:text-text-primary'
            }`}
            title="看板视图"
          >
            <LayoutGrid className="w-3.5 h-3.5" /> 看板
          </button>
        </div>
      </div>

      {/* 看板视图 */}
      {viewMode === 'kanban' ? (
        <ForeshadowKanban onSelectForeshadow={(id) => { setSelected(id); setViewMode('list') }} />
      ) : (
      <div className="flex gap-4">
      {/* 左侧列表 */}
      <div className="w-60 shrink-0 space-y-2">

        {/* 状态筛选 */}
        <div className="flex flex-wrap gap-1">
          <button onClick={() => setFilterStatus('all')}
            className={`px-2 py-1 text-xs rounded ${filterStatus === 'all' ? 'bg-accent text-white' : 'bg-bg-elevated text-text-muted'}`}>
            全部
          </button>
          {STATUS_FLOW.map(s => (
            <button key={s} onClick={() => setFilterStatus(s)}
              className={`px-2 py-1 text-xs rounded ${filterStatus === s ? 'bg-accent text-white' : 'bg-bg-elevated text-text-muted'}`}>
              {STATUS_LABELS[s].label}
            </button>
          ))}
        </div>

        {filtered.map(f => (
          <button key={f.id} onClick={() => { setSelected(f.id!); setShowAI(false) }}
            className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
              selected === f.id ? 'bg-accent/10 text-accent border border-accent/30' : 'bg-bg-surface text-text-secondary hover:bg-bg-hover'
            }`}>
            <div className="font-medium truncate">{f.name}</div>
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <span>{TYPE_LABELS[f.type]?.split(' ')[0]}</span>
              <span className={STATUS_LABELS[f.status].color}>{STATUS_LABELS[f.status].label}</span>
            </div>
          </button>
        ))}
      </div>

      {/* 右侧编辑 */}
      <div className="flex-1 space-y-4">
        {/* AI 建议区域 */}
        {showAI && (
          <div className="bg-bg-surface border border-accent/20 rounded-lg p-4 space-y-3">
            <h3 className="text-sm font-semibold text-accent mb-2 flex items-center gap-1.5">
              <Sparkles className="w-4 h-4" /> AI 伏笔建议
            </h3>
            <PromptRunPanel
              moduleKey="foreshadow.generate"
              parameterValues={parameterValues}
              onParamChange={setParameterValues}
              systemOverride={systemOverride}
              onSystemOverrideChange={setSystemOverride}
              userOverride={userOverride}
              onUserOverrideChange={setUserOverride}
            />
            {adopting && (
              <div className="flex items-center gap-2 text-xs text-accent">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> AI 正在把建议整理为伏笔条目并写入…
              </div>
            )}
            {adoptMsg && <div className="text-xs text-text-muted">{adoptMsg}</div>}
            <AIStreamOutput
              output={ai.output}
              isStreaming={ai.isStreaming}
              error={ai.error} tokenUsage={ai.tokenUsage}
              onStop={ai.stop}
              onRetry={handleAISuggest}
              onAccept={(text: string) => { handleAdoptForeshadows(text) }}
              moduleKey="foreshadow.generate"
            />
          </div>
        )}

        {selectedF ? (
          <div className="bg-bg-surface border border-border rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <CInput value={selectedF.name} onChange={e => handleUpdate('name', e.target.value)}
                className="text-lg font-bold bg-transparent text-text-primary border-none outline-none" />
              <div className="flex items-center gap-2">
                <button onClick={() => handleNextStatus(selectedF)}
                  disabled={selectedF.status === 'resolved'}
                  className="flex items-center gap-1 px-2 py-1 text-xs bg-bg-elevated text-text-secondary rounded hover:text-accent disabled:opacity-30">
                  <ArrowRight className="w-3 h-3" /> 推进状态
                </button>
                <button onClick={() => { deleteForeshadow(selectedF.id!); setSelected(null) }}
                  className="text-text-muted hover:text-error"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>

            <div className="flex gap-3">
              <div>
                <label className="block text-xs text-text-muted mb-1">类型</label>
                <select value={selectedF.type} onChange={e => handleUpdate('type', e.target.value)}
                  className="px-2 py-1.5 bg-bg-elevated text-text-secondary text-xs rounded border border-border">
                  {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-text-muted mb-1">状态</label>
                <span className={`text-sm ${STATUS_LABELS[selectedF.status].color}`}>
                  {STATUS_LABELS[selectedF.status].label}
                </span>
              </div>
            </div>

            <div>
              <label className="block text-xs text-text-muted mb-1">伏笔描述</label>
              <CTextarea value={selectedF.description} onChange={e => handleUpdate('description', e.target.value)}
                rows={4} className="w-full p-2 bg-bg-base border border-border rounded text-sm text-text-primary resize-y focus:outline-none focus:border-accent" />
            </div>

            {/* 章节关联区域 */}
            <div className="border-t border-border pt-3 space-y-3">
              <h4 className="text-sm font-semibold text-text-primary">📌 章节关联</h4>

              {/* 埋设章节 */}
              <div>
                <label className="block text-xs text-text-muted mb-1">埋设章节（在哪一章埋下伏笔）</label>
                <select
                  value={selectedF.plantChapterId ?? ''}
                  onChange={e => handleUpdate('plantChapterId', e.target.value ? Number(e.target.value) : null)}
                  className="w-full px-2 py-1.5 bg-bg-base border border-border rounded text-sm text-text-primary">
                  <option value="">未指定</option>
                  {chapters.map(ch => (
                    <option key={ch.id} value={ch.id}>{getChapterLabel(ch.id!)}</option>
                  ))}
                </select>
              </div>

              {/* 呼应章节（多选） */}
              <div>
                <label className="block text-xs text-text-muted mb-1">呼应章节（在哪些章节呼应伏笔，可多选）</label>
                {chapters.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto p-2 bg-bg-base border border-border rounded">
                    {chapters.map(ch => {
                      const isSelected = getEchoIds(selectedF).includes(ch.id!)
                      return (
                        <button key={ch.id} onClick={() => toggleEchoChapter(ch.id!)}
                          className={`px-2 py-1 text-xs rounded transition-colors ${
                            isSelected ? 'bg-accent text-white' : 'bg-bg-elevated text-text-muted hover:text-text-primary'
                          }`}>
                          {getChapterLabel(ch.id!)}
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-text-muted">暂无章节，请先在大纲中创建章节</p>
                )}
              </div>

              {/* 回收章节 */}
              <div>
                <label className="block text-xs text-text-muted mb-1">回收章节（在哪一章回收伏笔）</label>
                <select
                  value={selectedF.resolveChapterId ?? ''}
                  onChange={e => handleUpdate('resolveChapterId', e.target.value ? Number(e.target.value) : null)}
                  className="w-full px-2 py-1.5 bg-bg-base border border-border rounded text-sm text-text-primary">
                  <option value="">未指定</option>
                  {chapters.map(ch => (
                    <option key={ch.id} value={ch.id}>{getChapterLabel(ch.id!)}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs text-text-muted mb-1">备注</label>
              <CTextarea value={selectedF.notes} onChange={e => handleUpdate('notes', e.target.value)}
                rows={2} className="w-full p-2 bg-bg-base border border-border rounded text-xs text-text-muted resize-y focus:outline-none focus:border-accent" />
            </div>
          </div>
        ) : !showAI ? (
          <div className="flex items-center justify-center h-64 text-text-muted text-sm">
            ← 选择或添加一个伏笔
          </div>
        ) : null}
      </div>
    </div>
      )}
    </div>
  )
}
