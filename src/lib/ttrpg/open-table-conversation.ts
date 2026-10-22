/** Human-authored table discussion. Text is never a rule/fact/knowledge write. */
import type { TtrpgOpenSourceRefV1 } from './open-coordination'
import type { TtrpgOpenAuthorizationV1 } from './open-authorization'
import type { TtrpgRuntimeStateV2 } from './open-runtime-contract'
import { parseTtrpgOpenSourceRefV1 } from './open-coordination'
import { assertTtrpgOpenHumanHostV1 } from './open-authorization'
import { stableProductRuntimeJsonV1 as stable } from '../product/runtime-values'
import * as p from './open-contract-parse'
export type TtrpgOpenTableMessageAudienceV1 = 'party' | 'host-private'
export type TtrpgOpenTableMessageRequestV1 =
  | { kind: 'out-of-character' | 'rules-question'; audience: TtrpgOpenTableMessageAudienceV1; text: string }
  | { kind: 'rules-answer'; questionKey: string; text: string }
export interface TtrpgOpenTableMessageV1 {
  messageKey: string; kind: TtrpgOpenTableMessageRequestV1['kind']; text: string;
  audience: TtrpgOpenTableMessageAudienceV1; recipientViewerKeys: string[];
  authorSeatKey: string; authorViewerKey: string; authorActorKey: string | null;
  questionKey: string | null; authorizationRevision: number; sourceRef: TtrpgOpenSourceRefV1;
}
export function parseTtrpgOpenTableMessageRequestV1(value: unknown): TtrpgOpenTableMessageRequestV1 {
  const r = p.object(value,'table discussion request'),kind = p.oneOf(r.kind,['out-of-character','rules-question','rules-answer'],'discussion kind')
  p.exact(r,kind === 'rules-answer' ? ['kind','questionKey','text'] : ['kind','audience','text'],'discussion request')
  const text = p.text(r.text,'discussion text',10000)
  return kind === 'rules-answer' ? { kind,text,questionKey: p.key(r.questionKey,'question key') }
    : { kind,text,audience: p.oneOf(r.audience,['party','host-private'],'discussion audience') }
}
export function parseTtrpgOpenTableMessageV1(value: unknown): TtrpgOpenTableMessageV1 {
  const r = p.record(value,['messageKey','kind','text','audience','recipientViewerKeys','authorSeatKey','authorViewerKey','authorActorKey','questionKey','authorizationRevision','sourceRef'],'table message')
  const kind = p.oneOf(r.kind,['out-of-character','rules-question','rules-answer'],'message kind'),questionKey = p.nullable(r.questionKey,p.key,'message question')
  const authorViewerKey = p.key(r.authorViewerKey,'message author viewer'),recipientViewerKeys = p.keys(r.recipientViewerKeys,'message recipients',1000,1)
  if ((kind === 'rules-answer') !== (questionKey !== null) || !recipientViewerKeys.includes(authorViewerKey)) p.fail('讨论回复或作者收件人不闭合')
  return { messageKey: p.key(r.messageKey,'message key'),kind,text: p.text(r.text,'message text',10000),questionKey,
    audience: p.oneOf(r.audience,['party','host-private'],'message audience'),recipientViewerKeys,authorViewerKey,
    authorSeatKey: p.key(r.authorSeatKey,'message author seat'),authorActorKey: p.nullable(r.authorActorKey,p.key,'message author actor'),
    authorizationRevision: p.integer(r.authorizationRevision,'message authorization revision',1),sourceRef: parseTtrpgOpenSourceRefV1(r.sourceRef) }
}
export function createTtrpgOpenTableMessageV1(input: {
  authorization: TtrpgOpenAuthorizationV1; viewerKey: string; request: TtrpgOpenTableMessageRequestV1;
  messages: readonly TtrpgOpenTableMessageV1[]; messageKey: string; sourceRef: TtrpgOpenSourceRefV1;
}): TtrpgOpenTableMessageV1 {
  const { authorization,viewerKey,messages,messageKey,sourceRef } = input,request = parseTtrpgOpenTableMessageRequestV1(input.request)
  const seat = authorization.seats.find(s => s.viewerKey === viewerKey)
  if (!seat || seat.controller === 'ai' || seat.assignmentState !== 'claimed' || !['player','gm'].includes(seat.role)) p.fail('讨论只能由当前实际真人席位提交')
  let audience: TtrpgOpenTableMessageAudienceV1,recipients: string[]
  if (request.kind === 'rules-answer') {
    assertTtrpgOpenHumanHostV1(authorization,viewerKey)
    const question = messages.find(m => m.messageKey === request.questionKey)
    if (!question || question.kind !== 'rules-question' || !question.recipientViewerKeys.includes(viewerKey)) p.fail('主持只能回复自己有权看到的实际规则问题')
    audience = question.audience;recipients = [...question.recipientViewerKeys]
  } else {
    audience = request.audience
    const human = authorization.seats.filter(s => s.controller !== 'ai' && s.assignmentState === 'claimed' && ['player','gm'].includes(s.role))
    const host = human.find(s => { try { assertTtrpgOpenHumanHostV1(authorization,s.viewerKey);return true } catch { return false } })
    if (audience === 'host-private' && !host) p.fail('当前没有可接收私密询问的真人主持')
    recipients = audience === 'party' ? human.map(s => s.viewerKey) : [viewerKey,host!.viewerKey]
  }
  if (messages.some(m => m.messageKey === messageKey)) p.fail('讨论身份已使用')
  return parseTtrpgOpenTableMessageV1({ messageKey,kind: request.kind,text: request.text,audience,recipientViewerKeys: [...new Set(recipients)].sort(),
    authorSeatKey: seat.seatKey,authorViewerKey: viewerKey,authorActorKey: seat.actorKey,
    questionKey: request.kind === 'rules-answer' ? request.questionKey : null,authorizationRevision: authorization.revision,sourceRef })
}
export function assertTtrpgOpenTableMessageHistoryV1(runtime: TtrpgRuntimeStateV2): void {
  const messages = runtime.openRun?.tableMessages ?? []
  if (new Set(messages.map(m => m.messageKey)).size !== messages.length
    || new Set(messages.map(m => JSON.stringify(m.sourceRef))).size !== messages.length) p.fail('讨论消息身份或真实事件来源重复')
  for (const [index,message] of messages.entries()) {
    if (message.questionKey) {
      const question = messages.slice(0,index).find(m => m.messageKey === message.questionKey)
      if (!question || question.kind !== 'rules-question' || question.audience !== message.audience
        || stable(question.recipientViewerKeys) !== stable(message.recipientViewerKeys)) p.fail('规则回复不得扩大原问题受众')
    }
    if (message.sourceRef.sessionKey !== runtime.sessionKey && !runtime.branchLineage?.ancestors.some(a => a.sessionKey === message.sourceRef.sessionKey
      && a.throughSequence >= message.sourceRef.sequence && a.snapshot.openRun?.tableMessages?.some(m => stable(m) === stable(message)))) p.fail('讨论缺少真实祖先切点证据')
  }
}
