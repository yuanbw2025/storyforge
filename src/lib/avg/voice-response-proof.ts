import Dexie from 'dexie'
import type { ProductBuildArtifactRecordV1, WorkspaceScope } from '../types'
import { readAgentRunV1 } from '../agent/run/event-store'
import { canonicalStringify } from '../agent/run/hash'
import { readAgentRunArtifactExactV1 } from '../memory/artifact-store'
import { avgHash } from './protocol-validation'
import { avgRawVoiceArtifactKeyV1 } from './voice-assembly-contract'
import type { AvgRawVoicePayloadV1 } from './voice-raw-contract'
import { assertAvgVoiceResponseEvidenceV1 } from './voice-response-contract'

function fail(): never { throw new Error('[avg-voice] 原始配音响应与准确任务或 Run 证据不一致') }

/** Read-only response proof, separately from sealed producer acceptance.
 * The caller must verify that exact producer/candidate/ledger first. Events
 * are replayed by the registered Run reader; a project-wide body alone is
 * insufficient. No provider configuration or credential is needed to read. */
export async function assertAvgOriginalVoiceResponseV1(input: {
  scope: WorkspaceScope; row: ProductBuildArtifactRecordV1; raw: AvgRawVoicePayloadV1
}) {
  const { scope, row, raw } = input
  const producerRunId = row.producerRunId
  if (producerRunId === null || !Number.isSafeInteger(producerRunId) || producerRunId < 1
    || !row.producerReceiptHash || row.status !== 'accepted' || row.kind !== 'audio'
    || row.mediaKind !== 'voice' || row.artifactKey !== avgRawVoiceArtifactKeyV1(raw.requirement.requirementKey)) fail()
  const quality = JSON.parse(row.qualityJson) as Record<string, unknown>
  return assertAvgVoiceProducerResponseV1({ scope, buildId: row.buildId, controlEpoch: row.controlEpoch, producerRunId, quality, raw })
}

/** Also used inside sealed admission before an Artifact row exists. This
 * proves the real producer's response without fabricating an accepted row;
 * the shared caller separately proves checkpoint, ledger and write authority. */
export async function assertAvgVoiceProducerResponseV1(input: {
  scope: WorkspaceScope; buildId: number; controlEpoch: number; producerRunId: number
  quality: Record<string, unknown>; raw: AvgRawVoicePayloadV1
}) {
  const { scope, producerRunId, quality, raw } = input, taskKey = `avg.voice.generate.${raw.requirement.requirementKey}`
  if (!Number.isSafeInteger(producerRunId) || producerRunId < 1) fail()
  const responseHash = avgHash(quality.responseEvidenceHash, 'voice response evidence hash')
  if (quality.received !== true || quality.rawResponseRecorded !== true) fail()
  const snapshot = await readAgentRunV1(scope, producerRunId)
  const boundary = snapshot.contract.scope.productProduction
  const events = snapshot.events.filter(event => event.type === 'evidence.artifact.recorded'
    && event.payload.artifactKind === 'raw-response' && event.payload.stepId === taskKey && event.payload.attempt === 1)
  if (snapshot.run.productBuildId !== input.buildId || boundary?.productBuildId !== input.buildId
    || boundary.controlEpoch !== input.controlEpoch || boundary.taskKey !== taskKey
    || snapshot.projection.steps[taskKey]?.status !== 'succeeded' || snapshot.projection.steps[taskKey]?.attempt !== 1
    || events.length !== 1 || events[0]!.type !== 'evidence.artifact.recorded' || events[0]!.payload.contentHash !== responseHash) fail()
  const evidence = await readAgentRunArtifactExactV1({ projectId: scope.projectId, artifactKind: 'raw-response', contentHash: responseHash })
  if (events[0]!.type !== 'evidence.artifact.recorded'
    || events[0]!.payload.byteLength !== new TextEncoder().encode(evidence).byteLength) fail()
  const inspect = () => assertAvgVoiceResponseEvidenceV1({ evidence, raw })
  const checked = Dexie.currentTransaction ? await Dexie.waitFor(Dexie.ignoreTransaction(inspect), 20_000) : await inspect()
  if (checked.responseEvidenceHash !== responseHash) fail()
  const current = await readAgentRunV1(scope, producerRunId)
  if (current.projection.lastSequence !== snapshot.projection.lastSequence
    || canonicalStringify(current.run) !== canonicalStringify(snapshot.run)
    || await readAgentRunArtifactExactV1({ projectId: scope.projectId, artifactKind: 'raw-response', contentHash: responseHash }) !== evidence) fail()
  return checked
}
