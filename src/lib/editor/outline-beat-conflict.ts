import type { DetailedOutline, EmotionBeatCard, ScenePace } from '../types'

export interface ConflictWarning {
  type: 'emotion' | 'structure' | 'location'
  severity: 'warning' | 'conflict'
  message: string
  detail?: string
}

const EMOTION_CONFLICT_MAP: Record<string, string[]> = {
  '紧张': ['平静', '温馨', '轻松'],
  '悲伤': ['欢乐', '轻松', '热血'],
  '愤怒': ['平静', '温馨', '悲伤'],
  '恐惧': ['平静', '欢乐', '热血'],
  '欢乐': ['悲伤', '恐惧', '愤怒'],
  '平静': ['紧张', '愤怒', '恐惧'],
  '温馨': ['悲伤', '愤怒', '恐惧'],
  '震撼': ['平静', '温馨'],
  '期待': ['悲伤', '恐惧'],
  '热血': ['悲伤', '恐惧', '平静'],
}

function detectEmotionConflict(
  detailed: DetailedOutline | undefined,
  beatCard: EmotionBeatCard | undefined,
): ConflictWarning[] {
  const warnings: ConflictWarning[] = []
  if (!detailed || !beatCard) return warnings

  const scenesText = detailed.scenes.map(s => s.summary + ' ' + s.conflict).join(' ')
  const beatsText = beatCard.beats.map(b => b.emotionTone + ' ' + b.readerFeeling).join(' ')

  for (const [emotion, conflicts] of Object.entries(EMOTION_CONFLICT_MAP)) {
    const hasEmotion = beatsText.includes(emotion)
    const hasConflict = conflicts.some(c => scenesText.includes(c))
    if (hasEmotion && hasConflict) {
      warnings.push({
        type: 'emotion',
        severity: 'conflict',
        message: `情感基调冲突：细纲中提到"${conflicts.find(c => scenesText.includes(c))}"，但情感节拍设定为"${emotion}"`,
      })
    }
  }

  const sceneCount = detailed.scenes.length
  const beatCount = beatCard.beats.length
  if (sceneCount > 0 && beatCount > 0 && Math.abs(sceneCount - beatCount) >= 2) {
    warnings.push({
      type: 'structure',
      severity: 'warning',
      message: `结构不匹配：细纲有 ${sceneCount} 个场景，情感节拍有 ${beatCount} 个节拍`,
      detail: '建议调整为相近数量，便于一一对应',
    })
  }

  const sceneLocations = new Set(detailed.scenes.filter(s => s.location).map(s => s.location))
  const beatLocations = new Set(beatCard.beats.filter(b => b.sceneGoal?.includes('地点') || b.sceneGoal?.includes('在')).map(b => b.sceneGoal))

  if (sceneLocations.size > 0 && beatLocations.size > 0) {
    const allLocations = [...sceneLocations]
    const beatsMentionOtherLoc = beatCard.beats.some(b =>
      b.sceneGoal && !allLocations.some(loc => b.sceneGoal?.includes(loc))
    )
    if (beatsMentionOtherLoc) {
      warnings.push({
        type: 'location',
        severity: 'warning',
        message: '地点信息不一致：情感节拍中提到的地点与细纲场景地点可能不匹配',
      })
    }
  }

  return warnings
}

export function detectOutlineBeatConflicts(
  detailed: DetailedOutline | undefined,
  beatCard: EmotionBeatCard | undefined,
): ConflictWarning[] {
  if (!detailed || !beatCard) return []
  if (detailed.scenes.length === 0 || beatCard.beats.length === 0) return []

  return detectEmotionConflict(detailed, beatCard)
}

export function adaptOutlineToBeat(
  detailed: DetailedOutline,
  beatCard: EmotionBeatCard,
): DetailedOutline {
  const newScenes = [...detailed.scenes]
  const beatCount = beatCard.beats.length
  const sceneCount = newScenes.length

  if (beatCount > sceneCount) {
    for (let i = sceneCount; i < beatCount; i++) {
      const beat = beatCard.beats[i]
      newScenes.push({
        sceneId: `scene-${Date.now()}-${i}`,
        title: beat.sceneGoal || `场景${i + 1}`,
        summary: beat.sceneGoal || '根据情感节拍生成的场景',
        location: '',
        conflict: '',
        pace: beat.emotionTone.includes('紧张') || beat.emotionTone.includes('热血') ? 'fast' as ScenePace : 'medium',
        characterIds: [],
        estimatedWords: 1500,
        notes: '',
      })
    }
  } else if (beatCount < sceneCount) {
    newScenes.splice(beatCount)
  }

  newScenes.forEach((scene, idx) => {
    if (idx < beatCard.beats.length) {
      const beat = beatCard.beats[idx]
      if (beat.emotionTone) {
        if (beat.emotionTone.includes('紧张') || beat.emotionTone.includes('热血')) {
          scene.pace = 'fast' as ScenePace
        } else if (beat.emotionTone.includes('悲伤') || beat.emotionTone.includes('平静')) {
          scene.pace = 'slow' as ScenePace
        } else {
          scene.pace = 'medium' as ScenePace
        }
      }
    }
  })

  return { ...detailed, scenes: newScenes }
}

export function adaptBeatToOutline(
  beatCard: EmotionBeatCard,
  detailed: DetailedOutline,
): EmotionBeatCard {
  const newBeats = [...beatCard.beats]
  const sceneCount = detailed.scenes.length
  const beatCount = newBeats.length

  if (sceneCount > beatCount) {
    for (let i = beatCount; i < sceneCount; i++) {
      const scene = detailed.scenes[i]
      let emotionTone = '平静'
      let readerFeeling = '中性'

      if (scene.pace === 'fast') {
        emotionTone = '紧张'
        readerFeeling = '紧张'
      } else if (scene.pace === 'slow') {
        emotionTone = '平静'
        readerFeeling = '平和'
      } else {
        emotionTone = '期待'
        readerFeeling = '期待'
      }

      newBeats.push({
        label: `节拍${i + 1}`,
        sceneGoal: scene.title || '场景目标',
        emotionTone,
        readerFeeling,
        characterGrowth: '',
      })
    }
  } else if (sceneCount < beatCount) {
    newBeats.splice(sceneCount)
  }

  newBeats.forEach((beat, idx) => {
    if (idx < detailed.scenes.length) {
      const scene = detailed.scenes[idx]
      beat.label = `节拍${idx + 1}`
      beat.sceneGoal = scene.title || beat.sceneGoal

      if (scene.pace === 'fast') {
        beat.emotionTone = beat.emotionTone.includes('紧张') || beat.emotionTone.includes('热血') ? beat.emotionTone : '紧张'
        beat.readerFeeling = '紧张'
      } else if (scene.pace === 'slow') {
        beat.emotionTone = beat.emotionTone.includes('平静') || beat.emotionTone.includes('悲伤') ? beat.emotionTone : '平静'
        beat.readerFeeling = '平和'
      }
    }
  })

  return { ...beatCard, beats: newBeats }
}