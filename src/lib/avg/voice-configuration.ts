import { canonicalStringify } from '../agent/run/hash'
import { parseAvgAuthorWorkspaceV1, type AvgAuthorWorkspaceV1 } from './author-workspace-contract'
import { parseAvgAuthorVoiceChoice, type AvgAuthorVoiceChoice } from './audio-choice-dispatch'
import { assertAvgVoiceAssemblyRequestsV3, type AvgAssemblyBriefV3 } from './voice-assembly-contract'
import { validateAvgVoiceProductionSourcesV1, type AvgVoiceScriptSourceV1 } from './voice-production-source'

/** Pure, reviewable configuration only. Callers obtain author-adopted choices
 * and actual script/producer/Blob authority from the service, then the stage
 * adoption independently rechecks them. No Cue, text, rules or release write.
 */
export async function applyAvgVoiceChoicesToDraftV1(input: {
  workspace: AvgAuthorWorkspaceV1
  assembly: AvgAssemblyBriefV3
  sourceScripts: AvgVoiceScriptSourceV1[]
  choices: AvgAuthorVoiceChoice[]
  replaceableAssets?: Array<{ assetKey: string; contentHash: string }>
}) {
  const next = parseAvgAuthorWorkspaceV1(input.workspace), { assembly, requests } = await assertAvgVoiceAssemblyRequestsV3(input.assembly)
  const batch = await validateAvgVoiceProductionSourcesV1(assembly.voice.batch, next, input.sourceScripts)
  if (!next.presentation.reading) throw new Error('[avg-voice] 请先明确阅读等待、打断和缺声策略，再配置生成配音')
  const reading = next.presentation.reading, choices = input.choices.map(parseAvgAuthorVoiceChoice)
  if (choices.length !== batch.requirements.length || new Set(choices.map(choice => choice.requirementKey)).size !== choices.length) {
    throw new Error('[avg-voice] 自动配置须有本批全部准确且唯一的作者配音选择')
  }
  for (const r of batch.requirements) {
    const choice = choices.find(item => item.requirementKey === r.requirementKey)
    const request = requests.find(item => item.requirementKey === r.requirementKey)!
    if (!choice || choice.requestIdentityHash !== request.identityHash || choice.asset.assetKey !== r.assetKey
      || choice.asset.characterTag !== (r.speakerKey ?? '') || choice.asset.sceneTag !== r.sceneKey
      || choice.asset.durationMs! > r.maximumDurationMs) throw new Error('[avg-voice] 配音选择的台词、说话人、演法或音频目录已变化')
    if (choice.asset.durationMs! >= reading.maximumVoiceWaitMs) throw new Error('[avg-voice] 实际配音时长达到阅读等待上限，请先明确调整等待策略')
    const voice = { lineKey: r.lineKey, assetKey: r.assetKey, text: r.text, textRevision: r.textRevision,
      speakerKey: r.speakerKey, locale: r.locale }
    const oldVoice = reading.voices.find(item => item.lineKey === r.lineKey)
    if (oldVoice && canonicalStringify(oldVoice) !== canonicalStringify(voice)) throw new Error('[avg-voice] 当前句已有其他配音或文本绑定，请先明确修订')
    const oldAsset = next.presentation.stage.assets.find(asset => asset.assetKey === r.assetKey)
    if (assembly.voice.recovery?.version === 2 && next.presentation.inheritedVoices) {
      next.presentation.inheritedVoices = next.presentation.inheritedVoices.filter(entry => entry.assetKey !== r.assetKey)
    }
    if (oldAsset && canonicalStringify(oldAsset) !== canonicalStringify(choice.asset)) {
      if (oldAsset.kind !== 'voice' || !input.replaceableAssets?.some(old => old.assetKey === oldAsset.assetKey && old.contentHash === oldAsset.contentHash)) {
        throw new Error('[avg-voice] 相同 key 已有其他媒资版本，请先明确修订来源')
      }
      next.presentation.stage.assets[next.presentation.stage.assets.indexOf(oldAsset)] = choice.asset
    }
    if (!oldAsset) next.presentation.stage.assets.push(choice.asset)
    if (!oldVoice) reading.voices.push(voice)
  }
  // The existing native reading coordinator owns exact-line playback; adding a
  // generic play-sound Cue here would create two independent voice transports.
  return parseAvgAuthorWorkspaceV1(next)
}
