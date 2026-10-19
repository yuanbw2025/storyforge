import Dexie from 'dexie'
import modelSource from '../../../scripts/avg-local-music/model-source.json'
import { hashProductProductionValueV2 } from '../product-production/hash'
import { parseAvgMusicPromptV1, parseAvgSoundPlanV1 } from './sound-plan-contract'
import { parseAvgSoundPlanningScopeV1 } from './sound-scope-contract'

export const AVG_LOCAL_MUSIC_MODEL_V1 = `${modelSource.repository}@${modelSource.revision}`
export const AVG_LOCAL_MUSIC_CODE_REVISION_V1 = modelSource.codeRevision
export const AVG_LOCAL_MUSIC_PROFILE_V1 = 'storyforge.avg.instrumental-evaluation-v1'
// This V1 recipe is immutable. A new model/profile needs its own pinned
// manifest and explicit protocol, never an in-place replacement for old runs.

/** Deterministic proposal compilation only. Real execution must additionally
 * prove the adopted plan, frozen Brief/Plan/Harness, route and source bytes. */
export async function compileAvgSoundRequirementsV1(scopeInput: unknown, planInput: unknown) {
  const compile = () => compileAvgSoundRequirementsIsolatedV1(scopeInput, planInput)
  // Author adoption and context admission can call this under an atomic DB
  // lock. Keep one lease around this entirely pure pipeline; individual
  // parallel hashes must not enqueue additional leases on that transaction.
  return Dexie.currentTransaction ? Dexie.waitFor(Dexie.ignoreTransaction(compile), 20_000) : compile()
}

async function compileAvgSoundRequirementsIsolatedV1(scopeInput: unknown, planInput: unknown) {
  const scope = parseAvgSoundPlanningScopeV1(scopeInput), plan = parseAvgSoundPlanV1(planInput)
  if (plan.entries.length !== scope.templates.length
    || plan.entries.some(e => !scope.templates.some(t => t.requirementKey === e.requirementKey))) {
    throw new Error('[avg-sound] 方案必须准确覆盖本批冻结需求，不能新增或漏项')
  }
  const scopeHash = await hashProductProductionValueV2(scope), planHash = await hashProductProductionValueV2(plan)
  const requirements = await Promise.all(scope.templates.map(async template => {
    const entry = plan.entries.find(e => e.requirementKey === template.requirementKey)!
    let dispatch
    if (template.source.kind === 'generate-music') {
      if (entry.prompt === null || entry.librarySourceKey !== null) throw new Error('[avg-sound] 音乐方案必须给出准确生成说明')
      const { kind: _kind, ...parameters } = template.source
      const caption = `${entry.prompt}${template.constraints.length ? `\nConstraints:\n${template.constraints.join('\n')}` : ''}`.normalize('NFC')
      if (caption.length > 512) throw new Error('[avg-sound] 完整音乐说明与冻结约束超过接口512字符上限，请明确修订，不会截断')
      parseAvgMusicPromptV1(caption)
      dispatch = { operation: 'generate-music' as const, profile: AVG_LOCAL_MUSIC_PROFILE_V1,
        model: AVG_LOCAL_MUSIC_MODEL_V1, runtimeCodeRevision: AVG_LOCAL_MUSIC_CODE_REVISION_V1,
        body: { caption, ...parameters } }
    } else {
      if (entry.prompt !== null || entry.librarySourceKey === null || !template.source.allowedSourceKeys.includes(entry.librarySourceKey)) {
        throw new Error('[avg-sound] 音效方案只能选择本项明确允许的原始来源')
      }
      const source = scope.librarySources.find(s => s.sourceKey === entry.librarySourceKey)!
      dispatch = { operation: 'import-licensed-audio' as const, source }
    }
    const body = { template, design: entry, dispatch }
    return { ...body, identityHash: await hashProductProductionValueV2({ schema: 'storyforge.avg.sound-request-identity', version: 1,
      scopeHash, planHash, ...body }) }
  }))
  return { schema: 'storyforge.avg.compiled-sound-requirements' as const, version: 1 as const, scopeHash, planHash, requirements }
}
