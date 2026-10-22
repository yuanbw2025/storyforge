import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { openContentRevisionFixtureV1 } from '../helpers/open-ttrpg-content-revision'
import { inspectTtrpgOpenContentRevisionV1 as inspect, readTtrpgOpenContentRevisionDraftV1 as read,
  prepareTtrpgOpenContentRevisionProposalV1 as prepare, submitTtrpgOpenContentRevisionV1 as submit } from '../../src/lib/ttrpg/open-production-content-revision-service'
import * as registry from '../../src/lib/agent/skill-registry'
beforeEach(async () => { await db.delete(); await db.open(); vi.stubGlobal('fetch', vi.fn(async () => { throw Error('No provider in effect preview facade fixture') })) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close() })
const snapshot = async () => JSON.stringify({ builds: await db.productBuilds.toArray(), productions: await db.productProductions.toArray(),
  commands: await db.productProductionCommands.toArray(), artifacts: await db.productBuildArtifacts.toArray(), runs: await db.agentRuns.toArray(), raw: await db.agentRunArtifacts.toArray() })
async function fixture() {
  const f = await openContentRevisionFixtureV1(), build = (await db.productBuilds.get(f.buildId))!, p = (await db.productProductions.get(f.productionId))!
  const owner = (await inspect({ scope: f.scope, productionId: f.productionId, buildId: f.buildId, controlEpoch: build.controlEpoch,
    expectedStateRevision: p.stateRevision, planHash: build.planHash })).owner
  const source = await read({ owner, artifactKey: 'ttrpg.open.situation-layer' }), draft = JSON.parse(source.authorDraftJson)
  draft.metadata.visualBible.characters[0].expressionBaselines = [{ expressionKey: 'neutral', prompt: '平静注视前方' }]
  return { ...f, source, authorDraftJson: JSON.stringify(draft), note: '核对真实影响，不隐藏额外上游工作', commandId: 'effect.facade.explicit' }
}
function drift() {
  const original = registry.getAgentSkillV1
  vi.spyOn(registry, 'getAgentSkillV1').mockImplementation((...args) => {
    const skill = original(...args)
    return skill.id.startsWith('product-production.ttrpg-open-') ? { ...skill, promptVersion: skill.promptVersion + '.effect-fixture' } : skill
  })
}
it('freezes and displays the actual shared upstream drift and model jobs without mutation or provider calls', async () => {
  const f = await fixture(); drift(); const before = await snapshot(), proposal = await prepare(f)
  expect(proposal.blockedReason).toBe('upstream-version-changed')
  expect(proposal.additionalTaskKeys).toEqual(['ttrpg.open.rule-system', 'ttrpg.open.source-facts'])
  expect(proposal.tasks.filter(row => row.execution === 'model').map(row => row.taskKey)).toEqual(['ttrpg.open.source-facts', 'ttrpg.open.rule-system'])
  expect(proposal.command.ttrpgContentRevision?.expectedImpactHash).toMatch(/^[0-9a-f]{64}$/)
  await expect(submit(proposal)).rejects.toThrow('上游执行版本')
  expect(await snapshot()).toBe(before); expect(f.calls).toHaveLength(3); expect(fetch).not.toHaveBeenCalled()
}, 30000)
it('refuses stale or tampered displayed effects before committing resume and requires a fresh explicit preview', async () => {
  const f = await fixture(), proposal = await prepare(f), before = await snapshot()
  expect(proposal.tasks.filter(row => row.execution === 'model')).toHaveLength(0)
  await expect(submit({ ...proposal, tasks: [] })).rejects.toThrow('实际影响')
  drift(); await expect(submit(proposal)).rejects.toThrow('实际影响')
  expect(await snapshot()).toBe(before)
  const next = await prepare(f); expect(next.commandHash).not.toBe(proposal.commandHash)
  expect(next.tasks.filter(row => row.execution === 'model')).toHaveLength(2)
  expect(next.blockedReason).toBe('upstream-version-changed')
  expect(f.calls).toHaveLength(3); expect(fetch).not.toHaveBeenCalled()
}, 30000)
