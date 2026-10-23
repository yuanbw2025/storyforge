import { beforeEach, afterAll, describe, it, expect } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readTextOpenWorldExperienceV1, projectTextOpenWorldExperienceV1, createTextOpenWorldExperienceFeedbackV1 } from '../../src/lib/open-world/experience-feedback'
import { generateTextOpenWorldRuntimeIntentV1 } from '../../src/lib/open-world/runtime-intent'
import { executeTextOpenWorldActionV1 } from '../../src/lib/open-world/action-executor'
import { readProductRuntimeState } from '../../src/lib/open-world/runtime-api'
import { createTextOpenWorldCheckpointV1, branchTextOpenWorldSessionFromCheckpointV1 } from '../../src/lib/open-world/checkpoints'
import { createGovernedTextOpenWorldSessionFixtureV1 } from '../helpers/text-open-world-product-session'
import { createTextOpenWorldVNextP9Fixture } from '../helpers/text-open-world-vnext-fixture'

beforeEach(async () => { await db.delete(); await db.open() })
afterAll(() => db.close())
const fixture = () => createGovernedTextOpenWorldSessionFixtureV1({ name: 'W7 local feedback',
  textOpenWorldVNext: createTextOpenWorldVNextP9Fixture(), runtimeShape: 'vnext-only', title: '工程夹具', seed: 'w7-fixture' })

describe('W7 local experience feedback', () => {
  it('reads real events and verified mock intent candidates, exports no source text and never writes gameplay state', async () => {
    const created = await fixture(), sessionId = created.session.id!
    const input = { scope: created.scope, sessionId }
    const initial = await readTextOpenWorldExperienceV1(input)
    expect(initial.mainline.steps).toBe(0)
    expect(initial.mainline.wallClockSpanMinutes).toBeNull()
    const generate = (unsupported: boolean) => generateTextOpenWorldRuntimeIntentV1({
      scope: created.scope, productRuntimeSessionId: sessionId, selectedSceneKey: 'scene.offer.main',
      utterance: 'PRIVATE_INPUT_DO_NOT_EXPORT', runAI: async () => JSON.stringify({
        kind: unsupported ? 'unsupported' : 'mapped-choice', confidence: 0.98,
        actionKeys: [], choiceKeys: unsupported ? [] : ['choice.accept-main'], extractedArguments: { targetKey: null },
        rationale: 'PRIVATE_MODEL_TEXT', requiresConfirmation: false,
        boundaryExplanation: unsupported ? 'PRIVATE_BOUNDARY' : null, replyText: 'PRIVATE_REPLY',
      }),
    }, 60_000)
    await generate(true)
    const result = await generate(false)
    const option = result.options[0]
    await executeTextOpenWorldActionV1({ sessionId, actionKey: option.actionKey, targetKey: option.targetKey,
      source: 'mapped-intent', expectedBaseSequence: result.baseSequence, runtimeIntentAuthorization: option.authorization,
      commandId: 'w7.accept', requestedAt: Date.now() })
    const beforeState = await readProductRuntimeState(sessionId)
    const beforeEvents = await db.productRuntimeEvents.where('sessionId').equals(sessionId).toArray()
    const summary = await readTextOpenWorldExperienceV1(input)
    expect(summary.mainline.steps).toBeGreaterThan(0)
    expect(summary.freeInput).toMatchObject({ mappingOffered: 1, mappedCommands: 1, boundaryResponses: 1, mainlineAfterBoundary: 1, unavailableRuns: 0 })
    const feedback = await createTextOpenWorldExperienceFeedbackV1({ summary, category: 'quest',
      note: '工程模拟：主线按钮说明不够清楚', sourceTextExcluded: true })
    expect(feedback.formalAcceptance).toBe(false)
    expect(JSON.stringify(feedback)).not.toMatch(/PRIVATE_|payloadJson|sessionId|projectId|scene\.offer/)
    expect(await readProductRuntimeState(sessionId)).toEqual(beforeState)
    expect(await db.productRuntimeEvents.where('sessionId').equals(sessionId).toArray()).toEqual(beforeEvents)
    expect(await readTextOpenWorldExperienceV1(input)).toEqual(summary)
    await expect(createTextOpenWorldExperienceFeedbackV1({ summary, category: 'quest', note: '很短', sourceTextExcluded: true })).rejects.toThrow()
  }, 60_000)
  it('counts travel while keeping old releases and inherited branches separate; rejects partial event snapshots', async () => {
    const created = await fixture(), sessionId = created.session.id!
    for (const [index, [actionKey, targetKey]] of [
      ['action.travel-port-ridge', 'location.ridge-channel'], ['action.fast-travel', 'location.salt-port'],
    ].entries()) await executeTextOpenWorldActionV1({ sessionId, actionKey, targetKey, commandId: `w7.travel.${index}`, requestedAt: Date.now() })
    const input = { scope: created.scope, sessionId }
    const summary = await readTextOpenWorldExperienceV1(input)
    expect(summary.map).toMatchObject({ fastTravel: 1, knownVisitedLocations: 2 })
    const state = await readProductRuntimeState(sessionId)
    const events = await db.productRuntimeEvents.where('sessionId').equals(sessionId).toArray()
    await expect(projectTextOpenWorldExperienceV1({ session: { ...created.session, id: sessionId },
      projection: state.textOpenWorld!, throughSequence: state.lastSequence, events: events.slice(1), intents: { observations: [], unavailable: 0 } })).rejects.toThrow('同步')
    const checkpoint = await createTextOpenWorldCheckpointV1({ sessionId, name: 'W7 branch' })
    const child = await branchTextOpenWorldSessionFromCheckpointV1({ checkpointId: checkpoint.id!, title: 'W7 child', seed: 'w7-child' })
    const childSummary = await readTextOpenWorldExperienceV1({ scope: created.scope, sessionId: child.id! })
    expect(childSummary).toMatchObject({ inheritedFromBranch: true, map: { fastTravel: 0, knownVisitedLocations: 2 }, mainline: { wallClockSpanMinutes: null } })
    expect(await readTextOpenWorldExperienceV1(input)).toEqual(summary)
  }, 60_000)
})
