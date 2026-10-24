import type {CharacterInteractionRuntimeState, FrozenInteractionRuntimeV2, FrozenRuntimeMediaAssetV2, ProductRuntimePackageV1} from '../types'

/** Author-confirmed, player-visible art only. Bindings never schedule a beat,
 * reveal a private message, or mutate runtime state. */
export interface ChatMediaBindingsV1 {
  schema: 'storyforge.chat-media'
  version: 1
  participants: Array<{participantKey: string; avatarAssetKey: string | null; portraitAssetKey: string | null}>
  scenes: Array<{sceneKey: string; location: string; backgroundAssetKey: string}>
}

function fail(message: string): never {throw new Error(`[chat-media] ${message}`)}
function row(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) fail('媒资绑定字段无效')
  return value as Record<string, unknown>
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 2_000 || value !== value.trim()) fail('媒资绑定标识无效')
  return value
}

/** Structural validation for durable author commands; assembly also validates
 * every reference against its exact frozen content and media catalog below. */
export function parseChatMediaBindingShapeV1(value: unknown): ChatMediaBindingsV1 {
  const data = row(value, ['schema', 'version', 'participants', 'scenes'])
  if (data.schema !== 'storyforge.chat-media' || data.version !== 1) fail('媒资绑定版本无效')
  if (!Array.isArray(data.participants) || data.participants.length > 256 || !Array.isArray(data.scenes) || data.scenes.length > 256) fail('媒资绑定数量无效')
  const participants = data.participants.map(value => {
    const p = row(value, ['participantKey', 'avatarAssetKey', 'portraitAssetKey'])
    const avatarAssetKey = p.avatarAssetKey === null ? null : text(p.avatarAssetKey), portraitAssetKey = p.portraitAssetKey === null ? null : text(p.portraitAssetKey)
    if (!avatarAssetKey && !portraitAssetKey) fail('角色绑定没有图片')
    return {participantKey: text(p.participantKey), avatarAssetKey, portraitAssetKey}
  })
  const scenes = data.scenes.map(value => {
    const s = row(value, ['sceneKey', 'location', 'backgroundAssetKey'])
    return {sceneKey: text(s.sceneKey), location: text(s.location), backgroundAssetKey: text(s.backgroundAssetKey)}
  })
  if (new Set(participants.map(p => p.participantKey)).size !== participants.length
    || new Set(scenes.map(s => s.sceneKey)).size !== scenes.length) fail('角色或场景图片绑定重复')
  return {schema: 'storyforge.chat-media', version: 1, participants, scenes}
}

export function parseChatMediaBindingsV1(value: unknown, content: FrozenInteractionRuntimeV2, assets: readonly FrozenRuntimeMediaAssetV2[]): ChatMediaBindingsV1 {
  const data = parseChatMediaBindingShapeV1(value)
  if (data.participants.length > content.profiles.length || data.scenes.length > content.sceneTemplates.length) fail('媒资绑定数量无效')
  const catalog = new Map(assets.map(asset => [asset.assetKey, asset])), used = new Set<string>()
  if (!assets.length || catalog.size !== assets.length) fail('图片目录为空或标识重复')
  const image = (value: unknown, kinds: string[]) => {
    const key = text(value), asset = catalog.get(key)
    if (!asset || !kinds.includes(asset.kind) || !['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'].includes(asset.mimeType)
      || !Number.isSafeInteger(asset.width) || !Number.isSafeInteger(asset.height) || asset.width! <= 0 || asset.height! <= 0
      || asset.durationMs !== null || asset.byteSize <= 0) fail('绑定图片缺失、类型或尺寸无效')
    used.add(key)
    return key
  }
  const participants = data.participants.map(p => {
    const participantKey = p.participantKey
    const profile = content.profiles.find(profile => profile.participantKey === participantKey)
    if (!profile) fail('绑定角色不在冻结版本中')
    const avatarAssetKey = p.avatarAssetKey === null ? null : image(p.avatarAssetKey, ['character-pose', 'character-expression'])
    const portraitAssetKey = p.portraitAssetKey === null ? null : image(p.portraitAssetKey, ['character-pose', 'character-expression'])
    for (const key of [avatarAssetKey, portraitAssetKey]) {
      const tag = key && catalog.get(key)!.characterTag
      if (tag && tag !== participantKey && tag !== profile.characterKey) fail('图片角色标识与绑定角色不一致')
    }
    return {participantKey, avatarAssetKey, portraitAssetKey}
  })
  const scenes = data.scenes.map(s => {
    const sceneKey = s.sceneKey, location = s.location
    const scene = content.sceneTemplates.find(scene => scene.sceneKey === sceneKey)
    if (!scene || scene.location !== location) fail('背景必须绑定冻结场景的确切地点')
    const backgroundAssetKey = image(s.backgroundAssetKey, ['background']), tag = catalog.get(backgroundAssetKey)!.sceneTag
    if (tag && tag !== sceneKey) fail('背景场景标识与绑定场景不一致')
    return {sceneKey, location, backgroundAssetKey}
  })
  if (used.size !== assets.length) fail('图片目录包含未绑定的媒资')
  return {schema: 'storyforge.chat-media', version: 1, participants, scenes}
}

/** Only committed presence/location select images. A changed location without
 * a matching frozen background clears the old art; previews are not inputs. */
export function chatMediaFrameV1(pkg: ProductRuntimePackageV1, state: CharacterInteractionRuntimeState) {
  const bindings = pkg.productType === 'character-interaction' ? pkg.interaction?.chatMedia : undefined
  const scene = state.activeScene
  return {
    backgroundAssetKey: scene && bindings?.scenes.find(s => s.sceneKey === scene.sceneKey && s.location === scene.location)?.backgroundAssetKey || null,
    participants: scene ? bindings?.participants.filter(p => scene.activeParticipantKeys.includes(p.participantKey)) ?? [] : [],
  }
}
