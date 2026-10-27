import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import * as service from '../../src/lib/product-production/service'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { readTtrpgOpenProductionReviewDraftV1, type TtrpgOpenProductionReviewOwnerV1 } from '../../src/lib/ttrpg/open-production-review-service'
import { normalizeTtrpgOpenSourceFactsForReviewV1, normalizeTtrpgOpenRuleSystemForReviewV1,
  parseTtrpgOpenProductionReviewDraftV1 } from '../../src/lib/ttrpg/open-production-review'
import { seedOpenBrowserProductionV1, runOpenBrowserProductionV1 } from '../helpers/open-ttrpg-production-browser'
import { openProductionCompilerFixtureV1 } from '../helpers/open-ttrpg-production-artifacts'

beforeEach(async () => { await db.delete(); await db.open() })
afterEach(() => { vi.restoreAllMocks(); db.close() })
async function blocked(role = false) {
  const f = await seedOpenBrowserProductionV1()
  await runOpenBrowserProductionV1(f)
  if (role) await runOpenBrowserProductionV1(f, true)
  const details = await service.readProductProductionDetailsV1(f.scope, f.productionId)
  const progress = await service.readProductProductionProgressV1(f)
  const taskKey = role ? 'ttrpg.open.rule-system' as const : 'ttrpg.open.source-facts' as const
  const task = progress.tasks.find(item => item.taskKey === taskKey)!, build = details.build!
  const owner: TtrpgOpenProductionReviewOwnerV1 = { ...f, buildId: build.id!, controlEpoch: build.controlEpoch,
    planHash: build.planHash, taskKey, runId: task.runId!, attempt: task.attempt }
  return { ...f, owner, brief: details.executionBrief!.ttrpgOpen!, details }
}
const snapshot = async () => JSON.stringify({ builds: await db.productBuilds.toArray(),
  commands: await db.productProductionCommands.toArray(), events: await db.agentRunEvents.toArray(), worlds: await db.worldReleases.toArray() })

it('reads only the current complete source draft without inference, adoption, accounting or changing the original model flags', async () => {
  const f = await blocked(), original = await service.readProductProductionTaskEvidenceV1(f.owner), before = await snapshot()
  const raw = original.find(row => row.kind === 'raw-response')!
  expect(JSON.parse(raw.content).factPolicy.some((item: { authorConfirmed: boolean }) => item.authorConfirmed)).toBe(true)
  const draft = parseTtrpgOpenProductionReviewDraftV1(f.owner.taskKey, await readTtrpgOpenProductionReviewDraftV1(f.owner), f.brief)
  expect(draft.kind).toBe('facts')
  if (draft.kind !== 'facts') throw Error('wrong draft kind')
  expect(draft.artifact.factPolicy.some(item => !item.authorConfirmed)).toBe(true)
  expect(await service.readProductProductionTaskEvidenceV1(f.owner)).toEqual(original)
  expect(await snapshot()).toBe(before)
}, 30000)

it('retains exactly matching locked facts but never accepts a model confirmation of a changed fact', async () => {
  const f = await blocked(), data = await openProductionCompilerFixtureV1(true, { ...f, brief: f.details.executionBrief! })
  const input = structuredClone(data.sourceFacts), brief = structuredClone(f.brief)
  brief.settings.openAuthoring.factPolicy = [{ ...structuredClone(input.factPolicy[0]), authorConfirmed: true }]
  const fixed = normalizeTtrpgOpenSourceFactsForReviewV1(input, brief)
  expect(fixed.factPolicy[0].authorConfirmed).toBe(true)
  input.factPolicy[0].fact.canonicalValue = 'different author-unconfirmed fact'
  const changed = normalizeTtrpgOpenSourceFactsForReviewV1(input, brief)
  expect(changed.factPolicy[0].authorConfirmed).toBe(false)
  expect(input.factPolicy[0].authorConfirmed).toBe(true)
}, 30000)

it('preserves all role sheets, private data and derivations while requiring each mapping to be reviewed by the author', async () => {
  const f = await blocked(true), original = await service.readProductProductionTaskEvidenceV1(f.owner), before = await snapshot()
  const raw = JSON.parse(original.find(row => row.kind === 'raw-response')!.content)
  const draft = parseTtrpgOpenProductionReviewDraftV1(f.owner.taskKey, await readTtrpgOpenProductionReviewDraftV1(f.owner), f.brief)
  expect(draft.kind).toBe('rules')
  if (draft.kind !== 'rules') throw Error('wrong draft kind')
  expect(draft.artifact).toEqual(normalizeTtrpgOpenRuleSystemForReviewV1(raw, f.brief))
  expect(draft.artifact.characterTemplates.every(actor => Object.values(actor.attributeMappings).every(mapping => !mapping.authorConfirmed))).toBe(true)
  expect(await snapshot()).toBe(before)
}, 30000)

it('refuses other Work, Build, Plan, epoch, Run or attempt without changing any durable owner state', async () => {
  const f = await blocked(), before = await snapshot()
  const wrong = [ { scope: { ...f.scope, workId: f.scope.workId! + 1 } }, { buildId: f.owner.buildId + 1 },
    { planHash: 'f'.repeat(64) }, { controlEpoch: f.owner.controlEpoch + 1 }, { runId: f.owner.runId + 1 }, { attempt: f.owner.attempt + 1 } ]
  for (const delta of wrong) await expect(readTtrpgOpenProductionReviewDraftV1({ ...f.owner, ...delta })).rejects.toThrow()
  expect(await snapshot()).toBe(before)
}, 30000)

it('deduplicates identical retained bytes but refuses conflicting complete answers instead of choosing the newest', async () => {
  const f = await blocked(), rows = await service.readProductProductionTaskEvidenceV1(f.owner), raw = rows.find(row => row.kind === 'raw-response')!
  const spy = vi.spyOn(service, 'readProductProductionTaskEvidenceV1').mockResolvedValue([...rows, raw])
  await expect(readTtrpgOpenProductionReviewDraftV1(f.owner)).resolves.toContain('storyforge.ttrpg-open-source-facts')
  spy.mockResolvedValue([...rows, { ...raw, content: raw.content + ' ' }])
  await expect(readTtrpgOpenProductionReviewDraftV1(f.owner)).rejects.toThrow('不同版本')
}, 30000)

it('refuses an unknown or timed-out task even when its old bytes happen to parse as a complete object', async () => {
  const f = await blocked(), build = f.details.build!, failure = JSON.parse(build.failureJson)
  for (const code of ['task-result-unknown', 'task-timeout', 'task-aborted']) {
    await db.productBuilds.update(build.id!, { failureJson: JSON.stringify({ ...failure, code }) })
    await expect(readTtrpgOpenProductionReviewDraftV1(f.owner)).rejects.toThrow()
  }
}, 30000)

it('rejects a result if the author command revision changes while exact task evidence is being read', async () => {
  const f = await blocked(), rows = await service.readProductProductionTaskEvidenceV1(f.owner)
  vi.spyOn(service, 'readProductProductionTaskEvidenceV1').mockImplementation(async () => {
    await db.productProductions.update(f.productionId, { stateRevision: f.details.production.stateRevision + 1 })
    return rows
  })
  await expect(readTtrpgOpenProductionReviewDraftV1(f.owner)).rejects.toThrow('读取期间')
}, 30000)

it.each([false, true])('reloads retained author input after an ordinary zero-model review rejection without granting confirmation (role=%s)', async role => {
  const f = await blocked(role), data = await openProductionCompilerFixtureV1(true, { ...f, brief: f.details.executionBrief! })
  const draft = role ? normalizeTtrpgOpenRuleSystemForReviewV1(data.ruleSystem, f.brief)
    : normalizeTtrpgOpenSourceFactsForReviewV1(data.sourceFacts, f.brief)
  if ('characterTemplates' in draft) {
    draft.characterTemplates[0].description += ' 作者保留的修订说明。'
    Object.values(draft.characterTemplates[0].attributeMappings)[0].authorConfirmed = true
  }
  const production = (await db.productProductions.get(f.productionId))!
  await executeProductProductionCommand({ scope: f.scope, productionId: f.productionId, command: {
    type: 'resolve-blocker', commandId: 'ordinary.author-input.review', expectedStateRevision: production.stateRevision,
    blockerKey: f.owner.taskKey, resolution: { action: 'author-edit', note: '保存完整作者修订，余下确认仍待逐项核对', authorDraftJson: JSON.stringify(draft) },
  } })
  await runOpenBrowserProductionV1(f)
  const details = await service.readProductProductionDetailsV1(f.scope, f.productionId)
  const progress = await service.readProductProductionProgressV1(f), task = progress.tasks.find(t => t.taskKey === f.owner.taskKey)!
  const owner = { ...f.owner, controlEpoch: details.build!.controlEpoch, planHash: details.build!.planHash, runId: task.runId!, attempt: task.attempt }
  const rows = await service.readProductProductionTaskEvidenceV1(owner)
  expect(rows.some(row => row.kind === 'raw-response')).toBe(false)
  const before = await snapshot(), expected = role ? normalizeTtrpgOpenRuleSystemForReviewV1(draft, f.brief)
    : normalizeTtrpgOpenSourceFactsForReviewV1(draft, f.brief)
  expect(JSON.parse(await readTtrpgOpenProductionReviewDraftV1(owner))).toEqual(expected)
  expect(await snapshot()).toBe(before)
  db.close(); await db.open()
  expect(JSON.parse(await readTtrpgOpenProductionReviewDraftV1(owner))).toEqual(expected)
  expect(await snapshot()).toBe(before)
}, 30000)
