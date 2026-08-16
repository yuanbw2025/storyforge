/**
 * 三层协调视图
 * 可视化展示：场景细纲 ↔ 情感节拍 ↔ 5轨叙事引擎 的对应关系
 * 支持：冲突检测、自动适配、手动调整
 */
import { useState, useMemo } from 'react'
import { GitBranch, Heart, AlertTriangle, Sparkles, RefreshCw, Settings2, ChevronDown, ChevronUp, X } from 'lucide-react'
import { NarrativeEngine, type ChapterFocus } from '../../lib/outline/narrative-engine'
import { detectOutlineBeatConflicts, adaptOutlineToBeat, adaptBeatToOutline, type ConflictWarning } from '../../lib/editor/outline-beat-conflict'
import type { DetailedOutline, EmotionBeat, ScenePace } from '../../lib/types'

interface Props {
  chapterTitle: string
  chapterIndex: number
  totalChapters: number
  detailedOutline?: DetailedOutline
  emotionBeats?: EmotionBeat[]
  onApplyOutline?: (outline: DetailedOutline) => void
  onApplyBeats?: (beats: EmotionBeat[]) => void
}

const EMOTION_COLORS: Record<string, string> = {
  '紧张': 'bg-red-500/20 border-red-500/50 text-red-300',
  '温馨': 'bg-amber-500/20 border-amber-500/50 text-amber-300',
  '悲伤': 'bg-blue-500/20 border-blue-500/50 text-blue-300',
  '欢乐': 'bg-yellow-500/20 border-yellow-500/50 text-yellow-300',
  '愤怒': 'bg-orange-500/20 border-orange-500/50 text-orange-300',
  '恐惧': 'bg-purple-500/20 border-purple-500/50 text-purple-300',
  '平静': 'bg-green-500/20 border-green-500/50 text-green-300',
  '震撼': 'bg-pink-500/20 border-pink-500/50 text-pink-300',
  '期待': 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300',
  '热血': 'bg-rose-500/20 border-rose-500/50 text-rose-300',
}

const PACE_COLORS: Record<ScenePace, string> = {
  fast: 'bg-red-500/20 text-red-400',
  medium: 'bg-yellow-500/20 text-yellow-400',
  slow: 'bg-green-500/20 text-green-400',
}

const TRACK_ICONS: Record<string, string> = {
  momentum: '🎯',
  crisis: '⚡',
  relationship: '🤝',
  info: '👁️',
  environment: '🌍',
}

const TRACK_NAMES: Record<string, string> = {
  momentum: '角色动力',
  crisis: '外部危机',
  relationship: '角色关系',
  info: '信息揭露',
  environment: '环境氛围',
}

function getEmotionColor(emotion: string): string {
  for (const [key, cls] of Object.entries(EMOTION_COLORS)) {
    if (emotion.includes(key)) return cls
  }
  return 'bg-bg-elevated border-border text-text-secondary'
}

export function CoordinationView({
  chapterTitle,
  chapterIndex,
  totalChapters,
  detailedOutline,
  emotionBeats = [],
  onApplyOutline,
  onApplyBeats,
}: Props) {
  const [expanded, setExpanded] = useState(true)
  const [adaptMode, setAdaptMode] = useState<'outline' | 'beat' | null>(null)
  const [adaptSuccess, setAdaptSuccess] = useState<string | null>(null)
  
  // 计算 5轨叙事引擎状态
  const narrativeEngine = useMemo(() => new NarrativeEngine(), [])
  const focus: ChapterFocus = useMemo(() => {
    return narrativeEngine.calculateChapterFocus(chapterIndex, totalChapters)
  }, [chapterIndex, totalChapters, narrativeEngine])
  
  // 检测冲突
  const conflicts: ConflictWarning[] = useMemo(() => {
    if (!detailedOutline) return []
    return detectOutlineBeatConflicts(detailedOutline, { beats: emotionBeats })
  }, [detailedOutline, emotionBeats])
  
  // 区分可自动修复和不可修复的问题
  const fixableConflicts = conflicts.filter(c => c.type !== 'location')
  const infoOnlyConflicts = conflicts.filter(c => c.type === 'location')
  
  // 场景和节拍的对应关系
  const maxItems = Math.max(
    detailedOutline?.scenes.length || 0,
    emotionBeats.length
  )
  
  const handleAdapt = (mode: 'outline' | 'beat') => {
    if (!detailedOutline) return
    setAdaptMode(mode)
    setAdaptSuccess(null)
    
    if (mode === 'outline') {
      // 以情感节拍为主，调整细纲
      const adapted = adaptOutlineToBeat(detailedOutline, { beats: emotionBeats })
      onApplyOutline?.(adapted)
    } else {
      // 以细纲为主，调整情感节拍
      const adapted = adaptBeatToOutline({ beats: emotionBeats }, detailedOutline)
      onApplyBeats?.(adapted.beats)
    }
    
    // 显示成功消息
    const newFixableConflicts = mode === 'outline' 
      ? (adaptMode ? conflicts.filter(c => c.type !== 'location').length - 1 : 0)
      : 0  // 乐观估计
    
    setTimeout(() => {
      setAdaptMode(null)
      setAdaptSuccess(mode === 'outline' ? '✅ 已根据情感节拍调整场景细纲' : '✅ 已根据场景细纲调整情感节拍')
      setTimeout(() => setAdaptSuccess(null), 3000)
    }, 500)
  }
  
  if (!detailedOutline && emotionBeats.length === 0) {
    return null
  }
  
  return (
    <div className="border border-border rounded-lg overflow-hidden bg-bg-card">
      {/* 标题栏 */}
      <div 
        className="flex items-center justify-between px-4 py-2.5 bg-bg-surface cursor-pointer hover:bg-bg-surface/80"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <GitBranch className="w-4 h-4 text-accent" />
          <span className="text-sm font-medium text-text-primary">三层协调视图</span>
          <span className="text-xs text-text-muted">— {chapterTitle}</span>
          
          {/* 冲突警告 */}
          {conflicts.length > 0 && (
            <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-yellow-500/10 text-yellow-400">
              <AlertTriangle className="w-3 h-3" />
              <span className="text-xs">
                {fixableConflicts.length > 0 ? `${fixableConflicts.length} 个可修复问题` : ''}
                {fixableConflicts.length > 0 && infoOnlyConflicts.length > 0 ? ' + ' : ''}
                {infoOnlyConflicts.length > 0 ? `${infoOnlyConflicts.length} 个提示` : ''}
              </span>
            </div>
          )}
          
          {/* 成功消息 */}
          {adaptSuccess && (
            <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-500/10 text-green-400 animate-pulse">
              <span className="text-xs">{adaptSuccess}</span>
            </div>
          )}
        </div>
        
        <div className="flex items-center gap-2">
          {/* 自动适配按钮 */}
          {(detailedOutline && emotionBeats.length > 0 && fixableConflicts.length > 0) && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); handleAdapt('beat') }}
                disabled={adaptMode !== null}
                className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-border hover:border-accent disabled:opacity-50"
                title="以细纲为主，适配情感节拍"
              >
                <RefreshCw className={`w-3 h-3 ${adaptMode === 'beat' ? 'animate-spin' : ''}`} />
                细纲优先
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); handleAdapt('outline') }}
                disabled={adaptMode !== null}
                className="flex items-center gap-1 px-2 py-1 text-xs rounded border border-border hover:border-accent disabled:opacity-50"
                title="以情感节拍为主，适配细纲"
              >
                <Sparkles className={`w-3 h-3 ${adaptMode === 'outline' ? 'animate-spin' : ''}`} />
                节拍优先
              </button>
            </>
          )}
          
          {expanded ? 
            <ChevronDown className="w-4 h-4 text-text-muted" /> : 
            <ChevronUp className="w-4 h-4 text-text-muted" />
          }
        </div>
      </div>
      
      {/* 展开内容 */}
      {expanded && (
        <div className="p-4 space-y-4">
          {/* 5轨叙事引擎概览 */}
          <div className="bg-bg-surface rounded-lg p-3">
            <div className="flex items-center gap-2 mb-2">
              <Settings2 className="w-4 h-4 text-cyan-400" />
              <span className="text-xs font-medium text-text-primary">5轨叙事引擎</span>
            </div>
            
            <div className="grid grid-cols-2 gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-text-muted">主轨：</span>
                <span className="text-xs px-2 py-0.5 rounded bg-accent/20 text-accent">
                  {TRACK_ICONS[focus.mainTrack]} {TRACK_NAMES[focus.mainTrack]}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-text-muted">张力：</span>
                <div className="flex-1 h-2 bg-bg-elevated rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-green-500 via-yellow-500 to-red-500 transition-all"
                    style={{ width: `${(focus.targetTension / 10) * 100}%` }}
                  />
                </div>
                <span className="text-xs text-text-muted w-8 text-right">{focus.targetTension.toFixed(1)}</span>
              </div>
            </div>
            
            <div className="mt-2 flex items-center gap-1.5 flex-wrap">
              {focus.subTracks.map(track => (
                <span key={track} className="text-xs px-2 py-0.5 rounded bg-bg-elevated text-text-secondary">
                  {TRACK_ICONS[track]} {TRACK_NAMES[track]}
                </span>
              ))}
            </div>
          </div>
          
          {/* 主内容区：三列对齐 */}
          {maxItems > 0 ? (
            <div className="grid grid-cols-12 gap-3">
              {/* 第一列：场景细纲 */}
              <div className="col-span-5">
                <div className="flex items-center gap-2 mb-2">
                  <GitBranch className="w-3.5 h-3.5 text-accent" />
                  <span className="text-xs font-medium text-text-primary">场景细纲</span>
                  {detailedOutline && (
                    <span className="text-xs text-text-muted">({detailedOutline.scenes.length} 个场景)</span>
                  )}
                </div>
                
                <div className="space-y-2">
                  {(detailedOutline?.scenes || []).map((scene, idx) => (
                    <SceneItem key={idx} scene={scene} index={idx} />
                  ))}
                  {!detailedOutline && (
                    <div className="text-xs text-text-muted text-center py-4 border border-dashed border-border rounded">
                      暂无场景细纲
                    </div>
                  )}
                </div>
              </div>
              
              {/* 第二列：对应关系 */}
              <div className="col-span-2">
                <div className="h-full flex flex-col justify-center">
                  {Array.from({ length: maxItems }).map((_, idx) => (
                    <div key={idx} className="h-20 flex items-center justify-center">
                      <div className="w-0.5 h-full bg-gradient-to-b from-transparent via-accent/50 to-transparent" />
                    </div>
                  ))}
                </div>
              </div>
              
              {/* 第三列：情感节拍 */}
              <div className="col-span-5">
                <div className="flex items-center gap-2 mb-2">
                  <Heart className="w-3.5 h-3.5 text-pink-400" />
                  <span className="text-xs font-medium text-text-primary">情感节拍</span>
                  <span className="text-xs text-text-muted">({emotionBeats.length} 个节拍)</span>
                </div>
                
                <div className="space-y-2">
                  {emotionBeats.map((beat, idx) => (
                    <BeatItem key={idx} beat={beat} index={idx} />
                  ))}
                  {emotionBeats.length === 0 && (
                    <div className="text-xs text-text-muted text-center py-4 border border-dashed border-border rounded">
                      暂无情感节拍
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-6 text-text-muted">
              <GitBranch className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">暂无协调数据</p>
              <p className="text-xs">请先生成场景细纲或情感节拍</p>
            </div>
          )}
          
          {/* 冲突警告区域 */}
          {conflicts.length > 0 && (
            <div className="bg-yellow-500/5 border border-yellow-500/30 rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2 text-yellow-400">
                <AlertTriangle className="w-4 h-4" />
                <span className="text-sm font-medium">检测到 {conflicts.length} 个问题</span>
              </div>
              
              {conflicts.map((conflict, idx) => (
                <div key={idx} className="text-xs pl-6">
                  <div className="flex items-start gap-1">
                    <span className="text-yellow-400">•</span>
                    <div>
                      <span className={conflict.type === 'location' ? 'text-text-muted' : 'text-text-secondary'}>
                        {conflict.message}
                      </span>
                      {conflict.detail && (
                        <span className="text-text-muted"> — {conflict.detail}</span>
                      )}
                      {/* 标记是否可自动修复 */}
                      {conflict.type !== 'location' && (
                        <span className="ml-1 text-green-400 text-[10px]">(可自动修复)</span>
                      )}
                      {conflict.type === 'location' && (
                        <span className="ml-1 text-text-muted text-[10px]">(提示信息)</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
              
              <div className="pt-2 border-t border-yellow-500/20">
                <p className="text-xs text-text-muted">
                  💡 {conflicts.some(c => c.type !== 'location') 
                    ? '点击上方的"细纲优先"或"节拍优先"按钮可自动修复数量和节奏问题。地点警告仅作提示，AI 会智能处理。'
                    : '地点警告仅作提示，AI 生成正文时会智能处理地点关联，无需手动修复。'}
                </p>
              </div>
            </div>
          )}
          
          {/* 底部提示 */}
          <div className="text-xs text-text-muted bg-bg-surface rounded p-2">
            <span className="font-medium text-text-secondary">💡 三层说明：</span>
            场景细纲层决定"发生什么"，情感节拍层决定"怎么感受"，5轨引擎决定"叙事侧重"。
            AI 会综合三层生成既符合结构又有节奏的正文。
          </div>
        </div>
      )}
    </div>
  )
}

// 场景项组件
function SceneItem({ scene, index }: { scene: any; index: number }) {
  const paceColor = PACE_COLORS[scene.pace as ScenePace] || PACE_COLORS.medium
  
  return (
    <div className="border border-border rounded p-2 bg-bg-card hover:border-accent/50 transition-colors">
      <div className="flex items-start gap-2">
        <span className="text-xs font-mono text-text-muted mt-0.5">{index + 1}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-xs font-medium text-text-primary truncate">{scene.title}</span>
            {scene.pace && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${paceColor}`}>
                {scene.pace === 'fast' ? '快' : scene.pace === 'slow' ? '慢' : '中'}
              </span>
            )}
          </div>
          {scene.summary && (
            <p className="text-[11px] text-text-muted line-clamp-2">{scene.summary}</p>
          )}
          {scene.conflict && (
            <div className="mt-1 text-[10px] text-red-400/80">
              冲突: {scene.conflict}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// 节拍项组件
function BeatItem({ beat, index }: { beat: EmotionBeat; index: number }) {
  const emotionColor = getEmotionColor(beat.emotionTone)
  
  return (
    <div className="border border-border rounded p-2 bg-bg-card hover:border-accent/50 transition-colors">
      <div className="flex items-start gap-2">
        <span className="text-xs font-mono text-text-muted mt-0.5">{index + 1}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-xs font-medium text-text-primary truncate">{beat.label}</span>
            {beat.emotionTone && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded border ${emotionColor}`}>
                {beat.emotionTone}
              </span>
            )}
          </div>
          {beat.sceneGoal && (
            <p className="text-[11px] text-text-muted line-clamp-2">{beat.sceneGoal}</p>
          )}
          {beat.readerFeeling && (
            <div className="mt-1 text-[10px] text-pink-400/80">
              读者感受: {beat.readerFeeling}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default CoordinationView
