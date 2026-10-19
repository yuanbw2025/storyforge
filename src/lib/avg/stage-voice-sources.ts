import { db } from '../db/schema'
import type { FrozenRuntimeMediaAssetV2, ProductBuildRecordV1, WorkspaceScope } from '../types'
import type { AvgSceneScriptV1 } from './artifact-contract'
import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import { assertRecordInScope } from '../workspace/scope'
import { parseAvgAuthorWorkspaceV1, type AvgAuthorStageV1, type AvgAuthorWorkspaceV1 } from './author-workspace-contract'
import { readAvgDraftMediaV1 } from './editor-service'
import { parseAvgAuthorVoiceChoiceV1 } from './voice-choice-contract'
import { prepareAvgAdoptedGeneratedVoiceV1, readAvgAdoptedGeneratedVoiceV1 } from './generated-voice-source'
import { assertAvgInheritedVoiceBindingV1 } from './stage-voice-source-contract'

const same = (a: unknown, b: unknown) => canonicalProductProductionJsonV2(a) === canonicalProductProductionJsonV2(b)
type StageSourceInput = { scope: WorkspaceScope; productionKey: string; targetBuildNumber: number; worldContentHash: string }

/** Exact inherited audio, never an imported alias or a current voice choice.
 * The current stage must bind the original words/speaker and independently
 * pass its own author adoption, compilation, route and publication gates. */
export async function readAvgInheritedStageVoicesV1(input: StageSourceInput & { payload: AvgAuthorStageV1; scripts: AvgSceneScriptV1[] }) {
  const voices = new Map<string, { asset: FrozenRuntimeMediaAssetV2; blobObjectId: number }>()
  for (const entry of input.payload.inheritedVoices ?? []) {
    const asset = input.payload.stage.assets.find(asset => asset.assetKey === entry.assetKey)
    const voice = await readAvgAdoptedGeneratedVoiceV1({ scope: input.scope, source: entry.source })
    if (!asset || !same(asset, voice.asset) || voice.sourceWorldContentHash !== input.worldContentHash
      || voice.source.productionKey === input.productionKey && voice.source.raw.buildNumber >= input.targetBuildNumber
      || input.payload.stage.cues.some(cue => cue.assetKey === asset.assetKey)) {
      throw new Error('[avg-voice] 演出沿用缺少准确的旧版配音来源，或出现当前版本/重复声音 Cue')
    }
    assertAvgInheritedVoiceBindingV1({ asset, requirement: voice.requirement, scripts: input.scripts, reading: input.payload.reading })
    voices.set(entry.assetKey, { asset, blobObjectId: voice.blobObjectId })
  }
  return voices
}

/** Called by the explicit consumed-batch completion workflow. It only adds
 * reviewable portable sources to the editable draft; old choices are never
 * inserted into the new Plan, and original calls/costs remain historical. */
export async function prepareAvgInheritedVoiceDraftV1(input: StageSourceInput & { workspace: AvgAuthorWorkspaceV1; build: ProductBuildRecordV1 }) {
  const build = input.build.id == null ? null : await db.productBuilds.get(input.build.id)
  if (!build?.id || !await assertRecordInScope(input.scope, 'productBuilds', build, { owner: 'work' })
    || build.productionId !== input.build.productionId || build.buildNumber !== input.build.buildNumber
    || build.stateRevision !== input.build.stateRevision || build.controlEpoch !== input.build.controlEpoch
    || build.briefHash !== input.build.briefHash || build.planHash !== input.build.planHash) throw new Error('[avg-voice] 沿用提案的原版本不存在、跨作品或已变化')
  const next = parseAvgAuthorWorkspaceV1(input.workspace)
  const entries = [...(next.presentation.inheritedVoices ?? [])]
  const choices = await db.productBuildArtifacts.where('buildId').equals(build.id)
    .filter(row => row.status === 'accepted' && row.artifactKey.startsWith('avg.voice.choice.')).limit(9).toArray()
  if (choices.length > 8) throw new Error('[avg-voice] 原配音选择超出冻结批次范围')
  for (const row of choices) if (!await assertRecordInScope(input.scope, 'productBuildArtifacts', row, { owner: 'work' })) throw new Error('[avg-voice] 旧配音选择跨作品')
  for (const asset of next.presentation.stage.assets.filter(asset => asset.kind === 'voice')) {
    if (entries.some(entry => entry.assetKey === asset.assetKey)) continue
    const matches = choices.filter(row => same(parseAvgAuthorVoiceChoiceV1(row.payloadJson).asset, asset))
    if (matches.length > 1) throw new Error('[avg-voice] 旧演出配音来源不唯一')
    const row = matches[0]
    if (!row) { await readAvgDraftMediaV1(input.scope, asset); continue }
    if (!row.id || !await assertRecordInScope(input.scope, 'productBuildArtifacts', row, { owner: 'work' })) throw new Error('[avg-voice] 旧配音选择跨作品')
    const voice = await prepareAvgAdoptedGeneratedVoiceV1({ scope: input.scope, choiceId: row.id })
    if (voice.sourceWorldContentHash !== input.worldContentHash) throw new Error('[avg-voice] 配音沿用不能跨冻结世界')
    assertAvgInheritedVoiceBindingV1({ asset, requirement: voice.requirement, scripts: next.scripts, reading: next.presentation.reading })
    entries.push({ assetKey: asset.assetKey, source: voice.source,
      declaration: '在此编辑草稿中保留准确已采用配音；新版本仍须核对原句、说话人、演出与来源并明确确认采用' })
  }
  if (entries.length) next.presentation.inheritedVoices = entries
  await readAvgInheritedStageVoicesV1({ ...input, payload: next.presentation, scripts: next.scripts })
  return next
}
