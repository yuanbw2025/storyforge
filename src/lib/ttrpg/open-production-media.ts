import type { FrozenRuntimeMediaAssetV2, ProductProductionBriefV3 } from '../types'
import type { RulePackV2, TtrpgCampaignContentV2 } from './open-contract'
import { parseTtrpgOpenRuleSystemArtifactV1, TTRPG_OPEN_LAYER_METADATA_KEYS_V1 } from './open-production-artifacts'
import { parseTtrpgMediaManifestV1, parseTtrpgVisualBibleV1 } from './media-contract'
import * as p from './open-contract-parse'

export function ttrpgOpenProductionMediaContextV1(input: { ruleSystem: unknown; situationLayer: unknown; rulePack: RulePackV2 }) {
  const system = parseTtrpgOpenRuleSystemArtifactV1(input.ruleSystem, input.rulePack)
  const layer = p.record(p.json(input.situationLayer), ['schema', 'version', 'authoring', 'metadata'], 'open media layer')
  p.literal(layer.schema, 'storyforge.ttrpg-open-situation-layer', 'media layer schema'); p.literal(layer.version, 1, 'media layer version')
  const metadata = p.record(layer.metadata, TTRPG_OPEN_LAYER_METADATA_KEYS_V1, 'open media metadata')
  const visualBible = parseTtrpgVisualBibleV1(metadata.visualBible, {
    characterKeys: new Set(system.characterTemplates.map(template => template.characterKey)),
    locationKeys: new Set(system.entityBindings.filter(binding => binding.kind === 'location').map(binding => binding.bindingKey)),
  })
  const mediaManifest = parseTtrpgMediaManifestV1(metadata.mediaManifest)
  const characterAnchors = visualBible.characters.map(identity => {
    const template = system.characterTemplates.find(template => template.characterKey === identity.characterKey)!
    return { characterKey: identity.characterKey,
      sourceResourceKey: system.entityBindings.find(binding => binding.bindingKey === identity.characterKey)?.sourceResourceRef ?? null,
      name: template.name, role: template.role === 'player' ? 'player' as const : 'major-npc' as const,
      publicIdentity: identity.identityPrompt,
      visualAnchor: [identity.identityPrompt, identity.silhouette, identity.attire, ...identity.markers].join('；') }
  })
  return { system, visualBible, mediaManifest, characterAnchors }
}

export function ttrpgOpenProductionMediaPromptV1(brief: ProductProductionBriefV3,
  context: ReturnType<typeof ttrpgOpenProductionMediaContextV1>): string {
  if (brief.media.voiceLineCount > 0) throw new Error('[ttrpg-open-media] 配音需要已定稿语音脚本与真实配音能力，不能用音乐或音效代替')
  const slots = context.mediaManifest.slots.filter(slot => slot.productionRequired)
  if (slots.length !== brief.media.imageCount) throw new Error('[ttrpg-open-media] 必需视觉槽位数量与已确认图片预算不一致，请先修订局势物料')
  const visual = slots.map((slot, index) => ({ artifactKey: `media.visual.${String(index + 1).padStart(3, '0')}`,
    sceneTag: slot.slotKey, targetRef: slot.targetRef, kind: slot.kind, prompt: slot.promptTemplate,
    width: slot.width ?? 1280, height: slot.height ?? 720 }))
  return '你负责开放跑团的已确认媒资规划。输出单个 JSON：{"schema":"storyforge.product-media-requirements-artifact","version":2,"visual":[],"audio":[]}。' +
    '只读取登记产物，不能改变规则、剧情事实、角色身份、槽位或生成数量。每项 visual 必须精确包含 artifactKey、mediaKind、sceneTag、beatKey、prompt、altText、width、height、palette、characterAnchorRefs、hardConstraints。' +
    'beatKey 固定为 open.entry.text；sceneTag 是冻结 slotKey。scene/map 对应 background/cg，角色肖像对应 character-pose，表情对应 character-expression，token/item-icon/handout 可用 ui。' +
    '角色图片必须用目标角色的真实 characterKey 和下方身份锚点；palette 为三个 #RRGGBB。hardConstraints 可填空数组，系统会按身份锚点生成完整约束。' +
    `视觉槽位：${JSON.stringify(visual)}。角色锚点：${JSON.stringify(context.characterAnchors)}。风格：${JSON.stringify(context.visualBible.style)}。` +
    `audio 必须精确生成音乐 ${brief.media.musicTrackCount}、音效 ${brief.media.sfxCount} 项，artifactKey 按 media.audio.001 连续编号，sceneTag 为对应槽位，beatKey 为 open.entry.text；每项字段为 artifactKey、mediaKind（bgm/ambience/sfx）、sceneTag、beatKey、prompt、altText、durationMs（250到120000毫秒）。没有音频需求时 audio 必须为空。` +
    '只能改编已确认开场或物料文字，不能透露未公开的主持秘密。返回规划 JSON，不声称已经产生图片或音频。'
}

export function assertTtrpgOpenProductionMediaRequirementsV1(input: {
  context: ReturnType<typeof ttrpgOpenProductionMediaContextV1>
  visual: readonly { artifactKey: string; sceneTag: string; mediaKind: string; beatKey: string; width: number; height: number; characterAnchorRefs: readonly string[] }[]
  audio: readonly { beatKey: string }[]
}) {
  const slots = input.context.mediaManifest.slots.filter(slot => slot.productionRequired)
  if (slots.length !== input.visual.length) throw new Error('[ttrpg-open-media] 素材规划必须覆盖全部明确的制作槽位')
  for (const [index, requirement] of input.visual.entries()) {
    const slot = slots[index]
    const allowed = slot.kind === 'scene' || slot.kind === 'map' ? ['background', 'cg', ...(slot.kind === 'map' ? ['ui'] : [])]
      : slot.kind === 'character-portrait' ? ['character-pose'] : slot.kind === 'character-expression' ? ['character-expression']
        : slot.kind === 'token' ? ['character-pose', 'ui'] : ['ui']
    if (requirement.artifactKey !== `media.visual.${String(index + 1).padStart(3, '0')}`
      || requirement.sceneTag !== slot.slotKey || requirement.beatKey !== 'open.entry.text'
      || !allowed.includes(requirement.mediaKind) || (slot.width !== null && requirement.width !== slot.width)
      || (slot.height !== null && requirement.height !== slot.height)
      || (['character-pose', 'character-expression'].includes(requirement.mediaKind)
        && (requirement.characterAnchorRefs.length !== 1 || requirement.characterAnchorRefs[0] !== slot.targetRef))) {
      throw new Error('[ttrpg-open-media] 规划不能改变冻结槽位、角色、尺寸或开局引用')
    }
  }
  if (input.audio.some(requirement => requirement.beatKey !== 'open.entry.text')) throw new Error('[ttrpg-open-media] 音频不得引用虚构叙事节拍')
}

/** Stable slot identity is explicit; there is no first-compatible-slot fallback. */
export function bindTtrpgOpenProductionMediaV1(input: {
  campaign: TtrpgCampaignContentV2
  visual: readonly { artifactKey: string; sceneTag: string; mediaKind: string; characterAnchorRefs: readonly string[] }[]
  assetsByArtifact: ReadonlyMap<string, FrozenRuntimeMediaAssetV2>
}): TtrpgCampaignContentV2 {
  const campaign = structuredClone(input.campaign), used = new Set<string>()
  for (const requirement of input.visual) {
    const asset = input.assetsByArtifact.get(requirement.artifactKey)
    const slot = campaign.mediaManifest.slots.find(slot => slot.slotKey === requirement.sceneTag)
    if (!asset || !slot || used.has(slot.slotKey) || asset.kind !== requirement.mediaKind) throw new Error('[ttrpg-open-media] 素材缺失、槽位重复或类别不匹配')
    const allowed = asset.kind === 'background' || asset.kind === 'cg' ? ['scene', 'map']
      : asset.kind === 'character-pose' ? ['character-portrait', 'token']
        : asset.kind === 'character-expression' ? ['character-expression'] : asset.kind === 'ui' ? ['map', 'token', 'item-icon', 'handout'] : []
    if (!allowed.includes(slot.kind) || slot.assetKey !== null
      || (['character-portrait', 'character-expression', 'token'].includes(slot.kind)
        && requirement.characterAnchorRefs.length > 0 && !requirement.characterAnchorRefs.includes(slot.targetRef))) {
      throw new Error('[ttrpg-open-media] 素材不能改变已冻结的槽位或角色身份')
    }
    slot.assetKey = asset.assetKey; used.add(slot.slotKey)
    const character = campaign.characterTemplates.find(template => template.characterKey === slot.targetRef)
    if (character && slot.kind === 'character-portrait') character.portraitAssetKey = asset.assetKey
    const identity = campaign.visualBible.characters.find(character => character.characterKey === slot.targetRef)
    if (identity && !identity.referenceAssetKeys.includes(asset.assetKey)) identity.referenceAssetKeys.push(asset.assetKey)
    const map = campaign.tabletop?.maps.find(map => map.mapKey === slot.targetRef)
    if (map && slot.kind === 'map') map.backgroundAssetKey = asset.assetKey
    const handout = campaign.handouts.find(handout => handout.handoutKey === slot.targetRef)
    if (handout && slot.kind === 'handout') handout.assetKey = asset.assetKey
  }
  if (campaign.mediaManifest.slots.some(slot => slot.productionRequired && slot.assetKey === null)) throw new Error('[ttrpg-open-media] 制作必需槽位仍缺少实际素材')
  const knownAssets = new Set([...input.assetsByArtifact.values()].map(asset => asset.assetKey))
  const referencedAssets = [
    ...campaign.mediaManifest.slots.map(slot => slot.assetKey), ...campaign.characterTemplates.map(character => character.portraitAssetKey),
    ...campaign.visualBible.characters.flatMap(character => character.referenceAssetKeys),
    ...campaign.visualBible.locations.flatMap(location => location.referenceAssetKeys),
    ...(campaign.tabletop?.maps.map(map => map.backgroundAssetKey) ?? []), ...campaign.handouts.map(handout => handout.assetKey),
  ]
  if (referencedAssets.some(key => key !== null && !knownAssets.has(key))) throw new Error('[ttrpg-open-media] 物料引用没有当前采纳素材的真实文件证据')
  return campaign
}
