/** Registered original text only. No caller prose, prompt, header, catalog,
 * clipping, normalization, model send, adoption, or bookkeeping repair. */
import type { AssembleContextInput } from '../registry/types'
import { finishTtrpgOpenVoiceIntentForKernelV1 } from './open-voice-intent-receipt'
import { createTtrpgOpenVoiceScriptV1 } from './open-audio-contract'
import { canonicalStringify } from '../agent/run/hash'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import * as p from './open-contract-parse'

export async function readTtrpgOpenVoiceTextSourceV1(request: AssembleContextInput): Promise<string> {
  if (!request.scope || !request.productRuntimeSessionId || !request.ttrpgVoiceRequest) p.fail('配音来源需要当前作用域、实例及准确原请求')
  const scope = structuredClone(request.scope), sessionId = request.productRuntimeSessionId
  const locator = structuredClone(request.ttrpgVoiceRequest)
  const viewerKey = p.key(locator.viewerKey, 'voice source viewer'), requestKey = p.key(locator.requestKey, 'voice source request')
  const receiptHash = p.hash(locator.intentReceiptHash, 'voice intent receipt')
  const verified = await finishTtrpgOpenVoiceIntentForKernelV1({ scope, sessionId, viewerKey, requestKey }, true)
  if (verified.receipt.receiptHash !== receiptHash) p.fail('配音来源必须绑定原准确记账回执')
  const row = verified.request, loaded = verified.owner
  const current = createTtrpgOpenVoiceScriptV1({ runtime: loaded.runtime, runtimeSourceHash: loaded.session.runtimeSourceHash, viewerKey,
    narrationSourceRef: row.script.narrationSourceRef, audience: row.script.scope.audience, privateActorKey: row.script.scope.privateActorKey })
  if (canonicalStringify(current) !== canonicalStringify(row.script)) p.fail('原配音文字、接收者或授权已变化，须重新审阅')
  const text = current.text.slice(row.part.textOffset, row.part.textOffset + row.part.textLength)
  if (await sha256Text(text) !== row.part.textHash) p.fail('原配音准确片段已变化')
  await loaded.assertCurrent()
  return text
}
