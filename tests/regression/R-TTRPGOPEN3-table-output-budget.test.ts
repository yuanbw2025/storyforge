import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readyOpenTtrpgSessionV1, OPEN_HUMAN_VIEWER } from '../helpers/open-ttrpg-session'
import { requestTtrpgOpenTableCandidateV1 } from '../../src/lib/ttrpg/open-table-service'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import * as harness from '../../src/lib/ttrpg/open-intent-harness'
import type { AIConfig } from '../../src/lib/types'

beforeEach(async () => { await db.delete(); await db.open() })
afterEach(() => { vi.restoreAllMocks(); db.close() })
it.each([2000, 800])('freezes a usable actor request within both the campaign output limit %s and the registered Skill', async limit => {
  const f = await readyOpenTtrpgSessionV1('table actor output budget', pkg => {
    pkg.ttrpg!.campaign.runtimePolicy.enabled = true; pkg.ttrpg!.campaign.runtimePolicy.maximumEpochTokens = 50000
    pkg.ttrpg!.campaign.runtimePolicy.maximumOutputTokens = limit
  }), before = await readProductRuntimeState(f.sessionId)
  const original = harness.generateTtrpgOpenIntentCandidateV1
  // Replace only provider transport; preparation, dispatch, raw evidence,
  // exact frozen call, candidate and remaining budgets are real fixture code.
  const raw = JSON.stringify({ goal: '观察公开环境', method: '调查', targetRefs: [], declaredResources: [], declaredAssumptions: [], requestedOutcome: null })
  const transport = vi.fn(async () => raw)
  vi.spyOn(harness, 'generateTtrpgOpenIntentCandidateV1').mockImplementation(input => original({ ...input, aiConfig: undefined, runAI: transport }))
  await requestTtrpgOpenTableCandidateV1({ scope: f.scope, sessionId: f.sessionId, viewerKey: OPEN_HUMAN_VIEWER,
    purpose: 'intent', rawInput: '观察公开环境，不移动或读取秘密', maximumCostUsd: 0.1, aiConfig: {} as AIConfig })
  const after = await readProductRuntimeState(f.sessionId), calls = after.ttrpg!.openRun!.coordination.calls
  expect(calls).toHaveLength(1); expect(calls[0]).toMatchObject({ status: 'succeeded', reservedOutputTokens: Math.min(limit, 1200), reservedCostUsd: 0.1 })
  expect(transport).toHaveBeenCalledTimes(1)
  expect(after.entities).toEqual(before.entities); expect(after.ttrpg!.openRun!.worldTime).toEqual(before.ttrpg!.openRun!.worldTime)
  const row = await db.agentRunArtifacts.where('[projectId+artifactKind+contentHash]').equals([f.scope.projectId, 'raw-response', calls[0].responseArtifactHash!]).first()
  expect(row?.content).toBe(raw)
}, 30000)
