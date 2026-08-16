/**
 * 5轨叙事引擎 — 基于 Python 伪代码的 TypeScript 实现
 *
 * 五大叙事轨道：
 * 1. momentum      — 角色动力轨
 * 2. crisis         — 危机轨
 * 3. relationship  — 关系轨
 * 4. info           — 信息不对称轨
 * 5. environment    — 环境呼吸轨
 */

export type TrackName = 'momentum' | 'crisis' | 'relationship' | 'info' | 'environment'

export interface TrackState {
  name: TrackName
  weight: number
  cooldown: number
  metadata?: Record<string, number>
}

export interface ChapterFocus {
  mainTrack: TrackName
  subTracks: TrackName[]
  targetTension: number
  promptHint: string
}

const TRACK_DESCRIPTIONS: Record<TrackName, string> = {
  momentum: '角色动力：主角的欲望、成长、内心驱动',
  crisis: '外部危机：压迫感、障碍、挑战升级',
  relationship: '角色关系：信任、背叛、结盟等社交变化',
  info: '信息揭露：战争迷雾、秘密、真相揭露',
  environment: '环境氛围：日常、世界规则、节奏感',
}

export class NarrativeEngine {
  private tracks: Map<TrackName, TrackState>
  private progress: number

  constructor() {
    this.tracks = new Map<TrackName, TrackState>([
      ['momentum', { name: 'momentum', weight: 0.2, cooldown: 0, metadata: { desireStrength: 10, growthState: 0 } }],
      ['crisis', { name: 'crisis', weight: 0.1, cooldown: 0, metadata: { obstacleLevel: 5 } }],
      ['relationship', { name: 'relationship', weight: 0.3, cooldown: 0, metadata: { trustMatrix: 0.9 } }],
      ['info', { name: 'info', weight: 0.6, cooldown: 0, metadata: { fogOfWar: 100 } }],
      ['environment', { name: 'environment', weight: 0.8, cooldown: 0 }],
    ])
    this.progress = 0
  }

  calculateChapterFocus(chapterIndex: number, totalChapters: number): ChapterFocus {
    this.progress = totalChapters > 0 ? chapterIndex / totalChapters : 0

    const weights = this.calculateCurrentWeights()
    const sortedTracks = this.sortTracksByWeight(weights)

    const mainTrack = sortedTracks[0]
    const subTracks = sortedTracks.slice(1, 3)

    const targetTension = this.calculateTargetTension()

    const promptHint = this.buildPromptHint(mainTrack, subTracks, targetTension)

    return {
      mainTrack,
      subTracks,
      targetTension,
      promptHint,
    }
  }

  private calculateCurrentWeights(): Record<TrackName, number> {
    const t = this.progress

    const baseWeights: Record<TrackName, number> = {
      momentum: 0.2 + 0.6 * t,
      crisis: 0.1 + 0.8 * t,
      relationship: 0.3 * (1 - t) + 0.5 * t,
      info: 0.6 * (1 - t) + 0.2 * t,
      environment: 0.8 * (1 - t),
    }

    for (const [name, track] of this.tracks) {
      if (track.cooldown > 0) {
        baseWeights[name] *= 0.1
      }
    }

    return baseWeights
  }

  private sortTracksByWeight(weights: Record<TrackName, number>): TrackName[] {
    return (Object.keys(weights) as TrackName[])
      .sort((a, b) => weights[b] - weights[a])
  }

  private calculateTargetTension(): number {
    const t = this.progress
    const base = Math.sin(t * Math.PI * 5) * 3 + (t * 6) + 2
    return Math.max(1, Math.min(10, Math.round(base * 10) / 10))
  }

  private buildPromptHint(mainTrack: TrackName, subTracks: TrackName[], tension: number): string {
    const parts: string[] = []

    parts.push(`主叙事侧重：${TRACK_DESCRIPTIONS[mainTrack]}`)
    parts.push(`副叙事侧重：${subTracks.map(t => TRACK_DESCRIPTIONS[t]).join('、')}`)
    parts.push(`目标张力：${tension}/10（${tension > 7 ? '紧张' : tension > 4 ? '中等' : '舒缓'}节奏）`)

    const tensionHint = this.getTensionWritingHint(tension)
    if (tensionHint) parts.push(`写作提示：${tensionHint}`)

    return parts.join('\n')
  }

  private getTensionWritingHint(tension: number): string {
    if (tension >= 8) return '本章节应充满冲突和高潮，推动故事达到顶点'
    if (tension >= 6) return '本章节应逐步升级矛盾，增加紧张感'
    if (tension >= 4) return '本章节应保持中等节奏，推进情节发展'
    return '本章节应注重氛围营造和角色内心描写'
  }

  commitFeedback(feedback: { isMajorReveal?: boolean; characterDevelopment?: boolean; trustChanged?: boolean }): void {
    if (feedback.isMajorReveal) {
      const infoTrack = this.tracks.get('info')
      if (infoTrack) {
        infoTrack.metadata!.fogOfWar = Math.max(0, (infoTrack.metadata!.fogOfWar ?? 100) - 10)
        infoTrack.cooldown = 3
      }
      const relationshipTrack = this.tracks.get('relationship')
      if (relationshipTrack) {
        relationshipTrack.metadata!.trustMatrix = Math.max(-1, (relationshipTrack.metadata!.trustMatrix ?? 0.9) - 0.4)
        relationshipTrack.cooldown = 2
      }
    }

    if (feedback.characterDevelopment) {
      const momentumTrack = this.tracks.get('momentum')
      if (momentumTrack) {
        momentumTrack.metadata!.growthState = Math.min(100, (momentumTrack.metadata!.growthState ?? 0) + 5)
        momentumTrack.cooldown = 2
      }
    }

    for (const track of this.tracks.values()) {
      if (track.cooldown > 0) {
        track.cooldown -= 1
      }
    }
  }

  getTrackDescriptions(): Record<TrackName, string> {
    return TRACK_DESCRIPTIONS
  }
}
