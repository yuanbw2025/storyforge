/** One explicitly issued, memory-only audition. No autoplay or acceptance. */
import Dexie, { liveQuery, rangesOverlap, RangeSet, type ObservabilitySet } from 'dexie'
import { db } from '../db/schema'
import { canonicalStringify } from '../agent/run/hash'
import { readProductRuntimeState } from '../product/runtime-core'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { readTtrpgSessionParticipantsV2 } from './participants'
import { readTtrpgOpenVoiceAuditionBasisForKernelV1 } from './open-voice-candidate'
import type { TtrpgOpenVoiceJobLocatorV1 } from './open-voice-job-read-state'
import * as p from './open-contract-parse'
import { verifyTtrpgOpenGeneratedVoiceTimeline, type TtrpgOpenGeneratedVoiceTimeline } from './open-voice-timeline-contract'

type Prepared = Awaited<ReturnType<typeof readTtrpgOpenVoiceAuditionBasisForKernelV1>>
export interface TtrpgOpenVoiceAuditionV1 {
  candidateHash: string; blob: Blob; originalText: string; readingText: string; timeline: Prepared['timeline']
  sourceText: string; generatedTimeline: TtrpgOpenGeneratedVoiceTimeline
  generationAllowed: false; adoptionAllowed: false; humanListening: 'unproven'
}
interface Grant { blob: Blob; body: string; assertCurrent: () => Promise<void>; fingerprint: () => Promise<string>; expected: string
  watched: { table: string; ids: number[]; deleteOnly?: boolean }[]; revoked: boolean; observing: boolean }
const issued = new WeakMap<TtrpgOpenVoiceAuditionV1,Grant>()
const metadata = (value: TtrpgOpenVoiceAuditionV1) => canonicalStringify(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'blob')))

async function securityFingerprint(input: TtrpgOpenVoiceJobLocatorV1) {
  const [session,participants,state,project,world,work] = await Promise.all([db.productRuntimeSessions.get(input.sessionId),
    readTtrpgSessionParticipantsV2(input.sessionId),readProductRuntimeState(input.sessionId),db.projects.get(input.scope.projectId),db.worlds.get(input.scope.worldId),db.works.get(input.scope.workId)])
  const runtime = parseTtrpgRuntimeStateV2(state.ttrpg)
  if (!session || !runtime?.openRun || !runtime.authorization || !project || !world || !work) p.fail('试听拥有者或来源已不可用')
  return canonicalStringify({ projectId: session.projectId,worldId: session.worldId,workId: session.workId,worldGroupId: session.worldGroupId,
    sourceHash: session.runtimeSourceHash,release: session.productReleaseId,build: session.productBuildId,initial: session.initialStateJson,
    workspaceUid: project.workspaceUid,worldCode: world.code,workCode: work.code,sessionKey: runtime.sessionKey,
    authorization: runtime.authorization,participants,safety: runtime.product.safety.status })
}
export async function prepareTtrpgOpenVoiceAuditionV1(request: TtrpgOpenVoiceJobLocatorV1 & {
  candidateHash: string; decision: 'prepare-audition-for-this-original-voice-candidate'
}): Promise<TtrpgOpenVoiceAuditionV1> {
  const input = structuredClone(request);p.literal(input.decision,'prepare-audition-for-this-original-voice-candidate','explicit original audition')
  const { basis: b,candidate,data,timeline,assertCurrent } = await readTtrpgOpenVoiceAuditionBasisForKernelV1(input)
  const sourceText = b.original.request.script.text, audio = candidate.artifact.audio!
  const generatedTimeline = await verifyTtrpgOpenGeneratedVoiceTimeline({ schema: 'storyforge.ttrpg-open-generated-voice-timeline', version: timeline.sampleRate === 24000 ? 2 : 1,
    sourceTextHash: b.original.request.textHash, sourceTextLengthUtf16: sourceText.length,
    normalizedText: b.original.request.reading!.normalizedText, normalizedTextSha256: b.original.request.reading!.normalizedTextSha256, clock: timeline },
  sourceText, { mimeType: audio.mimeType, byteSize: audio.byteLength, durationMs: audio.durationMs })
  const runIds = [b.snapshot.run.id!,b.original.snapshot.run.id!]
  const refs = [...b.snapshot.events,...b.original.snapshot.events].flatMap(e => e.type === 'evidence.artifact.recorded' ? [e.payload] : [])
  const keys = await Promise.all(refs.map(ref => db.agentRunArtifacts.where('[projectId+artifactKind+contentHash]').equals([input.scope.projectId,ref.artifactKind,ref.contentHash]).primaryKeys()))
  if (keys.some(ids => ids.length !== 1)) p.fail('试听原工件的完整生命周期证明缺失')
  const artifactIds = [...new Set(keys.flat())]
  const checkpointIds = await db.agentRunCheckpoints.where('runId').anyOf(runIds).primaryKeys()
  const eventIds = await db.agentRunEvents.where('runId').anyOf(runIds).primaryKeys()
  const sourceEventIds = await db.productRuntimeEvents.where('sessionId').equals(input.sessionId).primaryKeys()
  const participantIds = await db.ttrpgSessionParticipants.where('sessionId').equals(input.sessionId).primaryKeys()
  const watched: Grant['watched'] = [{ table: db.agentRuns.name,ids: runIds },{ table: db.agentRunArtifacts.name,ids: artifactIds },
    { table: db.agentRunEvents.name,ids: eventIds },
    { table: db.productRuntimeEvents.name,ids: sourceEventIds },
    { table: db.agentRunCheckpoints.name,ids: checkpointIds },{ table: db.ttrpgSessionParticipants.name,ids: participantIds },
    { table: b.original.owner.immutable.table,ids: [b.original.owner.immutable.recordId] },{ table: db.productRuntimeSessions.name,ids: [input.sessionId],deleteOnly: true }]
  const fingerprint = () => securityFingerprint(input), expected = await fingerprint()
  await assertCurrent()
  const value: TtrpgOpenVoiceAuditionV1 = { candidateHash: candidate.candidateHash,blob: new Blob([data],{type:'audio/wav'}),
    originalText: b.original.request.script.text.slice(b.original.request.part.textOffset,b.original.request.part.textOffset + b.original.request.part.textLength),
    readingText: b.original.request.reading!.normalizedText,timeline: structuredClone(timeline),sourceText,generatedTimeline,
    generationAllowed: false,adoptionAllowed: false,humanListening: 'unproven' }
  issued.set(value,{ blob: value.blob,body: metadata(value),assertCurrent,fingerprint,expected,watched,revoked: false,observing: false })
  return value
}
/** Install before attaching a URL. Normal game progress may keep this exact
 * preview; identity/consent/safety/source/evidence changes invalidate it. */
export function observeTtrpgOpenVoiceAuditionV1(value: TtrpgOpenVoiceAuditionV1,onRevoke: () => void) {
  const grant = issued.get(value)
  if (!grant || grant.revoked || grant.observing || grant.blob !== value.blob || grant.body !== metadata(value)) p.fail('请以当前身份重新准备这条准确试听')
  grant.observing = true
  let active = true
  const handles: { subscription?: { unsubscribe: () => void } } = {}
  const dispose = () => {
    if (!active) return
    active = false;grant.revoked = true;issued.delete(value);Dexie.on.storagemutated.unsubscribe(mutate);handles.subscription?.unsubscribe()
  }
  const revoke = () => { if (!active) return;dispose();try { onRevoke() } catch { /* Local cleanup cannot break other DB observers. */ } }
  const mutate = (parts: ObservabilitySet) => {
    try {
      for (const row of grant.watched) for (const suffix of row.deleteOnly ? [':dels'] : ['',':dels']) {
        const range = parts[`idb://${db.name}/${row.table}/${suffix}`]
        if (range && row.ids.some(id => rangesOverlap(range,new RangeSet(id)))) { revoke();return }
      }
    } catch { revoke() }
  }
  Dexie.on.storagemutated.subscribe(mutate)
  handles.subscription = liveQuery(grant.fingerprint).subscribe({ next: key => { if (key !== grant.expected) revoke() },error: revoke })
  const ready = grant.assertCurrent().then(() => {
    if (!active || grant.revoked || grant.body !== metadata(value) || grant.blob !== value.blob) p.fail('本次试听已失效，请重新准备')
  }).catch(error => { revoke();throw error })
  return { ready,dispose }
}
