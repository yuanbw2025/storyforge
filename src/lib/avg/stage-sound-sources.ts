import { db } from '../db/schema'
import type { FrozenRuntimeMediaAssetV2, ProductBuildRecordV1, WorkspaceScope } from '../types'
import { assertRecordInScope } from '../workspace/scope'
import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import { readAvgConfirmedSoundChoicesV1 } from './author-artifacts'
import { parseAvgAuthorWorkspaceV1, type AvgAuthorStageV1, type AvgAuthorWorkspaceV1 } from './author-workspace-contract'
import { parseAvgExecutableStageV1 } from './stage-contract'
import { parseAvgGeneratedSoundSourceV1, type AvgGeneratedSoundSourceV1 } from './stage-sound-source-contract'
import type { AvgRawSoundPayloadV1 } from './sound-review'
import type { AvgSceneScriptV1 } from './artifact-contract'

const same = (a: unknown, b: unknown) => canonicalProductProductionJsonV2(a) === canonicalProductProductionJsonV2(b)
type Choice = Awaited<ReturnType<typeof readAvgConfirmedSoundChoicesV1>>[number]
type Input = { scope: WorkspaceScope; productionKey: string; targetBuildNumber: number; worldContentHash: string }
const sourceOf = (build: ProductBuildRecordV1, productionKey: string, choice: Choice) => parseAvgGeneratedSoundSourceV1({
  schema: 'storyforge.avg.generated-sound-source', version: 1, productionKey, buildNumber: build.buildNumber,
  controlEpoch: build.controlEpoch, briefHash: build.briefHash, planHash: build.planHash,
  requirementKey: choice.payload.requirementKey, requestIdentityHash: choice.payload.requestIdentityHash,
  raw: { artifactKey: choice.raw.artifactKey, version: choice.raw.version, contentHash: choice.raw.contentHash,
    producerReceiptHash: choice.raw.producerReceiptHash, responseEvidenceHash: choice.validation.responseEvidenceHash,
    requestSnapshotHash: choice.validation.requestSnapshotHash, rightsHash: choice.validation.rightsHash },
  compiled: choice.validation.compiled, review: { ...choice.review.artifact, authorReceiptHash: choice.review.authorReceiptHash },
  choice: { ...choice.artifact, authorReceiptHash: choice.authorReceiptHash } })

async function readOriginal(input: { scope: WorkspaceScope; source: AvgGeneratedSoundSourceV1 }) {
  const source = parseAvgGeneratedSoundSourceV1(input.source)
  const productions = await db.productProductions.where('workId').equals(input.scope.workId)
    .filter(row => row.productType === 'avg' && row.productionKey === source.productionKey).limit(2).toArray()
  const production = productions[0]
  if (productions.length !== 1 || !production?.id || !await assertRecordInScope(input.scope, 'productProductions', production, { owner: 'work' })) throw new Error('[avg-sound] 原声音制作来源不存在、重复或跨作品')
  const build = await db.productBuilds.where('[productionId+buildNumber]').equals([production.id, source.buildNumber]).first()
  if (!build?.id || !await assertRecordInScope(input.scope, 'productBuilds', build, { owner: 'work' })
    || build.controlEpoch !== source.controlEpoch || build.briefHash !== source.briefHash || build.planHash !== source.planHash) throw new Error('[avg-sound] 原声音准确版本已变化')
  // The frozen reader proves actual producer/response/bytes, original review,
  // author commands and fixed Plan, including after supersession or remap.
  const choices = await readAvgConfirmedSoundChoicesV1({ scope: input.scope, buildId: build.id,
    expectedBuildRevision: build.stateRevision, controlEpoch: source.controlEpoch }, true)
  const choice = choices.find(c => c.payload.requirementKey === source.requirementKey)
  if (!choice || !same(sourceOf(build, production.productionKey, choice), source)
    || !same(build, await db.productBuilds.get(build.id))) throw new Error('[avg-sound] 原声音producer、权利、审听或作者选用证明已变化')
  return { choice, worldContentHash: choice.sourceWorldContentHash }
}

/** Reuse the original approved consumer. Changing a cue/channel/scene is a
 * new listening decision, never implied by an unrelated dialogue/rule edit. */
export function assertAvgInheritedSoundBindingV1(input: { asset: FrozenRuntimeMediaAssetV2; raw: AvgRawSoundPayloadV1;
  payload: AvgAuthorStageV1; scripts: AvgSceneScriptV1[] }) {
  const t = input.raw.requirement.template
  const expected = parseAvgExecutableStageV1({ version: 1, assets: [input.asset], cues: [{ ...t.cue,
    type: 'play-audio', assetKey: t.assetKey, durationMs: 0, easing: 'linear' }] }).cues[0]!
  const cues = input.payload.stage.cues.filter(c => c.assetKey === input.asset.assetKey)
  const lines = input.scripts.filter(s => s.sceneKey === t.consumer.sceneKey).flatMap(s => s.lines).filter(l => l.lineKey === t.cue.beatKey)
  if (input.asset.assetKey !== t.assetKey || input.asset.kind !== t.channel || lines.length !== 1
    || cues.length !== 1 || !same(cues[0], expected)
    || input.payload.stage.cues.some(c => c.cueKey !== expected.cueKey && c.type === 'play-audio' && c.beatKey === expected.beatKey
      && c.phase === expected.phase && input.payload.stage.assets.find(a => a.assetKey === c.assetKey)?.kind === t.channel)) {
    throw new Error('[avg-sound] 沿用声音的原场景、触发位置、通道、音量或循环已变化，请明确重新审听或移除旧绑定')
  }
}

export async function readAvgInheritedStageSoundsV1(input: Input & { payload: AvgAuthorStageV1; scripts: AvgSceneScriptV1[] }) {
  const sounds = new Map<string, { asset: FrozenRuntimeMediaAssetV2; blobObjectId: number }>()
  for (const entry of input.payload.inheritedSounds ?? []) {
    const { choice, worldContentHash } = await readOriginal({ scope: input.scope, source: entry.source })
    const asset = input.payload.stage.assets.find(a => a.assetKey === entry.assetKey)
    if (!asset || !same(asset, choice.payload.asset) || worldContentHash !== input.worldContentHash
      || entry.source.productionKey === input.productionKey && entry.source.buildNumber >= input.targetBuildNumber) throw new Error('[avg-sound] 沿用声音不是准确旧版本、原字节或冻结世界')
    assertAvgInheritedSoundBindingV1({ asset, raw: JSON.parse(choice.raw.payloadJson) as AvgRawSoundPayloadV1, payload: input.payload, scripts: input.scripts })
    sounds.set(entry.assetKey, { asset, blobObjectId: choice.blobObjectId })
  }
  return sounds
}

/** Only proposes portable sources in the editable draft; never copies old
 * choice authority into the new Plan or issues another provider request. */
export async function prepareAvgInheritedSoundDraftV1(input: Input & { workspace: AvgAuthorWorkspaceV1; build: ProductBuildRecordV1 }) {
  const next = parseAvgAuthorWorkspaceV1(input.workspace)
  if (!input.build.id) throw new Error('[avg-sound] 原声音版本不存在')
  const choices = await readAvgConfirmedSoundChoicesV1({ scope: input.scope, buildId: input.build.id,
    expectedBuildRevision: input.build.stateRevision, controlEpoch: input.build.controlEpoch }, true)
  const entries = [...(next.presentation.inheritedSounds ?? [])]
  for (const choice of choices) {
    if (!next.presentation.stage.assets.some(a => same(a, choice.payload.asset))) continue
    const source = sourceOf(input.build, input.productionKey, choice), existing = entries.find(e => e.assetKey === choice.payload.asset.assetKey)
    if (existing && !same(existing.source, source)) throw new Error('[avg-sound] 不能覆盖已有声音来源')
    if (!existing) entries.push({ assetKey: choice.payload.asset.assetKey, source,
      declaration: '在编辑草稿保留准确原声音与原播放用途；新版本仍须独立确认演出、路线与全部媒资' })
  }
  if (entries.length) next.presentation.inheritedSounds = entries
  await readAvgInheritedStageSoundsV1({ ...input, payload: next.presentation, scripts: next.scripts })
  return next
}
