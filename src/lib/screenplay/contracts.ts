import type { AdaptationProject, ScreenplayBlock, ScreenplayScene, WorkCharacterBinding } from '../types'
import { assertAdaptationProjectInvariant } from '../adaptation/contracts'

const BLOCK_TYPES = new Set<ScreenplayBlock['type']>(['action', 'character', 'parenthetical', 'dialogue', 'transition', 'shot', 'note'])
const CHARACTER_EXTENSIONS = new Set(['V.O.', 'O.S.', 'O.C.', "CONT'D"])

export interface ScreenplayValidationIssueV1 {
  level: 'error' | 'warning'
  code: string
  message: string
  blockId?: string
}

export interface ScreenplayValidationReportV1 {
  valid: boolean
  issues: ScreenplayValidationIssueV1[]
}

function issue(issues: ScreenplayValidationIssueV1[], level: 'error' | 'warning', code: string, message: string, blockId?: string) {
  issues.push({ level, code, message, ...(blockId ? { blockId } : {}) })
}

export function validateScreenplayBlocksV1(blocks: ScreenplayBlock[]): ScreenplayValidationReportV1 {
  const issues: ScreenplayValidationIssueV1[] = []
  if (!Array.isArray(blocks) || blocks.length > 1000) return { valid: false, issues: [{ level: 'error', code: 'blocks-shape', message: '场景块必须是至多 1000 项的数组。' }] }
  const ids = new Set<string>()
  let activeCharacter = false
  let priorDialogueSequence = false
  let pendingDual = false
  for (const raw of blocks) {
    const block = raw as ScreenplayBlock
    if (!block || typeof block !== 'object' || !BLOCK_TYPES.has(block.type)) {
      issue(issues, 'error', 'block-type', '存在不支持的剧本块类型。')
      continue
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(block.id)) issue(issues, 'error', 'block-id', '块 stable id 非法。', block.id)
    if (ids.has(block.id)) issue(issues, 'error', 'block-id-duplicate', '场景内块 id 重复。', block.id)
    ids.add(block.id)
    const text = block.type === 'character' ? block.name : block.text
    if (typeof text !== 'string' || !text.trim() || text.length > 20_000) issue(issues, 'error', 'block-text', '块文本必须为 1～20000 字符。', block.id)
    if (block.type === 'character') {
      if (activeCharacter) issue(issues, 'error', 'character-without-dialogue', '角色 cue 后必须先有对白，不能直接开始下一角色。', block.id)
      if (block.characterId != null && (!Number.isInteger(block.characterId) || block.characterId <= 0)) issue(issues, 'error', 'character-id', '角色引用非法。', block.id)
      if (block.extension && !CHARACTER_EXTENSIONS.has(block.extension)) issue(issues, 'error', 'character-extension', '角色扩展标记非法。', block.id)
      if (block.dualDialogue && !priorDialogueSequence) issue(issues, 'error', 'dual-dialogue-pair', '双栏对白的第二个角色 cue 前必须有一组完整对白。', block.id)
      pendingDual = block.dualDialogue === true
      activeCharacter = true
      continue
    }
    if (block.type === 'parenthetical') {
      if (!activeCharacter) issue(issues, 'error', 'parenthetical-order', '括注只能位于角色 cue 与对白之间。', block.id)
      continue
    }
    if (block.type === 'dialogue') {
      if (!activeCharacter) issue(issues, 'error', 'dialogue-order', '对白前必须有合法角色 cue。', block.id)
      priorDialogueSequence = activeCharacter
      activeCharacter = false
      pendingDual = false
      continue
    }
    if (activeCharacter) issue(issues, 'error', 'character-without-dialogue', '角色 cue 后必须先有对白，不能直接开始动作或转场。', block.id)
    if (pendingDual) issue(issues, 'error', 'dual-dialogue-missing', '双栏对白角色 cue 后必须紧跟对白。', block.id)
    activeCharacter = false
    priorDialogueSequence = false
    pendingDual = false
  }
  if (pendingDual || activeCharacter) issue(issues, 'error', 'character-without-dialogue', '场景末尾角色 cue 缺少对白。')
  const totalLength = blocks.reduce((sum, block) => sum + (block.type === 'character' ? block.name.length : block.text.length), 0)
  if (totalLength > 256_000) issue(issues, 'error', 'scene-size', '单场内容超过 256000 字符上限。')
  return { valid: !issues.some(item => item.level === 'error'), issues }
}

export function validateScreenplaySceneV1(input: {
  scene: ScreenplayScene
  adaptation: AdaptationProject
  sourceUnitIds: Set<number>
  bindings: WorkCharacterBinding[]
}): ScreenplayValidationReportV1 {
  const { scene, adaptation } = input
  const issues = [...validateScreenplayBlocksV1(scene.blocks).issues]
  try { assertAdaptationProjectInvariant(adaptation) } catch (error) { issue(issues, 'error', 'adaptation', error instanceof Error ? error.message : '改编根非法') }
  if (adaptation.medium !== 'screenplay' || scene.workId !== adaptation.workId || scene.adaptationProjectId !== adaptation.id) issue(issues, 'error', 'owner', '场景不属于该剧本改编。')
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(scene.stableKey)) issue(issues, 'error', 'stable-key', '场景 stableKey 非法。')
  if (!Number.isInteger(scene.episodeNumber) || scene.episodeNumber < 1) issue(issues, 'error', 'episode', '集号必须是正整数。')
  if (adaptation.medium === 'screenplay') {
    if (adaptation.targetSpec.format === 'film' && scene.episodeNumber !== 1) issue(issues, 'error', 'film-episode', '电影剧本场景集号固定为 1。')
    if (adaptation.targetSpec.episodeCount != null && scene.episodeNumber > adaptation.targetSpec.episodeCount) issue(issues, 'error', 'episode-range', '场景集号超过目标集数。')
  }
  if (!Number.isInteger(scene.sceneNumber) || scene.sceneNumber < 1 || !Number.isInteger(scene.order) || scene.order < 0) issue(issues, 'error', 'scene-order', '场景号或全剧顺序非法。')
  if (!['INT', 'EXT', 'INT_EXT'].includes(scene.intExt) || !scene.location.trim() || !scene.timeOfDay.trim()) issue(issues, 'error', 'heading', '场景标题必须包含内外景、地点和时间。')
  if (!Number.isFinite(scene.estimatedSeconds) || scene.estimatedSeconds <= 0 || scene.estimatedSeconds > 86_400) issue(issues, 'error', 'duration', '场景预计时长必须在 1～86400 秒。')
  if (!Number.isInteger(scene.sourceReviewManifestVersion) || scene.sourceReviewManifestVersion < 1) issue(issues, 'error', 'source-version', '来源审查版本非法。')
  if (!Array.isArray(scene.sourceUnitIds) || !scene.sourceUnitIds.length || new Set(scene.sourceUnitIds).size !== scene.sourceUnitIds.length || scene.sourceUnitIds.some(id => !input.sourceUnitIds.has(id))) issue(issues, 'error', 'source-units', '场景必须引用同一改编清单中的有效来源单元。')
  const planSection = adaptation.plan?.sections.find(section => section.stableKey === scene.planSectionKey)
  if (!planSection || adaptation.planSourceManifestVersion !== adaptation.activeSourceManifestVersion) issue(issues, 'error', 'plan-section', '场景必须引用当前已确认计划中的结构段。')
  else if (planSection.episodeNumber != null && planSection.episodeNumber !== scene.episodeNumber) issue(issues, 'error', 'plan-episode', '场景集号与计划结构段不一致。')
  const boundIds = new Set(input.bindings.filter(binding => binding.workId === scene.workId).map(binding => binding.characterId))
  for (const block of scene.blocks) {
    if (block.type === 'character' && block.characterId != null && !boundIds.has(block.characterId)) issue(issues, 'error', 'cast-binding', `角色“${block.name}”尚未绑定到目标 Work。`, block.id)
  }
  if (scene.summary.length > 20_000) issue(issues, 'error', 'summary-size', '场景摘要超过 20000 字符。')
  return { valid: !issues.some(item => item.level === 'error'), issues }
}

export function assertValidScreenplaySceneV1(input: Parameters<typeof validateScreenplaySceneV1>[0]): void {
  const report = validateScreenplaySceneV1(input)
  if (!report.valid) throw new Error(`[screenplay] ${report.issues.filter(item => item.level === 'error').map(item => item.message).join('；')}`)
}
