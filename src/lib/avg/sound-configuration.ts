import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import { parseAvgAuthorWorkspaceV1, type AvgAuthorWorkspaceV1 } from './author-workspace-contract'
import { parseAvgAuthorSoundChoice } from './audio-choice-dispatch'
import { compileAvgSoundRequirementsV1 } from './sound-requirements'
import { validateAvgSoundPlanningSourcesV1 } from './sound-source'
import { parseAvgPresentationContent } from './runtime'

/** Pure reviewable draft projection, after service-side proof verification.
 * This function cannot adopt an asset, issue a licence, write a DB or create
 * an alternate audio player. The existing stage audio channels own playback. */
export async function applyAvgSoundChoicesToDraftV1(input: {
  workspace: AvgAuthorWorkspaceV1; scope: unknown; plan: unknown; choices: unknown[]
}) {
  const next = parseAvgAuthorWorkspaceV1(input.workspace)
  const scope = await validateAvgSoundPlanningSourcesV1(input.scope, next)
  const compiled = await compileAvgSoundRequirementsV1(scope, input.plan), choices = input.choices.map(parseAvgAuthorSoundChoice)
  if (choices.length !== compiled.requirements.length || new Set(choices.map(c => c.requirementKey)).size !== choices.length) {
    throw new Error('[avg-sound] 自动配置需要本批准确完整且唯一的声音选择')
  }
  for (const request of compiled.requirements) {
    const t = request.template, choice = choices.find(c => c.requirementKey === t.requirementKey)!
    if (!choice || choice.requestIdentityHash !== request.identityHash || choice.asset.assetKey !== t.assetKey || choice.asset.kind !== t.channel
      || choice.asset.sceneTag !== t.consumer.sceneKey || choice.asset.characterTag !== '') throw new Error('[avg-sound] 声音选择的请求、场景或消费通道已变化')
    if (request.dispatch.operation === 'generate-music' && (choice.asset.mimeType !== 'audio/wav'
      || Math.abs(choice.asset.durationMs! - request.dispatch.body.durationSeconds * 1000) > 500)) {
      throw new Error('[avg-sound] 音乐格式或实际时长与冻结请求不一致')
    }
    if (request.dispatch.operation === 'import-licensed-audio') {
      const source = request.dispatch.source, mimeType = source.memberPath.toLowerCase().endsWith('.ogg') ? 'audio/ogg' : 'audio/wav'
      if (choice.raw.contentHash !== source.memberHash || choice.asset.mimeType !== mimeType) {
        throw new Error('[avg-sound] 音效选择必须保留准确来源原字节与格式，不得用同名替换或无谱系转码')
      }
    }
    const cue = parseAvgPresentationContent({ version: 1, cues: [{ ...t.cue, type: 'play-audio', assetKey: t.assetKey, durationMs: 0, easing: 'linear' }] }).cues[0]!
    const existingAsset = next.presentation.stage.assets.find(a => a.assetKey === t.assetKey)
    const existingCue = next.presentation.stage.cues.find(c => c.cueKey === cue.cueKey)
    if (next.presentation.stage.cues.some(c => c.cueKey !== cue.cueKey && c.type === 'play-audio' && c.beatKey === cue.beatKey
      && c.phase === cue.phase && (c.assetKey === t.assetKey || next.presentation.stage.assets.find(a => a.assetKey === c.assetKey)?.kind === t.channel))) {
      throw new Error('[avg-sound] 同拍同阶段通道已有其它声音，请明确修订，不能以顺序覆盖旧配置')
    }
    const same = (a: unknown, b: unknown) => canonicalProductProductionJsonV2(a) === canonicalProductProductionJsonV2(b)
    if (existingAsset && !same(existingAsset, choice.asset) || existingCue && !same(existingCue, cue)) {
      throw new Error('[avg-sound] 相同媒资或Cue已有其它版本，请先明确修订，不能覆盖旧配置')
    }
    if (!existingAsset) next.presentation.stage.assets.push(choice.asset)
    if (!existingCue) next.presentation.stage.cues.push(cue)
  }
  return parseAvgAuthorWorkspaceV1(next)
}

/** One explicit replacement after service-side source and new adoption proof.
 * Every other asset/cue and inherited source stays byte-for-byte in the draft. */
export async function applyAvgSoundLocalRepairChoiceToDraftV2(input: {
  workspace: AvgAuthorWorkspaceV1; repair: unknown; choices: unknown[]
}) {
  const { assertAvgSoundLocalRepairV1 } = await import('./sound-local-repair-contract')
  const { hashProductProductionValueV2 } = await import('../product-production/hash')
  const { repair, requirement } = await assertAvgSoundLocalRepairV1(input.repair), next = parseAvgAuthorWorkspaceV1(input.workspace)
  const choices = input.choices.map(parseAvgAuthorSoundChoice), choice = choices[0], t = requirement.template
  const same = (a: unknown, b: unknown) => canonicalProductProductionJsonV2(a) === canonicalProductProductionJsonV2(b)
  const expectedCue = parseAvgPresentationContent({ version: 1, cues: [{ ...t.cue, type: 'play-audio', assetKey: t.assetKey, durationMs: 0, easing: 'linear' }] }).cues[0]!
  if (!same(next.soundLocalRepair, repair) || choices.length !== 1 || choice?.version !== 2
    || choice.requirementKey !== t.requirementKey || choice.requestIdentityHash !== requirement.identityHash
    || choice.raw.contentHash !== repair.source.raw.contentHash || choice.processed.recipeHash !== await hashProductProductionValueV2(repair.recipe)
    || choice.asset.assetKey !== t.assetKey || choice.asset.kind !== t.channel || choice.asset.sceneTag !== t.consumer.sceneKey
    || choice.asset.characterTag !== '' || choice.asset.mimeType !== 'audio/wav'
    || next.scripts.filter(s => s.sceneKey === t.consumer.sceneKey).flatMap(s => s.lines).filter(l => l.lineKey === t.cue.beatKey).length !== 1
    || next.presentation.stage.cues.filter(c => c.assetKey === t.assetKey).length !== 1
    || !same(next.presentation.stage.cues.find(c => c.assetKey === t.assetKey), expectedCue)) {
    throw new Error('[avg-sound-repair] 局部配置必须是准确单项新加工选择、原播放用途和已保存配方')
  }
  const old = next.presentation.stage.assets.find(a => a.assetKey === t.assetKey)
  const inherited = next.presentation.inheritedSounds?.find(e => e.assetKey === t.assetKey)
  if (!old || !(same(old, repair.sourceAsset) && inherited && same(inherited.source, repair.source)
    || same(old, choice.asset) && !inherited)) throw new Error('[avg-sound-repair] 原槽或旧采用来源已变化，不能覆盖其他版本')
  next.presentation.stage.assets = next.presentation.stage.assets.map(a => a.assetKey === t.assetKey ? choice.asset : a)
  if (next.presentation.inheritedSounds?.length) {
    next.presentation.inheritedSounds = next.presentation.inheritedSounds.filter(e => e.assetKey !== t.assetKey)
    if (!next.presentation.inheritedSounds.length) delete next.presentation.inheritedSounds
  }
  return parseAvgAuthorWorkspaceV1(next)
}
