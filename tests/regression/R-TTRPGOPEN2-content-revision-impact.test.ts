import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { openContentRevisionFixtureV1 } from '../helpers/open-ttrpg-content-revision'
import { inspectTtrpgOpenContentRevisionImpactV1 as inspect } from '../../src/lib/ttrpg/open-production-content-revision-impact'
import * as registry from '../../src/lib/agent/skill-registry'
import { parseProductProductionPlanV3 } from '../../src/lib/product-production/plan'
import { parseProductProductionCommandV1 } from '../../src/lib/product-production/contracts'
const snapshot = async () => JSON.stringify({ builds: await db.productBuilds.toArray(), productions: await db.productProductions.toArray(),
  commands: await db.productProductionCommands.toArray(), runs: await db.agentRuns.toArray(), artifacts: await db.productBuildArtifacts.toArray(),
  raw: await db.agentRunArtifacts.toArray() })
beforeEach(async () => { await db.delete(); await db.open(); vi.stubGlobal('fetch', vi.fn(async () => { throw Error('No provider transport in execution drift fixture') })) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); db.close() })
async function fixture() {
  const f = await openContentRevisionFixtureV1(), build = (await db.productBuilds.get(f.buildId))!, p = (await db.productProductions.get(f.productionId))!
  const plan = parseProductProductionPlanV3(build.planJson), artifact = (await db.productBuildArtifacts.where('buildId').equals(f.buildId).toArray())
    .find(row => row.artifactKey === 'ttrpg.open.situation-layer' && row.controlEpoch === plan.controlEpoch && ['accepted', 'carried-forward'].includes(row.status))!
  const draft = JSON.parse(artifact.payloadJson)
  draft.metadata.visualBible.characters[0].expressionBaselines = [{ expressionKey: 'neutral', prompt: '平静注视前方' }]
  const command = { type: 'resume' as const, commandId: 'explicit.repair.impact', expectedStateRevision: p.stateRevision,
    ttrpgContentRevision: { artifactKey: 'ttrpg.open.situation-layer' as const, expectedArtifactVersion: artifact.version,
      expectedArtifactHash: artifact.contentHash, expectedPlanHash: build.planHash, expectedControlEpoch: build.controlEpoch,
      note: '单独核对实际影响后的作者修订', authorDraftJson: JSON.stringify(draft) } }
  const input = { scope: f.scope, buildId: f.buildId, plan, fromControlEpoch: plan.controlEpoch,
    sourcePlanHash: build.planHash, artifactKey: 'ttrpg.open.situation-layer' as const }
  return { ...f, send: f.command, command, build, plan, input }
}
function drift() {
  const original = registry.getAgentSkillV1
  vi.spyOn(registry, 'getAgentSkillV1').mockImplementation((...args) => {
    const skill = original(...args)
    return skill.id.startsWith('product-production.ttrpg-open-') ? { ...skill, promptVersion: skill.promptVersion + '.impact-fixture' } : skill
  })
}
it('includes upstream execution drift in the same dependency closure and remains read-only', async () => {
  const f = await fixture(), before = await snapshot(), baseline = await inspect(f.input)
  expect(baseline.additionalTaskKeys).toEqual([]); expect(baseline.tasks.filter(task => task.execution === 'model')).toHaveLength(0)
  drift(); const changed = await inspect(f.input)
  expect(changed.additionalTaskKeys).toEqual(['ttrpg.open.rule-system', 'ttrpg.open.source-facts'])
  expect(changed.tasks.filter(task => task.execution === 'model').map(task => task.taskKey)).toEqual(['ttrpg.open.source-facts', 'ttrpg.open.rule-system'])
  expect(changed.impactHash).not.toBe(baseline.impactHash); expect(await snapshot()).toBe(before)
  await expect(baseline.assertCurrent()).rejects.toThrow('执行版本'); expect(fetch).not.toHaveBeenCalled()
}, 30000)
it('rejects legacy unpreviewed drift and a stale or malformed impact hash before any resume write', async () => {
  const f = await fixture(), original = await inspect(f.input); drift(); const before = await snapshot()
  await expect(f.send(f.command)).rejects.toThrow('上游执行版本')
  await expect(f.send({ ...f.command, ttrpgContentRevision: { ...f.command.ttrpgContentRevision, expectedImpactHash: original.impactHash } })).rejects.toThrow('上游执行版本')
  expect(() => parseProductProductionCommandV1({ ...f.command, ttrpgContentRevision: { ...f.command.ttrpgContentRevision, expectedImpactHash: 'bad' } })).toThrow('影响 Hash')
  expect(await snapshot()).toBe(before); expect(f.calls).toHaveLength(3)
}, 30000)
it('checks the frozen preview again at scheduler entry when bindings change after the explicit resume commits', async () => {
  const f = await fixture(), impact = await inspect(f.input)
  expect((await f.send({ ...f.command, ttrpgContentRevision: { ...f.command.ttrpgContentRevision, expectedImpactHash: impact.impactHash } })).ok).toBe(true)
  drift(); await expect(f.run()).rejects.toThrow('上游执行版本')
  expect(f.calls).toHaveLength(3); expect(fetch).not.toHaveBeenCalled()
  expect((await db.productBuildArtifacts.where('buildId').equals(f.buildId).toArray()).some(row => row.controlEpoch > f.plan.controlEpoch)).toBe(false)
}, 30000)
it('keeps the current Build paused even with a matching hash when upstream regeneration would defer the author draft', async () => {
  const f = await fixture(); drift(); const impact = await inspect(f.input), before = await snapshot()
  await expect(f.send({ ...f.command, ttrpgContentRevision: { ...f.command.ttrpgContentRevision, expectedImpactHash: impact.impactHash } })).rejects.toThrow('新一轮制作')
  expect(await snapshot()).toBe(before); expect(f.calls).toHaveLength(3)
  expect((await db.productProductions.get(f.productionId))!.status).toBe('paused'); expect(fetch).not.toHaveBeenCalled()
}, 30000)

it('invalidates the prepared effect on an evidence race and refuses a foreign Work without rewriting the old data', async () => {
  const f = await fixture(), impact = await inspect(f.input), before = await snapshot()
  await expect(inspect({ ...f.input, scope: { ...f.scope, workId: f.scope.workId + 1 } })).rejects.toThrow('作用域')
  expect(await snapshot()).toBe(before)
  const producer = (await db.agentRuns.where('productBuildId').equals(f.buildId).toArray()).find(row => row.status === 'completed')!
  await db.agentRuns.update(producer.id!, { updatedAt: producer.updatedAt + 1 })
  await expect(impact.assertCurrent()).rejects.toThrow('恢复证据已变化')
  expect(f.calls).toHaveLength(3); expect(fetch).not.toHaveBeenCalled()
}, 30000)
