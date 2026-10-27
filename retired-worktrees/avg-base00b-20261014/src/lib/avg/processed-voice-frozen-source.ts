import { db } from '../db/schema'
import { assertRecordInScope } from '../workspace/scope'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { parseProductProductionBriefV3 } from '../product-production/contracts'
import { parseProductProductionPlanV3 } from '../product-production/plan'
import { verifyAvgHistoricalRawVoiceArtifactV1, verifyHistoricalAvgAudioProcessingProducerV1 } from '../product-production/artifact-store'
import { assertAvgAudioProcessingBriefV1 } from './audio-production-brief'
import { readAvgRawVoiceSourceV1 } from './voice-choice-validation'
import { inspectAvgProcessedAudioSourceV1 } from './processed-audio-source'
import { avgHash } from './protocol-validation'

type Ref = { artifactKey: string; version: number; contentHash: string }
type Frozen = NonNullable<Parameters<typeof readAvgRawVoiceSourceV1>[0]['historicalReadOnly']>
const same = (a: unknown, b: unknown) => canonicalProductProductionJsonV2(a) === canonicalProductProductionJsonV2(b)

/** Exact frozen bytes and original intrinsic Run proofs, never current
 * acceptance or author authority. Context stays the original sealed value:
 * imported Work/Build IDs must not be used to reconstruct its original hash. */
export async function readAvgFrozenProcessedVoiceSourceV1(input: Omit<Parameters<typeof readAvgRawVoiceSourceV1>[0], 'historicalReadOnly'> & {
  processed: Ref; frozen: Frozen
}) {
  const captured = structuredClone(input), { scope, buildId, frozen } = captured
  const build = await db.productBuilds.get(buildId)
  const stored = build ? await db.productProductionBriefs.where('[productionId+revision]').equals([build.productionId, build.briefRevision]).first() : null
  if (!build?.id || !stored || !await assertRecordInScope(scope, 'productBuilds', build, { owner: 'work' })
    || !await assertRecordInScope(scope, 'productProductionBriefs', stored, { owner: 'work' })
    || build.stateRevision !== frozen.expectedBuildRevision || build.briefHash !== frozen.expectedBriefHash
    || build.planHash !== frozen.expectedPlanHash || !['authorized', 'superseded'].includes(stored.status)
    || stored.briefHash !== build.briefHash || stored.authorizedAt !== build.authorizedAt) {
    throw new Error('[avg-audio-process] 历史加工配音缺少准确同作品冻结版本及原授权')
  }
  const brief = parseProductProductionBriefV3(stored.briefJson)
  assertAvgAudioProcessingBriefV1(brief)
  const plan = parseProductProductionPlanV3(build.planJson, brief, build.briefHash)
  const entry = brief.avgAudioProcessing?.entries.find(e => e.domain === 'voice'
    && captured.raw.artifactKey === `avg.voice.raw.${e.requirementKey}`
    && captured.processed.artifactKey === `avg.voice.processed.${e.requirementKey}`)
  if (!entry || brief.avgAssembly?.version !== 3 || plan.controlEpoch !== frozen.sourceControlEpoch
    || await hashProductProductionValueV2(brief) !== build.briefHash || await hashProductProductionValueV2(plan) !== build.planHash) {
    throw new Error('[avg-audio-process] 历史读取不能替换原加工配方、需求或生产图')
  }
  const original = await readAvgRawVoiceSourceV1({ scope, buildId, assembly: captured.assembly,
    capability: captured.capability, raw: captured.raw, historicalReadOnly: frozen })
  const raw = await verifyAvgHistoricalRawVoiceArtifactV1({ scope, buildId, ...frozen, ...captured.raw })
  const processing = await verifyHistoricalAvgAudioProcessingProducerV1({ scope, buildId, ...frozen, ...captured.processed })
  if (!same(raw.artifact, original.raw)) throw new Error('[avg-audio-process] 历史加工原件与原响应证明不一致')
  const sourceContextHash = avgHash(JSON.parse(processing.artifact.qualityJson).sourceContextHash, 'frozen sealed processing context')
  const selected = await inspectAvgProcessedAudioSourceV1({ scope, entry, row: processing.artifact, sourceContextHash,
    original: { row: original.raw, asset: original.asset, requestIdentityHash: original.payload.request.identityHash } })
  if (processing.artifact.producerRunId === original.raw.producerRunId) throw new Error('[avg-audio-process] 原件与加工结果须有各自真实producer')
  if (!same(await db.productBuilds.get(buildId), build) || !same(await db.productProductionBriefs.get(stored.id!), stored)) {
    throw new Error('[avg-audio-process] 历史加工读取期间版本或原授权已变化')
  }
  return { ...selected, row: processing.artifact, original, rawProof: raw.provenance,
    processingProof: processing.provenance, sourceContextHash, entry, build, brief }
}
