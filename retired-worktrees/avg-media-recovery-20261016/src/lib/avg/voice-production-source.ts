import { hashProductProductionValueV2 } from '../product-production/hash'
import { canonicalStringify, hashCanonicalValue } from '../agent/run/hash'
import { parseAvgProfessionalArtifactV1, type AvgSceneScriptV1 } from './artifact-contract'
import { parseAvgSystemPlan, type AvgSystemPlan } from './system-contract'
import { avgList, avgUnique } from './protocol-validation'
import { assertAvgVoiceProductionTextHashesV1 } from './voice-production-contract'

export interface AvgVoiceSourceInputV1 {
  systemPlan: AvgSystemPlan
  scripts: AvgSceneScriptV1[]
}

export interface AvgVoiceScriptSourceV1 {
  artifactKey: string
  version: number
  contentHash: string
  payload: unknown
}

function sourceInput(input: AvgVoiceSourceInputV1) {
  const systemPlan = parseAvgSystemPlan(input.systemPlan)
  const scripts = avgUnique(avgList(input.scripts, 'voice source scripts', value => {
    const script = parseAvgProfessionalArtifactV1(value)
    if (script.schema !== 'storyforge.avg.scene-script') throw new Error('[avg-voice] 配音来源不是规范脚本')
    if (!systemPlan.scenes.some(scene => scene.key === script.sceneKey)
      || script.lines.some(line => line.speakerKey !== null && !systemPlan.characters.some(character => character.key === line.speakerKey))) {
      throw new Error('[avg-voice] 配音来源引用未知场景或人物')
    }
    return script
  }), script => script.sceneKey, 'voice source scenes')
  return { schema: 'storyforge.avg.voice-source-input', version: 1, systemPlan,
    scripts: scripts.sort((a, b) => a.sceneKey < b.sceneKey ? -1 : a.sceneKey > b.sceneKey ? 1 : 0) }
}

/** Voice depends on canonical words/speakers/rules, not image canvas, visual
 * selection, playback preferences or the voice batch itself. */
export function hashAvgVoiceSourceInputV1(input: AvgVoiceSourceInputV1): Promise<string> {
  return hashCanonicalValue(sourceInput(input))
}

/** Semantic/source consistency only. The caller must separately prove the
 * actual same-Work accepted Artifact, command, current Build and epoch. */
export async function validateAvgVoiceProductionSourcesV1(
  value: unknown,
  input: AvgVoiceSourceInputV1,
  sources: AvgVoiceScriptSourceV1[],
) {
  const batch = await assertAvgVoiceProductionTextHashesV1(value)
  const canonicalSource = sourceInput(input)
  if (batch.sourceInputHash !== await hashCanonicalValue(canonicalSource)) {
    throw new Error('[avg-voice] 系统或规范脚本已变化，请重新冻结配音需求')
  }
  const requiredKeys = new Set(batch.requirements.map(item => item.script.artifactKey))
  if (sources.length !== requiredKeys.size || new Set(sources.map(item => item.artifactKey)).size !== sources.length
    || sources.some(item => !requiredKeys.has(item.artifactKey))) {
    throw new Error('[avg-voice] 准确脚本来源缺失、重复或超出本批范围')
  }
  for (const source of sources) {
    const payload = parseAvgProfessionalArtifactV1(source.payload)
    if (payload.schema !== 'storyforge.avg.scene-script'
      || source.artifactKey !== `avg.content.scene-script.${payload.sceneKey}`
      || source.contentHash !== await hashProductProductionValueV2(payload)
      || canonicalStringify(payload) !== canonicalStringify(canonicalSource.scripts.find(script => script.sceneKey === payload.sceneKey))) {
      throw new Error('[avg-voice] 配音脚本来源字节与当前规范脚本不一致')
    }
    for (const requirement of batch.requirements.filter(item => item.script.artifactKey === source.artifactKey)) {
      const line = payload.lines.find(item => item.lineKey === requirement.lineKey)
      if (requirement.script.version !== source.version || requirement.script.contentHash !== source.contentHash
        || !line || line.text !== requirement.text || line.speakerKey !== requirement.speakerKey
        || requirement.sceneKey !== payload.sceneKey) {
        throw new Error('[avg-voice] 配音句、说话人、文本或脚本修订已变化')
      }
    }
  }
  return batch
}
