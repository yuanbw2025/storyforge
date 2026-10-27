import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import legacy from '../fixtures/ttrpg-open-pre-p7-prepared-v1.json'
import { importProjectJSON } from '../../src/lib/export/json-export'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { parseTtrpgRuntimeStateV2 } from '../../src/lib/ttrpg/open-runtime-contract'
import { dispatchTtrpgOpenModelCallV1 } from '../../src/lib/ttrpg/runtime-commands'
import { readInstanceAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { resolveScope } from '../../src/lib/workspace/scope'
import { openEnvelopeV1, OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { assertTtrpgOpenFrozenContextSourcesV1 } from '../../src/lib/ttrpg/open-model-purpose-contract'
import { executeTtrpgOpenIntentRequestV1 } from '../../src/lib/ttrpg/open-intent-harness'

describe('R-TTRPGOPEN7 immutable pre-P7 request compatibility', () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => db.close())
  it('restores an actual older prepared request and verifies its exact original source grant before dispatch', async () => {
    const projectId = await importProjectJSON(legacy.backup)
    const session = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())[0]
    const scope = await resolveScope({ scope: { projectId, worldId: session.worldId!, workId: session.workId! } })
    const runtime = parseTtrpgRuntimeStateV2((await readProductRuntimeState(session.id!)).ttrpg)!
    const call = runtime.openRun!.coordination.calls[0]
    expect(call.requestKey).toBe(legacy.requestKey); expect(call.status).toBe('prepared')
    const run = (await db.agentRuns.where('projectId').equals(projectId).toArray()).find(run => run.contractHash === call.runContractHash)!
    const snapshot = await readInstanceAgentRunV1(scope, run.id!)
    expect(snapshot.contract.permissions.contextSourceKeys).toEqual(['ttrpgOpenAuthority', 'ttrpgOpenKnowledge'])
    expect((await dispatchTtrpgOpenModelCallV1({ ...await openEnvelopeV1(session.id!, 'pre-p7.dispatch'), requestKey: call.requestKey, viewerKey: OPEN_HUMAN_VIEWER, runId: run.id! })).sendAuthorized).toBe(true)
  }, 30000)
  it('finishes an older prepared call with its original frozen Skill and no new source grants', async () => {
    const projectId = await importProjectJSON(legacy.backup), session = (await db.productRuntimeSessions.where('projectId').equals(projectId).toArray())[0]
    const scope = await resolveScope({ scope: { projectId, worldId: session.worldId!, workId: session.workId! } })
    const call = parseTtrpgRuntimeStateV2((await readProductRuntimeState(session.id!)).ttrpg)!.openRun!.coordination.calls[0]
    const run = (await db.agentRuns.where('projectId').equals(projectId).toArray()).find(run => run.contractHash === call.runContractHash)!
    let sends = 0
    const result = await executeTtrpgOpenIntentRequestV1({ scope, sessionId: session.id!, viewerKey: OPEN_HUMAN_VIEWER, runId: run.id!, requestKey: call.requestKey,
      runAI: async () => { sends++; return JSON.stringify({ goal: '调查河港', method: null, targetRefs: [], declaredResources: [], declaredAssumptions: [], requestedOutcome: null }) } })
    expect(result.status).toBe('candidate'); expect(sends).toBe(1)
    expect((await readInstanceAgentRunV1(scope, run.id!)).contract.permissions.contextSourceKeys).toEqual(['ttrpgOpenAuthority', 'ttrpgOpenKnowledge'])
  }, 30000)
  it('accepts exact closed generations while rejecting duplicate, foreign, missing and cross-purpose sources', () => {
    expect(assertTtrpgOpenFrozenContextSourcesV1('prose.ttrpg-open-intent', ['ttrpgOpenAuthority', 'ttrpgOpenKnowledge'])).toHaveLength(2)
    expect(assertTtrpgOpenFrozenContextSourcesV1('prose.ttrpg-open-intent', ['ttrpgOpenAuthority', 'ttrpgOpenKnowledge', 'ttrpgOpenActorContext'])).toHaveLength(3)
    for (const keys of [['ttrpgOpenAuthority'], ['ttrpgOpenAuthority', 'ttrpgOpenKnowledge', 'ttrpgOpenGmContext'], ['ttrpgOpenAuthority', 'ttrpgOpenKnowledge', 'ttrpgOpenKnowledge']]) {
      expect(() => assertTtrpgOpenFrozenContextSourcesV1('prose.ttrpg-open-intent', keys)).toThrow(/准确协议权限/)
    }
  })
})
