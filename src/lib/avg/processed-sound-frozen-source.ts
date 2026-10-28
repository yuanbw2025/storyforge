import { db } from '../db/schema'
import { assertRecordInScope } from '../workspace/scope'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import { parseProductProductionBriefV3 } from '../product-production/contracts'
import { parseProductProductionPlanV3 } from '../product-production/plan'
import { verifyHistoricalAvgAudioProcessingProducerV1 } from '../product-production/artifact-store'
import { assertAvgAudioProcessingBriefV1 } from './audio-production-brief'
import { readAvgRawSoundSourceV1 } from './sound-choice-validation'
import { inspectAvgProcessedAudioSourceV1 } from './processed-audio-source'
import { avgHash } from './protocol-validation'

type Ref = { artifactKey: string; version: number; contentHash: string }
type Frozen = { expectedBuildRevision: number; expectedBriefHash: string; expectedPlanHash: string; sourceControlEpoch: number }
const same = (a: unknown, b: unknown) => canonicalProductProductionJsonV2(a) === canonicalProductProductionJsonV2(b)

/** Immutable original sound proof plus its independently sealed local producer.
 * Imported IDs never reconstruct the original processing Context hash. This
 * read grants no new execution, current acceptance or author authority. */
export async function readAvgFrozenProcessedSoundSourceV1(input: Parameters<typeof readAvgRawSoundSourceV1>[0] & {
  processed: Ref; frozen: Frozen
}) {
  const captured = structuredClone(input), { scope, buildId, frozen } = captured
  const build = await db.productBuilds.get(buildId)
  const stored = build ? await db.productProductionBriefs.where('[productionId+revision]').equals([build.productionId, build.briefRevision]).first() : null
  if (!build?.id || !stored || !await assertRecordInScope(scope, 'productBuilds', build, { owner: 'work' })
    || !await assertRecordInScope(scope, 'productProductionBriefs', stored, { owner: 'work' })
    || build.stateRevision !== frozen.expectedBuildRevision || build.briefHash !== frozen.expectedBriefHash
    || build.planHash !== frozen.expectedPlanHash || build.controlEpoch !== frozen.sourceControlEpoch
    || !['authorized', 'superseded'].includes(stored.status) || stored.briefHash !== build.briefHash
    || stored.authorizedAt !== build.authorizedAt) throw new Error('[avg-audio-process] 历史加工声音缺少准确同作品冻结版本及原授权')
  const brief = parseProductProductionBriefV3(stored.briefJson)
  assertAvgAudioProcessingBriefV1(brief)
  const plan = parseProductProductionPlanV3(build.planJson, brief, build.briefHash)
  const entry = brief.avgAudioProcessing?.entries.find(e => e.domain === 'sound'
    && captured.raw.artifactKey === `avg.sound.raw.${e.requirementKey}`
    && captured.processed.artifactKey === `avg.sound.processed.${e.requirementKey}`)
  if (!entry || !brief.avgSoundPlanning || plan.controlEpoch !== frozen.sourceControlEpoch
    || await hashProductProductionValueV2(brief) !== build.briefHash || await hashProductProductionValueV2(plan) !== build.planHash) {
    throw new Error('[avg-audio-process] 历史声音不能替换原需求、加工配方或生产图')
  }
  const original = await readAvgRawSoundSourceV1({ scope, buildId, raw: captured.raw })
  const processing = await verifyHistoricalAvgAudioProcessingProducerV1({ scope, buildId, ...frozen, ...captured.processed })
  const sourceContextHash = avgHash(JSON.parse(processing.artifact.qualityJson).sourceContextHash, 'frozen sound processing context')
  const selected = await inspectAvgProcessedAudioSourceV1({ scope, entry, row: processing.artifact, sourceContextHash,
    original: { row: original.raw, asset: original.asset, requestIdentityHash: original.payload.requirement.identityHash } })
  if (processing.artifact.producerRunId === original.raw.producerRunId) throw new Error('[avg-audio-process] 原声音与加工结果须有各自真实producer')
  if (!same(await db.productBuilds.get(buildId), build) || !same(await db.productProductionBriefs.get(stored.id!), stored)) {
    throw new Error('[avg-audio-process] 历史加工声音读取期间版本或原授权已变化')
  }
  return { ...selected, row: processing.artifact, original, processingProof: processing.provenance, sourceContextHash, entry, build, brief }
}
