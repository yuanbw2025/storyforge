import {canonicalProductProductionJsonV2} from '../product-production/hash'
import type {FrozenInteractionRuntimeV2, ProductProductionMediaProfileV1} from '../types'
import type {ChatAuthoringSettings} from './authoring-contract'

/** Author-written picture descriptions. These are presentation inputs, not
 * character knowledge, world facts or permission to generate/publish media. */
export interface ChatVisualIntentV1 {
  version: 1
  characters: Array<{characterKey: string; description: string}>
  openingBackground: string
}

function fail(message: string): never {throw new Error(`[chat-visual-intent] ${message}`)}
function exact(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) fail('画面描述字段无效')
  return value as Record<string, unknown>
}
export function parseChatVisualIntentV1(value: unknown): ChatVisualIntentV1 {
  const row = exact(value, ['version', 'characters', 'openingBackground'])
  if (row.version !== 1 || !Array.isArray(row.characters) || row.characters.length > 8
    || typeof row.openingBackground !== 'string' || row.openingBackground.length > 4000) fail('画面描述版本或数量无效')
  const characters = row.characters.map(value => {
    const item = exact(value, ['characterKey', 'description'])
    if (typeof item.characterKey !== 'string' || !item.characterKey.trim() || item.characterKey !== item.characterKey.trim()
      || item.characterKey.length > 500 || typeof item.description !== 'string' || !item.description.trim()
      || item.description.length > 4000) fail('人物画面描述无效')
    return {characterKey: item.characterKey, description: item.description}
  })
  if (new Set(characters.map(item => item.characterKey)).size !== characters.length) fail('人物画面描述重复')
  return {version: 1, characters, openingBackground: row.openingBackground}
}

/** Validate against the selected opening only. Never infer visuals from
 * private profiles, beliefs, goals, unselected openings or future events. */
export function compileChatVisualIntentV1(value: unknown, content: FrozenInteractionRuntimeV2) {
  const intent = parseChatVisualIntentV1(value)
  const initial = content.chatNarrative?.initialSituation
  if (!initial || !content.sceneTemplates.some(scene => scene.sceneKey === initial.sceneKey && scene.location === initial.location)) fail('画面需要作者已选定的初始情境')
  const characters = intent.characters.map(item => {
    const matches = content.profiles.filter(profile => profile.characterKey === item.characterKey)
    if (matches.length !== 1) fail('画面人物不属于当前聊天，请重新选择或移除旧描述')
    return {characterKey: item.characterKey, participantKey: matches[0].participantKey, description: item.description}
  })
  // Array order is the author's order; stable IDs, not names, bind pictures.
  return {
    characters,
    openingBackground: intent.openingBackground.trim() ? {
      sceneKey: initial.sceneKey, location: initial.location, description: intent.openingBackground,
    } : null,
  }
}

/** Deterministic input to the existing media transport. The provider sees
 * only descriptions explicitly written for pictures and technical rules. */
export function createChatVisualRequirementsV1(value: unknown, content: FrozenInteractionRuntimeV2, openingBeatKey: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(openingBeatKey)) fail('画面缺少选定开场的导航标识')
  compileChatVisualIntentV1(value, content)
  return visualRequirementsForScene(parseChatVisualIntentV1(value), content.chatNarrative!.initialSituation.sceneKey, openingBeatKey)
}

function visualRequirementsForScene(intent: ChatVisualIntentV1, sceneKey: string, openingBeatKey: string) {
  const visual: Array<{
    artifactKey: string; mediaKind: 'character-pose' | 'background'; sceneTag: string; beatKey: string
    prompt: string; altText: string; width: number; height: number; palette: [string, string, string]
    characterAnchorRefs: string[]; hardConstraints: string[]
  }> = intent.characters.map((character, index) => ({
    artifactKey: `media.visual.${String(index + 1).padStart(3, '0')}`, mediaKind: 'character-pose',
    sceneTag: sceneKey, beatKey: openingBeatKey,
    prompt: character.description, altText: '作者指定外观的角色立绘', width: 768, height: 1024,
    palette: ['#112233', '#445566', '#ddeeff'], characterAnchorRefs: [character.characterKey],
    hardConstraints: [...CHAT_PUBLIC_VISUAL_CONSTRAINTS_V1],
  }))
  if (intent.openingBackground.trim()) visual.push({
    artifactKey: `media.visual.${String(visual.length + 1).padStart(3, '0')}`, mediaKind: 'background',
    sceneTag: sceneKey, beatKey: openingBeatKey,
    prompt: intent.openingBackground, altText: '作者指定的开场背景', width: 1536, height: 1024,
    palette: ['#112233', '#445566', '#ddeeff'], characterAnchorRefs: [], hardConstraints: [],
  })
  return {schema: 'storyforge.product-media-requirements-artifact' as const, version: 2 as const, visual, audio: []}
}

export const CHAT_PUBLIC_VISUAL_CONSTRAINTS_V1 = [
  '只按作者明确填写的公开外观绘制，不添加人物经历、秘密或剧情事件',
  '单人立绘，完整保留人物头部与轮廓，不添加文字、边框或背景',
].sort()

/** Only an explicit illustrated Brief enables production. A saved picture
 * draft alone does not authorize calls or turn historical text plans on. */
export function chatVisualMediaProfileV1(settings: ChatAuthoringSettings | undefined, visualLevel: ProductProductionMediaProfileV1['visualLevel']) {
  if (visualLevel === 'none') return {imageCount: 0, requiredMediaKinds: [] as ProductProductionMediaProfileV1['requiredMediaKinds']}
  if (visualLevel !== 'key-scenes' || settings?.version !== 3 || !settings.visuals) fail('图片制作需要主动叙事方案和明确的公开画面描述')
  const intent = parseChatVisualIntentV1(settings.visuals)
  const selected = new Set([...settings.characters.map(character => character.sourceKey), ...(settings.privateCharacters ?? []).map(character => character.characterKey)])
  if (intent.characters.some(character => !selected.has(character.characterKey))) fail('画面人物不属于当前选择，请重新选择或移除旧描述')
  const requiredMediaKinds: ProductProductionMediaProfileV1['requiredMediaKinds'] = []
  if (intent.characters.length) requiredMediaKinds.push('character-pose')
  if (intent.openingBackground.trim()) requiredMediaKinds.push('background')
  const imageCount = intent.characters.length + Number(!!intent.openingBackground.trim())
  if (!imageCount) fail('请先填写至少一项公开画面描述')
  return {imageCount, requiredMediaKinds}
}

/** Recheck the exact public payload immediately before the media transport.
 * Scene/beat IDs are subsequently checked against the selected opening. */
export function assertChatVisualRequirementsV1(value: unknown, intent: ChatVisualIntentV1) {
  const row = value as {visual?: Array<{sceneTag?: unknown; beatKey?: unknown}>}
  const first = row?.visual?.[0]
  if (typeof first?.sceneTag !== 'string' || typeof first.beatKey !== 'string') fail('图片需求缺少开场标识')
  const expected = visualRequirementsForScene(parseChatVisualIntentV1(intent), first.sceneTag, first.beatKey)
  if (canonicalProductProductionJsonV2(value) !== canonicalProductProductionJsonV2(expected)) fail('图片请求与作者公开画面描述不一致')
}
