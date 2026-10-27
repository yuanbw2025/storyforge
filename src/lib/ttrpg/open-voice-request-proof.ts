import { ttrpgOpenFrozenSourceHashV1 } from './open-release-continuation-proof'
/** Immutable domain event proof, including branch cutpoints. Never a Run or
 * transport authorization; portable events retain their original namespace. */
import type { ProductRuntimeEvent } from '../types'
import type { TtrpgRuntimeStateV2 } from './open-runtime-contract'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import { hashProductProductionValueV2 as hash } from '../product-production/hash'
import { hashCanonicalValue, canonicalStringify } from '../agent/run/hash'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import { ttrpgOpenScopedKeyV1 } from './open-coordination'
import { verifyTtrpgOpenBranchLineageV1 } from './open-branch-contract'
import { assertTtrpgOpenVoiceJournalV1, ttrpgOpenVoiceRequestInputV1, ttrpgOpenVoiceReservationPayloadV1,
  ttrpgOpenVoiceCancellationPayloadV1, type TtrpgOpenVoiceRequestV1 } from './open-voice-request-contract'
import * as p from './open-contract-parse'

export async function verifyTtrpgOpenVoiceRequestsV1(input: { runtime: TtrpgRuntimeStateV2; runtimeSourceHash: string; events: readonly ProductRuntimeEvent[] }) {
  const { runtime } = input
  if (!runtime.openRun?.voiceRequests) return
  if (runtime.branchLineage) await verifyTtrpgOpenBranchLineageV1(runtime.branchLineage, runtime.sessionKey)
  assertTtrpgOpenVoiceJournalV1(runtime)
  for (const row of runtime.openRun.voiceRequests) {
    const viewerKey = row.script.scope.issuerViewerKey, ref = row.sourceRef
    await verifyTtrpgOpenVoiceRequestHashesV1(row, ttrpgOpenFrozenSourceHashV1(runtime, ref, input.runtimeSourceHash))
    const ancestor = runtime.branchLineage?.ancestors.find(a => a.sessionKey === ref.sessionKey)
    const check = async (sequence: number, type: string, commandId: string, payload: unknown) => {
      if (ref.sessionKey === runtime.sessionKey) {
        const event = input.events.find(e => e.sequence === sequence)
        if (!event || event.type !== type || event.commandId !== commandId || stable(JSON.parse(event.payloadJson)) !== stable(payload)) p.fail('配音缺少原准确正式事件')
      } else {
        const event = ancestor?.events[sequence - 1]
        if (!ancestor || ancestor.runtimeSourceHash !== row.script.runtimeSourceHash || event?.type !== type || event.payloadHash !== await hash(payload)) p.fail('配音缺少原祖先事件字节')
      }
    }
    await check(ref.sequence, 'ttrpg.audio.voice.reserved', await ttrpgOpenScopedKeyV1(ref.sessionKey, 'voice-request', [viewerKey, row.submissionKey]), ttrpgOpenVoiceReservationPayloadV1(row))
    if (row.cancelledRef) await check(row.cancelledRef.sequence, 'ttrpg.audio.voice.cancelled', await ttrpgOpenScopedKeyV1(ref.sessionKey, 'voice-cancel', [viewerKey, row.requestKey]), ttrpgOpenVoiceCancellationPayloadV1(row, viewerKey))
  }
}

export async function verifyTtrpgOpenVoiceRequestHashesV1(row: TtrpgOpenVoiceRequestV1, runtimeSourceHash: string) {
  const viewerKey = row.script.scope.issuerViewerKey, ref = row.sourceRef
  if (row.script.runtimeSourceHash !== runtimeSourceHash || row.scriptHash !== await hashCanonicalValue(row.script)
      || row.textHash !== await sha256Text(row.script.text) || row.part.textHash !== await sha256Text(row.script.text.slice(row.part.textOffset, row.part.textOffset + row.part.textLength))
      || row.inputArtifactHash !== await sha256Text(canonicalStringify(ttrpgOpenVoiceRequestInputV1(row)))
      || row.requestKey !== await ttrpgOpenScopedKeyV1(ref.sessionKey, 'voice-request-id', [viewerKey, row.submissionKey])) p.fail('配音原文、片段、请求身份或输入工件不一致')
}
