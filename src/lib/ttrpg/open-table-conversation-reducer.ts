import type { ProductRuntimeEvent,ProductRuntimeState } from '../types'
import type { ProductRuntimeJsonObjectV1 } from '../product/runtime-values'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import { parseTtrpgRuntimeStateV2 } from './open-runtime-contract'
import { createTtrpgOpenTableMessageV1,parseTtrpgOpenTableMessageRequestV1,parseTtrpgOpenTableMessageV1 } from './open-table-conversation'
import * as p from './open-contract-parse'
export function applyTtrpgOpenTableMessageEventV1(state: ProductRuntimeState,event: ProductRuntimeEvent,payload: ProductRuntimeJsonObjectV1): boolean {
  if (event.type !== 'ttrpg.open.table-message.posted') return false
  p.exact(payload,['message','intent'],'table message payload')
  const runtime = parseTtrpgRuntimeStateV2(state.ttrpg)
  if (!runtime?.openRun || !runtime.authorization || !runtime.product.sessionZero.completed) p.fail('讨论需要实际开团授权')
  const intent = p.record(payload.intent,['viewerKey','submissionKey','request'],'table message intent'),message = parseTtrpgOpenTableMessageV1(payload.message)
  p.key(intent.submissionKey,'message submission')
  const expected = createTtrpgOpenTableMessageV1({ authorization: runtime.authorization,viewerKey: p.key(intent.viewerKey,'message viewer'),
    request: parseTtrpgOpenTableMessageRequestV1(intent.request),messages: runtime.openRun.tableMessages ?? [],messageKey: message.messageKey,
    sourceRef: { sessionKey: runtime.sessionKey,sequence: event.sequence } })
  if (stable(expected) !== stable(message) || event.actorKey !== message.authorActorKey || event.targetKey !== null) p.fail('讨论作者、回复范围或真实事件来源不一致')
  runtime.openRun.tableMessages = [...(runtime.openRun.tableMessages ?? []),message];state.ttrpg = runtime
  return true
}
