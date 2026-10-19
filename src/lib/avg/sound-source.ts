import { hashAvgMediaSourceInputV1, normalizeAvgMediaSourceInputV1, type AvgMediaSourceInputV1 } from './media-source'
import { parseAvgSoundPlanningScopeV1, type AvgSoundPlanningScopeV1 } from './sound-scope-contract'

/** Reuse the canonical AVG source fingerprint. This is not a context reader,
 * Work authorization, SourcePlan or a claim that an audio source is licensed. */
export async function validateAvgSoundPlanningSourcesV1(value: unknown, input: AvgMediaSourceInputV1) {
  const scope = parseAvgSoundPlanningScopeV1(value), source = normalizeAvgMediaSourceInputV1(input)
  if (scope.sourceInputHash !== await hashAvgMediaSourceInputV1(input)) throw new Error('[avg-sound] 规则、台词或画幅已变化，请重新冻结声音需求')
  for (const t of scope.templates) {
    const scene = source.systemPlan.scenes.find(s => s.key === t.consumer.sceneKey)
    const script = source.scripts.find(s => s.sceneKey === t.consumer.sceneKey)
    const owners = source.scripts.filter(s => s.lines.some(l => l.lineKey === t.cue.beatKey))
    if (!scene || owners.length !== 1 || t.consumer.subjectKey !== scene.key || !script?.lines.some(l => l.lineKey === t.cue.beatKey && l.beatKey === t.cue.beatKey)) {
      throw new Error('[avg-sound] 声音须绑定同一规范场景及准确脚本触发拍')
    }
  }
  return scope
}

export async function freezeAvgSoundPlanningScopeV1(value: Omit<AvgSoundPlanningScopeV1, 'sourceInputHash'>, source: AvgMediaSourceInputV1) {
  return validateAvgSoundPlanningSourcesV1({ ...value, sourceInputHash: await hashAvgMediaSourceInputV1(source) }, source)
}
