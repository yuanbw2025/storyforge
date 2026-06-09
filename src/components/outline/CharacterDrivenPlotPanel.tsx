/**
 * Phase 26.3 — 角色驱动剧情面板
 *
 * 用户为选中的角色设定初始/目标状态 → AI 生成中间情节大纲 → 可批量导入到大纲
 */

import { useState, useEffect, useMemo } from 'react'
import {
  Sparkles, Trash2, Check, ChevronDown, ChevronRight,
  Users, BookOpen, Loader2, ArrowRight,
} from 'lucide-react'
import { useCharacterStore } from '../../stores/character'
import { useOutlineStore } from '../../stores/outline'
import { useAIStream } from '../../hooks/useAIStream'
import {
  buildCharacterDrivenPlotPrompt,
  parsePlotOutput,
  type CharacterArcInput,
  type PlotVolume,
} from '../../lib/ai/character-driven-plot'
import AIStreamOutput from '../shared/AIStreamOutput'
import AutoResizeTextarea from '../shared/AutoResizeTextarea'
import type { Project } from '../../lib/types'

interface Props {
  project: Project
}

const ROLE_LABELS: Record<string, string> = {
  protagonist: '主角',
  antagonist: '反派',
  supporting: '重要配角',
  minor: '次要角色',
  npc: 'NPC',
  extra: '路人',
}

export default function CharacterDrivenPlotPanel({ project }: Props) {
  const { characters, loadAll: loadChars } = useCharacterStore()
  const { nodes, loadAll: loadOutline, addNode } = useOutlineStore()
  const ai = useAIStream()

  const [arcs, setArcs] = useState<CharacterArcInput[]>([])
  const [userHint, setUserHint] = useState('')
  const [parsedVolumes, setParsedVolumes] = useState<PlotVolume[] | null>(null)
  const [selectedVolumes, setSelectedVolumes] = useState<Set<number>>(new Set())
  const [expandedVolumes, setExpandedVolumes] = useState<Set<number>>(new Set())
  const [importing, setImporting] = useState(false)
  const [importDone, setImportDone] = useState(false)

  useEffect(() => { loadChars(project.id!) }, [project.id, loadChars])
  useEffect(() => { loadOutline(project.id!) }, [project.id, loadOutline])

  // 可选角色列表（排除已添加的）
  const availableChars = useMemo(() => {
    const addedIds = new Set(arcs.map(a => a.characterId))
    return characters.filter(c =>
      c.id != null && !addedIds.has(c.id) &&
      (c.role === 'protagonist' || c.role === 'antagonist' || c.role === 'supporting' || c.role === 'minor'),
    )
  }, [characters, arcs])

  // 添加角色弧光
  const handleAddArc = (charId: number) => {
    const ch = characters.find(c => c.id === charId)
    if (!ch) return
    setArcs(prev => [...prev, {
      characterId: charId,
      name: ch.name,
      role: ROLE_LABELS[ch.role] || ch.role,
      initialState: '',
      targetState: '',
    }])
  }

  // 从角色已有信息预填
  const handleAutoFill = (index: number) => {
    const arc = arcs[index]
    const ch = characters.find(c => c.id === arc.characterId)
    if (!ch) return
    const updates = { ...arc }
    if (!updates.initialState && ch.background) {
      updates.initialState = ch.background.slice(0, 200)
    }
    if (!updates.targetState && ch.arc) {
      updates.targetState = ch.arc.slice(0, 200)
    }
    setArcs(prev => prev.map((a, i) => i === index ? updates : a))
  }

  // 删除弧光
  const handleRemoveArc = (index: number) => {
    setArcs(prev => prev.filter((_, i) => i !== index))
  }

  // 更新弧光字段
  const handleUpdateArc = (index: number, field: 'initialState' | 'targetState', value: string) => {
    setArcs(prev => prev.map((a, i) => i === index ? { ...a, [field]: value } : a))
  }

  // 开始生成
  const handleGenerate = async () => {
    if (arcs.length === 0 || arcs.some(a => !a.initialState.trim() || !a.targetState.trim())) return
    setParsedVolumes(null)
    setImportDone(false)

    const messages = await buildCharacterDrivenPlotPrompt(
      project.id!,
      project.name,
      project.genres?.join('/') || '',
      arcs,
      userHint || undefined,
    )

    await ai.start(messages)
  }

  // 解析 AI 输出
  useEffect(() => {
    if (!ai.isStreaming && ai.output) {
      const volumes = parsePlotOutput(ai.output)
      if (volumes.length > 0) {
        setParsedVolumes(volumes)
        setSelectedVolumes(new Set(volumes.map((_, i) => i)))
        setExpandedVolumes(new Set(volumes.map((_, i) => i)))
      }
    }
  }, [ai.isStreaming, ai.output])

  // 采纳 → 写入大纲
  const handleAcceptToOutline = async () => {
    if (!parsedVolumes || selectedVolumes.size === 0) return
    setImporting(true)

    const existingTopLevel = nodes.filter(n => n.parentId === null).length

    for (const vi of Array.from(selectedVolumes).sort()) {
      const vol = parsedVolumes[vi]
      if (!vol) continue

      const volId = await addNode({
        projectId: project.id!,
        parentId: null,
        type: 'volume',
        title: vol.volumeTitle,
        summary: vol.volumeSummary,
        order: existingTopLevel + vi,
      })

      for (let ci = 0; ci < vol.chapters.length; ci++) {
        const ch = vol.chapters[ci]
        await addNode({
          projectId: project.id!,
          parentId: volId,
          type: 'chapter',
          title: ch.title,
          summary: `${ch.summary}${ch.arcProgress ? `\n\n【角色弧光推进】${ch.arcProgress}` : ''}`,
          order: ci,
        })
      }
    }

    setImporting(false)
    setImportDone(true)
  }

  // 切换卷展开
  const toggleExpand = (idx: number) => {
    setExpandedVolumes(prev => {
      const next = new Set(prev)
      next.has(idx) ? next.delete(idx) : next.add(idx)
      return next
    })
  }

  // 切换卷选中
  const toggleSelect = (idx: number) => {
    setSelectedVolumes(prev => {
      const next = new Set(prev)
      next.has(idx) ? next.delete(idx) : next.add(idx)
      return next
    })
  }

  const canGenerate = arcs.length > 0 && arcs.every(a => a.initialState.trim() && a.targetState.trim()) && !ai.isStreaming

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* 顶部标题 */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border-default bg-bg-surface">
        <Users className="w-5 h-5 text-brand-primary" />
        <h2 className="text-lg font-semibold text-text-primary">角色驱动剧情</h2>
        <span className="text-xs text-text-muted ml-2">从角色弧光反推情节大纲</span>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* ── 角色弧光设定区 ─────────────────────────── */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-text-primary">角色弧光设定</h3>
            {availableChars.length > 0 && (
              <div className="flex items-center gap-2">
                <select
                  className="text-xs bg-bg-base border border-border-default rounded px-2 py-1 text-text-primary"
                  value=""
                  onChange={e => {
                    const id = Number(e.target.value)
                    if (id) handleAddArc(id)
                  }}
                >
                  <option value="">+ 添加角色</option>
                  {availableChars.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name}（{ROLE_LABELS[c.role] || c.role}）
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {arcs.length === 0 ? (
            <div className="text-center py-8 text-text-muted text-sm border border-dashed border-border-default rounded-lg">
              <Users className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p>请从上方下拉框添加角色</p>
              <p className="text-xs mt-1">设定角色的起始状态和目标状态，AI 将推演中间情节</p>
            </div>
          ) : (
            <div className="space-y-4">
              {arcs.map((arc, i) => (
                <div key={arc.characterId} className="bg-bg-surface border border-border-default rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-text-primary">{arc.name}</span>
                      <span className="text-xs px-1.5 py-0.5 bg-bg-hover rounded text-text-muted">{arc.role}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleAutoFill(i)}
                        className="text-xs text-brand-primary hover:underline"
                        title="从角色卡已有信息自动填充"
                      >
                        自动填充
                      </button>
                      <button
                        onClick={() => handleRemoveArc(i)}
                        className="p-1 text-text-muted hover:text-red-500 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-text-muted mb-1">
                        🟢 起始状态
                      </label>
                      <AutoResizeTextarea
                        value={arc.initialState}
                        onChange={e => handleUpdateArc(i, 'initialState', e.target.value)}
                        placeholder="角色在故事开始时的状态、处境、性格特点..."
                        className="w-full text-sm bg-bg-base border border-border-default rounded px-3 py-2 text-text-primary placeholder:text-text-muted resize-none"
                        minRows={2}
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-text-muted mb-1">
                        🔴 目标状态/结局
                      </label>
                      <AutoResizeTextarea
                        value={arc.targetState}
                        onChange={e => handleUpdateArc(i, 'targetState', e.target.value)}
                        placeholder="角色在故事结束时应达到的状态、成长结果..."
                        className="w-full text-sm bg-bg-base border border-border-default rounded px-3 py-2 text-text-primary placeholder:text-text-muted resize-none"
                        minRows={2}
                      />
                    </div>
                  </div>

                  {/* 弧光方向指示 */}
                  {arc.initialState && arc.targetState && (
                    <div className="mt-2 flex items-center gap-2 text-xs text-text-muted">
                      <span className="truncate max-w-[40%]">{arc.initialState.slice(0, 30)}...</span>
                      <ArrowRight className="w-3.5 h-3.5 text-brand-primary flex-shrink-0" />
                      <span className="truncate max-w-[40%]">{arc.targetState.slice(0, 30)}...</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── 额外提示 ─────────────────────────────── */}
        {arcs.length > 0 && (
          <section>
            <label className="block text-xs text-text-muted mb-1">额外要求（可选）</label>
            <AutoResizeTextarea
              value={userHint}
              onChange={e => setUserHint(e.target.value)}
              placeholder="例如：控制在3卷以内、侧重战斗场景、需要感情线贯穿始终..."
              className="w-full text-sm bg-bg-base border border-border-default rounded px-3 py-2 text-text-primary placeholder:text-text-muted resize-none"
              minRows={2}
            />
          </section>
        )}

        {/* ── 生成按钮 ──────────────────────────────── */}
        {arcs.length > 0 && (
          <div className="flex items-center gap-3">
            <button
              onClick={handleGenerate}
              disabled={!canGenerate}
              className="flex items-center gap-1.5 px-4 py-2 bg-brand-primary text-white rounded-lg text-sm font-medium hover:bg-brand-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {ai.isStreaming ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              {ai.isStreaming ? '生成中...' : '生成剧情大纲'}
            </button>
            {ai.isStreaming && (
              <button
                onClick={ai.stop}
                className="text-xs text-text-muted hover:text-red-500 transition-colors"
              >
                停止
              </button>
            )}
          </div>
        )}

        {/* ── AI 输出 ──────────────────────────────── */}
        {(ai.output || ai.isStreaming || ai.error) && (
          <section>
            <AIStreamOutput
              output={ai.output}
              isStreaming={ai.isStreaming}
              error={ai.error}
              tokenUsage={ai.tokenUsage}
              onStop={ai.stop}
              onAccept={() => {
                const vols = parsePlotOutput(ai.output)
                if (vols.length > 0) {
                  setParsedVolumes(vols)
                  setSelectedVolumes(new Set(vols.map((_, i) => i)))
                  setExpandedVolumes(new Set(vols.map((_, i) => i)))
                }
              }}
              onRetry={handleGenerate}
              placeholder="等待 AI 生成角色驱动剧情..."
              moduleKey="plot.character-driven"
            />
          </section>
        )}

        {/* ── 解析结果预览 ─────────────────────────── */}
        {parsedVolumes && parsedVolumes.length > 0 && !ai.isStreaming && (
          <section className="border border-border-default rounded-lg overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 bg-bg-surface border-b border-border-default">
              <div className="flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-brand-primary" />
                <span className="text-sm font-medium text-text-primary">
                  生成结果：{parsedVolumes.length} 卷，
                  {parsedVolumes.reduce((s, v) => s + v.chapters.length, 0)} 章
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setSelectedVolumes(
                    selectedVolumes.size === parsedVolumes.length
                      ? new Set()
                      : new Set(parsedVolumes.map((_, i) => i)),
                  )}
                  className="text-xs text-brand-primary hover:underline"
                >
                  {selectedVolumes.size === parsedVolumes.length ? '取消全选' : '全选'}
                </button>
              </div>
            </div>

            <div className="divide-y divide-border-default max-h-[400px] overflow-y-auto">
              {parsedVolumes.map((vol, vi) => (
                <div key={vi}>
                  {/* 卷标题行 */}
                  <div
                    className="flex items-center gap-2 px-4 py-2 cursor-pointer hover:bg-bg-hover transition-colors"
                    onClick={() => toggleExpand(vi)}
                  >
                    <input
                      type="checkbox"
                      checked={selectedVolumes.has(vi)}
                      onChange={() => toggleSelect(vi)}
                      onClick={e => e.stopPropagation()}
                      className="accent-brand-primary"
                    />
                    {expandedVolumes.has(vi) ? (
                      <ChevronDown className="w-3.5 h-3.5 text-text-muted" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5 text-text-muted" />
                    )}
                    <span className="text-sm font-medium text-text-primary">{vol.volumeTitle}</span>
                    <span className="text-xs text-text-muted">（{vol.chapters.length} 章）</span>
                  </div>

                  {/* 卷摘要 + 角色弧光 */}
                  {expandedVolumes.has(vi) && (
                    <div className="px-4 pb-2">
                      {vol.volumeSummary && (
                        <p className="text-xs text-text-muted mb-1 pl-8">{vol.volumeSummary}</p>
                      )}
                      {vol.characterArcs && (
                        <p className="text-xs text-text-muted mb-2 pl-8 italic">弧光：{vol.characterArcs}</p>
                      )}
                      {/* 章节列表 */}
                      <div className="pl-8 space-y-1">
                        {vol.chapters.map((ch, ci) => (
                          <div key={ci} className="flex items-start gap-2 text-xs">
                            <span className="text-text-muted w-6 text-right flex-shrink-0">{ci + 1}.</span>
                            <div className="flex-1 min-w-0">
                              <span className="text-text-primary font-medium">{ch.title}</span>
                              {ch.summary && (
                                <span className="text-text-muted ml-1">— {ch.summary}</span>
                              )}
                              {ch.keyCharacters.length > 0 && (
                                <span className="text-brand-primary ml-1">
                                  [{ch.keyCharacters.join(', ')}]
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* 导入按钮 */}
            <div className="flex items-center justify-between px-4 py-3 bg-bg-surface border-t border-border-default">
              {importDone ? (
                <div className="flex items-center gap-1.5 text-green-600 text-sm">
                  <Check className="w-4 h-4" />
                  已成功导入到大纲
                </div>
              ) : (
                <button
                  onClick={handleAcceptToOutline}
                  disabled={selectedVolumes.size === 0 || importing}
                  className="flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {importing ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                  导入选中卷到大纲（{selectedVolumes.size} 卷）
                </button>
              )}
              <span className="text-xs text-text-muted">
                导入后可在「大纲」面板查看和编辑
              </span>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
