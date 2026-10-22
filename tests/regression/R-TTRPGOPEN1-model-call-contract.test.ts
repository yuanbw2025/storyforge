import { describe, expect, it } from 'vitest'
import { parseTtrpgOpenModelCallV1, assertTtrpgOpenCallReservationV1, ttrpgOpenCallBudgetV1 } from '../../src/lib/ttrpg/open-model-calls'
import type { TtrpgOpenEpochV1 } from '../../src/lib/ttrpg/open-coordination'
const hash = 'a'.repeat(64)
const raw = { requestKey:'session.a.epoch.1.request.1',authorizationEpochKey:'epoch.1',skillId:'prose.ttrpg-open-intent',runContractHash:hash,
  actorKey:'hero',admissionStateHash:hash,visibilityHash:hash,runtimeSourceHash:hash,
  inputManifestHash:hash,requestHash:hash,stepId:'intent',attempt:1,createdRef:{sessionKey:'session.a',sequence:3},dispatchRef:null,terminalRef:null,status:'prepared',
  reservedInputTokens:10,reservedOutputTokens:10,reservedCostUsd:0.1,providerRequestId:null,responseArtifactHash:null,usage:null,terminalReason:null }
const epoch = { epochKey:'epoch.1',status:'active',budget:{maximumCalls:2,maximumTokens:30,maximumCostUsd:0.2,maximumAiActions:2} } as TtrpgOpenEpochV1
function reserve(calls: ReturnType<typeof parseTtrpgOpenModelCallV1>[], requestKey='next') {
  assertTtrpgOpenCallReservationV1({epoch,calls,requestKey,inputTokens:5,outputTokens:5,maximumCostUsd:0.1})
}
describe('R-TTRPGOPEN1 portable model request lifecycle', () => {
  it('distinguishes reservation from dispatch and requires raw response evidence for success', () => {
    expect(parseTtrpgOpenModelCallV1(raw).status).toBe('prepared')
    expect(() => parseTtrpgOpenModelCallV1({...raw,status:'dispatched'})).toThrow(/证据/)
    expect(() => parseTtrpgOpenModelCallV1({...raw,status:'succeeded',terminalRef:{sessionKey:'session.a',sequence:5}})).toThrow(/证据/)
    expect(() => parseTtrpgOpenModelCallV1({...raw,dispatchRef:{sessionKey:'other',sequence:4},status:'dispatched'})).toThrow(/证据/)
  })
  it('only permits a prepared cancellation with proof of zero external usage', () => {
    const cancellation = {...raw,status:'failed',terminalRef:{sessionKey:'session.a',sequence:4},
      usage:{source:'unknown',inputTokens:0,outputTokens:0,actualCostUsd:0},terminalReason:'cancelled-before-dispatch'}
    expect(parseTtrpgOpenModelCallV1(cancellation).status).toBe('failed')
    expect(() => parseTtrpgOpenModelCallV1({...cancellation,usage:{...cancellation.usage,inputTokens:1}})).toThrow(/证据/)
    expect(() => parseTtrpgOpenModelCallV1({...raw,providerRequestId:'not-dispatched'})).toThrow(/证据/)
  })

  it('holds an unknown dispatched result and refuses fresh requests instead of silently resending', () => {
    const call = parseTtrpgOpenModelCallV1({...raw,status:'unknown',dispatchRef:{sessionKey:'session.a',sequence:4},terminalRef:{sessionKey:'session.a',sequence:5},
      usage:{source:'unknown',inputTokens:null,outputTokens:null,actualCostUsd:null},terminalReason:'interrupted-after-dispatch'})
    expect(ttrpgOpenCallBudgetV1(epoch,[call])).toMatchObject({countedRequests:1,committedOrReservedTokens:20,committedOrReservedCostUsd:0.1,blockedByUnknown:true})
    expect(() => reserve([call])).toThrow(/预算/)
  })
  it('retains request count and actual charges after failure but releases unused token reservation', () => {
    const failed = parseTtrpgOpenModelCallV1({...raw,status:'failed',dispatchRef:{sessionKey:'session.a',sequence:4},terminalRef:{sessionKey:'session.a',sequence:5},
      usage:{source:'provider',inputTokens:5,outputTokens:0,actualCostUsd:0.02},terminalReason:'provider-failure'})
    expect(ttrpgOpenCallBudgetV1(epoch,[failed])).toMatchObject({countedRequests:1,committedOrReservedTokens:5,committedOrReservedCostUsd:0.02})
    expect(() => reserve([failed])).not.toThrow()
    expect(() => reserve([failed],failed.requestKey)).toThrow()
    expect(() => reserve([failed,{...failed,requestKey:'another'}])).toThrow()
  })
  it('records an actual provider overrun instead of erasing the charged result, then refuses more budget', () => {
    const charged = parseTtrpgOpenModelCallV1({...raw,status:'succeeded',dispatchRef:{sessionKey:'session.a',sequence:4},terminalRef:{sessionKey:'session.a',sequence:5},
      responseArtifactHash:hash,usage:{source:'provider',inputTokens:100,outputTokens:50,actualCostUsd:5},terminalReason:'budget-overrun'})
    expect(ttrpgOpenCallBudgetV1(epoch,[charged]).committedOrReservedTokens).toBe(150)
    expect(() => reserve([charged])).toThrow()
  })
})
