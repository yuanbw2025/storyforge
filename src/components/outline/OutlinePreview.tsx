/**
 * 大纲预览面板 — Phase D3
 *
 * 一个章节的完整信息聚合视图：
 * - 章节标题 + 摘要
 * - 开头衔接 + 结尾悬念
 * - 出场角色列表
 * - 相关伏笔（埋设/呼应/回收）
 * - 场景地点 + 情绪走向
 */
import { useMemo, useState, useEffect } from 'react'
import { X, MapPin, Users, BookOpen, Zap, TrendingUp, Bookmark } from 'lucide-react'
import { useDetailedOutlineStore } from '../../stores/detailed-outline'
import { useCharacterStore } from '../../stores/character'
import { useForeshadowStore } from '../../stores/foreshadow'
import { useOutlineStore } from '../../stores/outline'
import type { EmotionArc, ScenePace } from '../../lib/types'

interface Props {
  /** 当前章节的 outlineNodeId */
  outlineNodeId: number
  /** 关闭回调 */
  onClose: () => void
}

const EMOTION_LABELS: Record<EmotionArc, { label: string; color: string }> = {
  rising:  { label: '📈 情绪升温', color: 'text-success' },
  falling: { label: '📉 情绪降温', color: 'text-info' },
  flat:    { label: '➡️ 平稳叙事', color: 'text-text-muted' },
  wave:    { label: '🌊 起伏波动', color: 'text-warning' },
  climax:  { label: '⚡ 全程高潮', color: 'text-error' },
}

const PACE_COLORS: Record<ScenePace, string> = {
  slow:   'bg-info/15 text-info',
  medium: 'bg-text-muted/15 text-text-secondary',
  fast:   'bg-warning/15 text-warning',
  climax: 'bg-error/15 text-error',
}

const PACE_LABELS: Record<ScenePace, string> = {
  slow: '慢', medium: '中', fast: '快', climax: '高潮',
}

export default function OutlinePreview({ outlineNodeId, onClose }: Props) {
  const { nodes, updateNode } = useOutlineStore()
  const { detailedOutlines } = useDetailedOutlineStore()
  const { characters } = useCharacterStore()
  const { foreshadows } = useForeshadowStore()

  const node = nodes.find(n => n.id === outlineNodeId)
  const detail = detailedOutlines.find(d => d.outlineNodeId === outlineNodeId)

  // FB-3:章节大纲(摘要)可手动编辑 —— 此前只读显示,用户无法改了再用。
  const [summaryDraft, setSummaryDraft] = useState('')
  useEffect(() => { setSummaryDraft(node?.summary || '') }, [node?.summary])

  // 查找关联角色
  const appearingChars = useMemo(() => {
    if (!detail?.appearingCharacterIds?.length) return []
    return detail.appearingCharacterIds
      .map(id => characters.find(c => c.id === id))
      .filter(Boolean)
  }, [detail?.appearingCharacterIds, characters])

  // 查找关联伏笔
  const relatedForeshadows = useMemo(() => {
    if (!detail?.foreshadowIds?.length) return []
    return detail.foreshadowIds
      .map(id => foreshadows.find(f => f.id === id))
      .filter(Boolean)
  }, [detail?.foreshadowIds, foreshadows])

  // 本章涉及的伏笔（基于 plantChapterId / expectedResolveChapterId）
  const chapterForeshadows = useMemo(() => {
    return foreshadows.filter(f =>
      f.plantChapterId === outlineNodeId ||
      f.expectedResolveChapterId === outlineNodeId ||
      (() => {
        try {
          const echoIds: number[] = JSON.parse(f.echoChapterIds || '[]')
          return echoIds.includes(outlineNodeId)
        } catch { return false }
      })()
    )
  }, [foreshadows, outlineNodeId])

  // 合并两个来源的伏笔（去重）
  const allForeshadows = useMemo(() => {
    const map = new Map<number, typeof foreshadows[0]>()
    for (const f of [...relatedForeshadows, ...chapterForeshadows]) {
      if (f && f.id) map.set(f.id, f)
    }
    return Array.from(map.values())
  }, [relatedForeshadows, chapterForeshadows])

  if (!node) return null

  return (
    <div className="bg-bg-surface border border-border rounded-xl overflow-hidden shadow-lg">
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 bg-bg-elevated border-b border-border">
        <div className="flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-accent" />
          <h3 className="text-sm font-bold text-text-primary">{node.title}</h3>
        </div>
        <button onClick={onClose} className="p-1 text-text-muted hover:text-text-primary rounded transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-4 space-y-4 max-h-[60vh] overflow-y-auto">
        {/* 章节摘要(章节大纲)— FB-3:可手动编辑,失焦自动保存 */}
        {(
          <div>
            <SectionLabel icon={<BookOpen className="w-3 h-3" />} label="章节摘要" />
            <textarea
              value={summaryDraft}
              onChange={e => setSummaryDraft(e.target.value)}
              onBlur={() => { if (node.id != null && summaryDraft !== (node.summary || '')) updateNode(node.id, { summary: summaryDraft }) }}
              rows={3}
              placeholder="章节大纲/摘要(可手动编辑,失焦自动保存)"
              className="w-full px-2 py-1.5 bg-bg-base border border-border rounded text-sm text-text-secondary leading-relaxed resize-y focus:outline-none focus:border-accent"
            />
          </div>
        )}

        {/* 开头衔接 + 结尾悬念 */}
        {(detail?.openingHook || detail?.endingCliffhanger) && (
          <div className="grid grid-cols-2 gap-3">
            {detail.openingHook && (
              <div className="bg-bg-base rounded-lg p-3">
                <span className="text-[10px] font-medium text-accent uppercase tracking-wide">🔗 开头衔接</span>
                <p className="text-xs text-text-primary mt-1">{detail.openingHook}</p>
              </div>
            )}
            {detail.endingCliffhanger && (
              <div className="bg-bg-base rounded-lg p-3">
                <span className="text-[10px] font-medium text-warning uppercase tracking-wide">🎣 结尾悬念</span>
                <p className="text-xs text-text-primary mt-1">{detail.endingCliffhanger}</p>
              </div>
            )}
          </div>
        )}

        {/* 场景地点 + 情绪走向 */}
        <div className="flex items-center gap-4 flex-wrap">
          {detail?.sceneLocation && (
            <div className="flex items-center gap-1.5 text-xs text-text-secondary">
              <MapPin className="w-3 h-3" />
              <span>{detail.sceneLocation}</span>
            </div>
          )}
          {detail?.emotionArc && (
            <span className={`text-xs ${EMOTION_LABELS[detail.emotionArc]?.color || ''}`}>
              {EMOTION_LABELS[detail.emotionArc]?.label || detail.emotionArc}
            </span>
          )}
        </div>

        {/* 出场角色 */}
        {appearingChars.length > 0 && (
          <div>
            <SectionLabel icon={<Users className="w-3 h-3" />} label={`出场角色 (${appearingChars.length})`} />
            <div className="flex flex-wrap gap-1.5">
              {appearingChars.map(c => c && (
                <span key={c.id} className="inline-flex items-center gap-1 px-2 py-1 bg-accent/10 text-accent text-xs rounded-full">
                  {c.name}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* 相关伏笔 */}
        {allForeshadows.length > 0 && (
          <div>
            <SectionLabel icon={<Bookmark className="w-3 h-3" />} label={`相关伏笔 (${allForeshadows.length})`} />
            <div className="space-y-1">
              {allForeshadows.map(f => {
                let role = ''
                if (f.plantChapterId === outlineNodeId) role = '埋设'
                else if (f.expectedResolveChapterId === outlineNodeId) role = '回收'
                else role = '呼应'

                const roleColors: Record<string, string> = {
                  '埋设': 'bg-info/15 text-info',
                  '回收': 'bg-success/15 text-success',
                  '呼应': 'bg-warning/15 text-warning',
                }

                return (
                  <div key={f.id} className="flex items-center gap-2 text-xs">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] ${roleColors[role] || ''}`}>{role}</span>
                    <span className="text-text-primary font-medium">{f.name}</span>
                    <span className="text-text-muted truncate flex-1">{f.description}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* 场景列表 */}
        {detail?.scenes && detail.scenes.length > 0 && (
          <div>
            <SectionLabel icon={<Zap className="w-3 h-3" />} label={`场景 (${detail.scenes.length})`} />
            <div className="space-y-1.5">
              {detail.scenes.map((s, idx) => (
                <div key={s.sceneId} className="flex items-start gap-2 text-xs">
                  <span className="text-text-muted w-4 text-right shrink-0 mt-0.5">{idx + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-text-primary font-medium">{s.title}</span>
                      <span className={`px-1 py-0.5 rounded text-[10px] ${PACE_COLORS[s.pace]}`}>
                        {PACE_LABELS[s.pace]}
                      </span>
                      {s.estimatedWords > 0 && (
                        <span className="text-text-muted">{s.estimatedWords}字</span>
                      )}
                    </div>
                    {s.summary && <p className="text-text-muted mt-0.5">{s.summary}</p>}
                  </div>
                </div>
              ))}
              <div className="text-xs text-text-muted text-right pt-1 border-t border-border">
                <TrendingUp className="w-3 h-3 inline mr-1" />
                估算总字数：{detail.scenes.reduce((s, sc) => s + (sc.estimatedWords || 0), 0).toLocaleString()}
              </div>
            </div>
          </div>
        )}

        {/* 空状态 */}
        {!detail && !node.summary && (
          <div className="text-center py-8 text-text-muted text-sm">
            暂无细纲信息，前往「细纲」面板生成
          </div>
        )}
      </div>
    </div>
  )
}

function SectionLabel({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-[10px] font-semibold text-text-muted uppercase tracking-wide mb-1.5">
      {icon}
      {label}
    </div>
  )
}
