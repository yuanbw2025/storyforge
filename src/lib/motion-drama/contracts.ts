import type {
  MotionDramaAssetSubjectCandidateV1,
  MotionDramaEpisodeCandidateV1,
  MotionDramaImagePromptCandidateV1,
  MotionDramaReviewIssueCandidateV1,
  MotionDramaScriptSceneCandidateV1,
  MotionDramaSeriesBibleV1,
  MotionDramaShotCandidateV1,
  MotionDramaSoundCueV1,
  MotionDramaVideoPromptCandidateV1,
} from '../types'

const STABLE_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/

function record(value: unknown, label: string): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`[motion-drama] ${label} 必须是对象`)
  return value as Record<string, any>
}

function exact(value: unknown, keys: readonly string[], label: string): Record<string, any> {
  const row = record(value, label)
  const actual = Object.keys(row)
  const unknown = actual.filter(key => !keys.includes(key))
  const missing = keys.filter(key => !actual.includes(key))
  if (unknown.length || missing.length) throw new Error(`[motion-drama] ${label} 字段不在闭集（未知：${unknown.join('、') || '无'}；缺少：${missing.join('、') || '无'}）`)
  return row
}

function text(value: unknown, label: string, max = 12_000, allowEmpty = false): asserts value is string {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim())) throw new Error(`[motion-drama] ${label} 必须是${allowEmpty ? '' : '非空'}文本且不超过 ${max} 字符`)
}

function key(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !STABLE_KEY.test(value)) throw new Error(`[motion-drama] ${label} 必须是稳定 key`)
}

function integer(value: unknown, label: string, min: number, max: number): asserts value is number {
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) throw new Error(`[motion-drama] ${label} 必须是 ${min}～${max} 的整数`)
}

function texts(value: unknown, label: string, options: { allowEmpty?: boolean; stable?: boolean; max?: number } = {}): asserts value is string[] {
  if (!Array.isArray(value) || (!options.allowEmpty && !value.length) || value.length > (options.max ?? 300)) throw new Error(`[motion-drama] ${label} 必须是${options.allowEmpty ? '可空' : '非空'}数组`)
  value.forEach((item, index) => options.stable ? key(item, `${label}[${index}]`) : text(item, `${label}[${index}]`, 4_000))
  if (new Set(value).size !== value.length) throw new Error(`[motion-drama] ${label} 不得重复`)
}

function batch<T>(value: unknown, label: string, validate: (item: unknown, index: number) => asserts item is T, max = 2_000, allowEmpty = false): asserts value is T[] {
  if (!Array.isArray(value) || (!allowEmpty && !value.length) || value.length > max) throw new Error(`[motion-drama] ${label} 必须包含 ${allowEmpty ? '0' : '1'}～${max} 项`)
  value.forEach(validate)
  const stableKeys = value.flatMap(item => typeof item === 'object' && item && 'stableKey' in item ? [String((item as any).stableKey)] : [])
  if (new Set(stableKeys).size !== stableKeys.length) throw new Error(`[motion-drama] ${label} stableKey 重复`)
}

const SERIES_KEYS = ['version', 'titlePromise', 'logline', 'coreTheme', 'emotionalPromise', 'audiencePromise', 'storyEngine', 'worldRules', 'seasonArc', 'protagonistArc', 'relationshipArcs', 'episodeArchitecture', 'hookPatterns', 'visualLanguage', 'soundLanguage', 'continuityRules', 'productionConstraints'] as const

export function assertMotionDramaSeriesBibleV1(value: unknown): asserts value is MotionDramaSeriesBibleV1 {
  const row = exact(value, SERIES_KEYS, 'SeriesBible')
  if (row.version !== 1) throw new Error('[motion-drama] SeriesBible.version 必须为 1')
  for (const field of ['titlePromise', 'logline', 'coreTheme', 'emotionalPromise', 'audiencePromise', 'storyEngine', 'seasonArc', 'protagonistArc', 'episodeArchitecture'] as const) text(row[field], `SeriesBible.${field}`)
  for (const field of ['worldRules', 'relationshipArcs', 'hookPatterns', 'visualLanguage', 'soundLanguage', 'continuityRules', 'productionConstraints'] as const) texts(row[field], `SeriesBible.${field}`, { allowEmpty: field === 'relationshipArcs' || field === 'productionConstraints' })
}

const BEAT_KEYS = ['stableKey', 'order', 'function', 'visibleAction', 'conflict', 'turn', 'targetSeconds', 'sourceUnitKeys'] as const
const BEAT_FUNCTIONS = ['hook', 'setup', 'pressure', 'reveal', 'reversal', 'climax', 'cliffhanger', 'resolution']

function assertEpisodeBeat(value: unknown, index: number): void {
  const row = exact(value, BEAT_KEYS, `Episode.beats[${index}]`)
  key(row.stableKey, `Episode.beats[${index}].stableKey`)
  integer(row.order, `Episode.beats[${index}].order`, 0, 200)
  if (!BEAT_FUNCTIONS.includes(row.function)) throw new Error('[motion-drama] beat.function 非法')
  text(row.visibleAction, 'beat.visibleAction')
  text(row.conflict, 'beat.conflict')
  text(row.turn, 'beat.turn')
  integer(row.targetSeconds, 'beat.targetSeconds', 1, 600)
  texts(row.sourceUnitKeys, 'beat.sourceUnitKeys', { stable: true })
}

const EPISODE_KEYS = ['stableKey', 'episodeNumber', 'title', 'logline', 'synopsis', 'openingHook', 'beats', 'endHook', 'continuityIn', 'continuityOut', 'sourceUnitKeys'] as const

export function assertMotionDramaEpisodeCandidateV1(value: unknown): asserts value is MotionDramaEpisodeCandidateV1 {
  const row = exact(value, EPISODE_KEYS, 'Episode')
  key(row.stableKey, 'Episode.stableKey')
  integer(row.episodeNumber, 'Episode.episodeNumber', 1, 200)
  for (const field of ['title', 'logline', 'synopsis', 'openingHook', 'endHook'] as const) text(row[field], `Episode.${field}`)
  batch(row.beats, 'Episode.beats', assertEpisodeBeat, 30)
  row.beats.forEach((beat: any, index: number) => { if (beat.order !== index) throw new Error('[motion-drama] Episode.beats.order 必须从 0 连续') })
  texts(row.continuityIn, 'Episode.continuityIn', { allowEmpty: true })
  texts(row.continuityOut, 'Episode.continuityOut', { allowEmpty: true })
  texts(row.sourceUnitKeys, 'Episode.sourceUnitKeys', { stable: true })
}

function assertSoundCue(value: unknown, label: string): asserts value is MotionDramaSoundCueV1 {
  const row = exact(value, ['kind', 'cue', 'timing', 'subjectKey'], label)
  if (!['voice', 'ambience', 'sfx', 'music'].includes(row.kind)) throw new Error(`[motion-drama] ${label}.kind 非法`)
  text(row.cue, `${label}.cue`)
  text(row.timing, `${label}.timing`)
  if (row.subjectKey !== null) key(row.subjectKey, `${label}.subjectKey`)
}

function assertDialogue(value: unknown, label: string): void {
  const row = exact(value, ['speakerKey', 'text', 'delivery', 'estimatedSeconds'], label)
  key(row.speakerKey, `${label}.speakerKey`)
  text(row.text, `${label}.text`)
  text(row.delivery, `${label}.delivery`, 2_000, true)
  integer(row.estimatedSeconds, `${label}.estimatedSeconds`, 1, 120)
}

const SCENE_KEYS = ['stableKey', 'episodeNumber', 'sceneNumber', 'order', 'heading', 'location', 'timeOfDay', 'dramaticPurpose', 'entryState', 'exitState', 'visibleAction', 'dialogue', 'narration', 'soundCues', 'emotionalTurn', 'estimatedSeconds', 'characterKeys', 'sourceUnitKeys'] as const

export function assertMotionDramaScriptSceneCandidateV1(value: unknown): asserts value is MotionDramaScriptSceneCandidateV1 {
  const row = exact(value, SCENE_KEYS, 'ScriptScene')
  key(row.stableKey, 'ScriptScene.stableKey')
  integer(row.episodeNumber, 'ScriptScene.episodeNumber', 1, 200)
  integer(row.sceneNumber, 'ScriptScene.sceneNumber', 1, 200)
  integer(row.order, 'ScriptScene.order', 0, 200)
  for (const field of ['heading', 'location', 'timeOfDay', 'dramaticPurpose', 'entryState', 'exitState', 'visibleAction', 'emotionalTurn'] as const) text(row[field], `ScriptScene.${field}`)
  text(row.narration, 'ScriptScene.narration', 12_000, true)
  batch(row.dialogue, 'ScriptScene.dialogue', (item, index) => assertDialogue(item, `dialogue[${index}]`), 100, true)
  batch(row.soundCues, 'ScriptScene.soundCues', (item, index) => assertSoundCue(item, `soundCues[${index}]`), 100, true)
  integer(row.estimatedSeconds, 'ScriptScene.estimatedSeconds', 1, 600)
  texts(row.characterKeys, 'ScriptScene.characterKeys', { stable: true, allowEmpty: true })
  texts(row.sourceUnitKeys, 'ScriptScene.sourceUnitKeys', { stable: true })
}

const ASSET_KEYS = ['stableKey', 'kind', 'label', 'identity', 'appearance', 'palette', 'materials', 'continuityLocks', 'prohibitedChanges', 'basePrompt', 'negativePrompt', 'referenceBrief', 'sourceUnitKeys'] as const

export function assertMotionDramaAssetSubjectCandidateV1(value: unknown): asserts value is MotionDramaAssetSubjectCandidateV1 {
  const row = exact(value, ASSET_KEYS, 'AssetSubject')
  key(row.stableKey, 'AssetSubject.stableKey')
  if (!['character', 'costume', 'location', 'prop', 'style', 'voice', 'sound'].includes(row.kind)) throw new Error('[motion-drama] AssetSubject.kind 非法')
  for (const field of ['label', 'identity', 'appearance', 'basePrompt', 'negativePrompt', 'referenceBrief'] as const) text(row[field], `AssetSubject.${field}`, 12_000, field === 'appearance' || field === 'negativePrompt')
  texts(row.palette, 'AssetSubject.palette', { allowEmpty: true })
  texts(row.materials, 'AssetSubject.materials', { allowEmpty: true })
  texts(row.continuityLocks, 'AssetSubject.continuityLocks')
  texts(row.prohibitedChanges, 'AssetSubject.prohibitedChanges', { allowEmpty: true })
  texts(row.sourceUnitKeys, 'AssetSubject.sourceUnitKeys', { stable: true })
}

const SHOT_KEYS = ['stableKey', 'episodeNumber', 'sceneKey', 'shotNumber', 'order', 'narrativeFunction', 'targetSeconds', 'shotSize', 'cameraAngle', 'cameraMovement', 'composition', 'visibleAction', 'performance', 'lighting', 'transitionIn', 'transitionOut', 'dialogue', 'narration', 'soundPlan', 'subjectKeys', 'sourceUnitKeys', 'imagePrompt', 'negativeImagePrompt', 'firstFramePrompt', 'keyFramePrompt', 'lastFramePrompt', 'videoPrompt', 'negativeVideoPrompt'] as const

export function assertMotionDramaShotCandidateV1(value: unknown): asserts value is MotionDramaShotCandidateV1 {
  const row = exact(value, SHOT_KEYS, 'Shot')
  key(row.stableKey, 'Shot.stableKey'); key(row.sceneKey, 'Shot.sceneKey')
  integer(row.episodeNumber, 'Shot.episodeNumber', 1, 200); integer(row.shotNumber, 'Shot.shotNumber', 1, 500); integer(row.order, 'Shot.order', 0, 2_000); integer(row.targetSeconds, 'Shot.targetSeconds', 1, 30)
  if (!['extreme-wide', 'wide', 'full', 'medium', 'close-up', 'extreme-close-up', 'insert'].includes(row.shotSize)) throw new Error('[motion-drama] Shot.shotSize 非法')
  if (!['eye-level', 'high', 'low', 'overhead', 'dutch', 'pov'].includes(row.cameraAngle)) throw new Error('[motion-drama] Shot.cameraAngle 非法')
  if (!['static', 'pan', 'tilt', 'track', 'dolly', 'orbit', 'zoom', 'handheld'].includes(row.cameraMovement)) throw new Error('[motion-drama] Shot.cameraMovement 非法')
  for (const field of ['narrativeFunction', 'composition', 'visibleAction', 'performance', 'lighting'] as const) text(row[field], `Shot.${field}`)
  for (const field of ['transitionIn', 'transitionOut', 'dialogue', 'narration', 'imagePrompt', 'negativeImagePrompt', 'firstFramePrompt', 'keyFramePrompt', 'lastFramePrompt', 'videoPrompt', 'negativeVideoPrompt'] as const) text(row[field], `Shot.${field}`, 16_000, true)
  batch(row.soundPlan, 'Shot.soundPlan', (item, index) => assertSoundCue(item, `soundPlan[${index}]`), 100, true)
  texts(row.subjectKeys, 'Shot.subjectKeys', { stable: true, allowEmpty: true })
  texts(row.sourceUnitKeys, 'Shot.sourceUnitKeys', { stable: true })
}

export function assertMotionDramaImagePromptCandidateV1(value: unknown): asserts value is MotionDramaImagePromptCandidateV1 {
  const row = exact(value, ['shotKey', 'expectedRevision', 'imagePrompt', 'negativeImagePrompt', 'firstFramePrompt', 'keyFramePrompt', 'lastFramePrompt'], 'ImagePromptIR')
  key(row.shotKey, 'ImagePromptIR.shotKey'); integer(row.expectedRevision, 'ImagePromptIR.expectedRevision', 1, 1_000_000)
  for (const field of ['imagePrompt', 'negativeImagePrompt', 'firstFramePrompt', 'keyFramePrompt', 'lastFramePrompt'] as const) text(row[field], `ImagePromptIR.${field}`, 16_000)
}

export function assertMotionDramaVideoPromptCandidateV1(value: unknown): asserts value is MotionDramaVideoPromptCandidateV1 {
  const row = exact(value, ['shotKey', 'expectedRevision', 'videoPrompt', 'negativeVideoPrompt'], 'VideoPromptIR')
  key(row.shotKey, 'VideoPromptIR.shotKey'); integer(row.expectedRevision, 'VideoPromptIR.expectedRevision', 1, 1_000_000)
  text(row.videoPrompt, 'VideoPromptIR.videoPrompt', 16_000); text(row.negativeVideoPrompt, 'VideoPromptIR.negativeVideoPrompt', 16_000)
}

export function assertMotionDramaReviewIssueCandidateV1(value: unknown): asserts value is MotionDramaReviewIssueCandidateV1 {
  const row = exact(value, ['stableKey', 'episodeNumber', 'sceneKey', 'shotKey', 'subjectKey', 'category', 'severity', 'evidence', 'problem', 'suggestion'], 'ReviewIssue')
  key(row.stableKey, 'ReviewIssue.stableKey'); integer(row.episodeNumber, 'ReviewIssue.episodeNumber', 1, 200)
  for (const field of ['sceneKey', 'shotKey', 'subjectKey'] as const) if (row[field] !== null) key(row[field], `ReviewIssue.${field}`)
  if (!['story', 'continuity', 'visual', 'motion', 'prompt', 'sound', 'rights', 'provider-capability'].includes(row.category)) throw new Error('[motion-drama] ReviewIssue.category 非法')
  if (!['critical', 'major', 'minor'].includes(row.severity)) throw new Error('[motion-drama] ReviewIssue.severity 非法')
  for (const field of ['evidence', 'problem', 'suggestion'] as const) text(row[field], `ReviewIssue.${field}`)
}

export function parseMotionDramaCandidatePayloadV1(stage: import('../types').MotionDramaPromptStageV1, value: unknown): unknown {
  if (stage === 'series-bible') { assertMotionDramaSeriesBibleV1(value); return structuredClone(value) }
  if (stage === 'asset-bible') { batch(value, 'AssetSubject[]', assertMotionDramaAssetSubjectCandidateV1, 300); return structuredClone(value) }
  if (stage === 'episode-outline') { assertMotionDramaEpisodeCandidateV1(value); return structuredClone(value) }
  if (stage === 'episode-script') { batch(value, 'ScriptScene[]', assertMotionDramaScriptSceneCandidateV1, 200); return structuredClone(value) }
  if (stage === 'shot-design') { batch(value, 'Shot[]', assertMotionDramaShotCandidateV1, 2_000); return structuredClone(value) }
  if (stage === 'image-prompts') { batch(value, 'ImagePromptIR[]', assertMotionDramaImagePromptCandidateV1, 2_000); return structuredClone(value) }
  if (stage === 'video-prompts') { batch(value, 'VideoPromptIR[]', assertMotionDramaVideoPromptCandidateV1, 2_000); return structuredClone(value) }
  batch(value, 'ReviewIssue[]', assertMotionDramaReviewIssueCandidateV1, 2_000, true); return structuredClone(value)
}

