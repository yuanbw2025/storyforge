import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readProductRuntimeState } from '../../src/lib/product/runtime-core'
import { readyOpenTtrpgSessionV1, OPEN_HUMAN_VIEWER, openEnvelopeV1 } from '../helpers/open-ttrpg-session'
import { readTtrpgOpenConsultationDeskV1, startTtrpgOpenConsultationDeskV1, consultTtrpgOpenConsultationDeskV1, closeTtrpgOpenConsultationDeskV1 } from '../../src/lib/ttrpg/open-consultation-desk'
import { changeTtrpgSafetyStatus, startTtrpgOpenEpochV1 } from '../../src/lib/ttrpg/runtime-commands'
import { seedTtrpgOpenBriefDeskV1 } from '../helpers/open-ttrpg-brief-desk'
import { requestTtrpgOpenBriefDeskV1, finishTtrpgOpenBriefDeskV1 } from '../../src/lib/ttrpg/open-brief-service'

describe('R-TTRPGOPEN15 normal template-independent Oracle consultation', { timeout: 120000 }, () => {
  beforeEach(async () => { await db.delete(); await db.open() }); afterEach(() => db.close())
  async function setup(enableModel = false, humanGm = false) {
    const f = await readyOpenTtrpgSessionV1('normal Oracle', pkg => {
      pkg.ttrpg!.campaign.runtimePolicy.enabled = enableModel
      if (humanGm) pkg.ttrpg!.campaign.gmMode = 'human'
      const secret = structuredClone(pkg.ttrpg!.rulePack.content.oracles[0]); secret.oracleKey = 'oracle.gm'; secret.title = 'GM-SECRET-ORACLE'; secret.audience = 'gm-only'
      pkg.ttrpg!.rulePack.content.oracles.push(secret)
    })
    return { f, input: { scope: f.scope, sessionId: f.sessionId, viewerKey: OPEN_HUMAN_VIEWER } }
  }
  const start = (input: Awaited<ReturnType<typeof setup>>['input'], submissionKey = 'start') => startTtrpgOpenConsultationDeskV1({ ...input, submissionKey, decision: 'start-this-consultation-and-sharing' })
  const ask = (input: Awaited<ReturnType<typeof setup>>['input'], submissionKey = 'oracle') => consultTtrpgOpenConsultationDeskV1({ ...input, submissionKey, oracleKey: 'oracle.yes', question: '码头会下雨吗？', likelihoodTierKey: 'even' })
  it('offers an ordinary consultation without dynamic templates, excludes GM tables and does not write during reads', async () => {
    const { f, input } = await setup(), before = await readProductRuntimeState(f.sessionId)
    expect(f.campaign.dynamicEntityTemplates).toEqual([])
    const page = await readTtrpgOpenConsultationDeskV1(input)
    expect(page.canStart).toBe(true); expect(page.canConsult).toBe(false); expect(page.tables.map(row => row.key)).toEqual(['oracle.yes'])
    expect(JSON.stringify(page)).not.toContain('GM-SECRET-ORACLE'); expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
    await expect(startTtrpgOpenConsultationDeskV1({ ...input, submissionKey: 'bad', decision: 'implicit' as 'start-this-consultation-and-sharing' })).rejects.toThrow(/明确/)
    await expect(ask(input)).rejects.toThrow(/不能咨询/)
    expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  })
  it('retains the exact duplicate result, never resets the per-world-turn quota and consumes no model/time/resources', async () => {
    const { f, input } = await setup(), before = await readProductRuntimeState(f.sessionId), world = await db.worldReleases.toArray(), builds = await db.productBuilds.toArray()
    await start(input); const first = await ask(input)
    expect(await ask(input)).toEqual(first)
    await ask(input, 'second')
    const exhausted = await readProductRuntimeState(f.sessionId)
    expect(await ask(input)).toEqual(first)
    expect(await readProductRuntimeState(f.sessionId)).toEqual(exhausted)
    await closeTtrpgOpenConsultationDeskV1({ ...input, submissionKey: 'close' }); await start(input, 'new-window')
    expect((await readTtrpgOpenConsultationDeskV1(input)).canConsult).toBe(false)
    await expect(ask(input, 'third')).rejects.toThrow(/不能咨询/)
    const after = await readProductRuntimeState(f.sessionId)
    expect(after.ttrpg!.openRun!.oracleReceipts).toHaveLength(2); expect(after.entities).toEqual(before.entities)
    expect(after.ttrpg!.openRun!.worldTime).toEqual(before.ttrpg!.openRun!.worldTime)
    expect(await db.worldReleases.toArray()).toEqual(world); expect(await db.productBuilds.toArray()).toEqual(builds); expect(await db.agentRuns.count()).toBe(0)
  })
  it('rejects foreign scope, AI identity, hidden tables and paused consultation without changing the original result', async () => {
    const { f, input } = await setup(); await start(input)
    await expect(readTtrpgOpenConsultationDeskV1({ ...input, scope: { ...input.scope, projectId: 'foreign-project' } })).rejects.toThrow()
    await expect(readTtrpgOpenConsultationDeskV1({ ...input, viewerKey: 'viewer.gm' })).rejects.toThrow()
    await expect(consultTtrpgOpenConsultationDeskV1({ ...input, submissionKey: 'secret', oracleKey: 'oracle.gm', question: '秘密？', likelihoodTierKey: 'even' })).rejects.toThrow(/不能咨询/)
    await ask(input)
    await changeTtrpgSafetyStatus({ ...await openEnvelopeV1(f.sessionId, 'pause'), viewerKey: input.viewerKey, changedBy: input.viewerKey, status: 'paused', reason: '暂停核对' })
    const before = await readProductRuntimeState(f.sessionId)
    expect((await readTtrpgOpenConsultationDeskV1(input)).canConsult).toBe(false)
    await expect(ask(input, 'paused')).rejects.toThrow(/不能咨询/); expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
  })
  it('does not borrow a passive recap window or close it through the ordinary consultation desk', async () => {
    const { f, input } = await setup(true)
    await startTtrpgOpenEpochV1({ ...await openEnvelopeV1(f.sessionId, 'recap'), viewerKey: input.viewerKey, triggerKind: 'request-brief', rawInput: '只复盘' })
    const page = await readTtrpgOpenConsultationDeskV1(input)
    expect(page.canConsult).toBe(false); expect(page.canClose).toBe(false); expect(page.sharing.canShare).toBe(false)
    await expect(ask(input)).rejects.toThrow(/不能咨询/)
  })
  it('allows the actual human GM to consult their own private table without exposing its question or result to a player', async () => {
    const { input } = await setup(false, true), gm = { ...input, viewerKey: 'viewer.gm' }
    await start(gm)
    await consultTtrpgOpenConsultationDeskV1({ ...gm, submissionKey: 'gm-only', oracleKey: 'oracle.gm', question: 'GM-PRIVATE-QUESTION', likelihoodTierKey: 'even' })
    expect((await readTtrpgOpenConsultationDeskV1(gm)).history).toHaveLength(1)
    const player = await readTtrpgOpenConsultationDeskV1(input)
    expect(player.history).toEqual([]); expect(JSON.stringify(player)).not.toContain('GM-PRIVATE-QUESTION'); expect(JSON.stringify(player)).not.toContain('GM-SECRET-ORACLE')
  })
  it('does not bypass a current unknown result or permanently strand a distinctly closed historical request', async () => {
    const { host, f } = await seedTtrpgOpenBriefDeskV1(); let sends = 0
    await expect(requestTtrpgOpenBriefDeskV1({ ...host, submissionKey: 'unknown', rawInput: '回顾旧港，保留原观察者与推测。', maximumCostUsd: 0.1,
      runAI: async () => { sends++; throw new Error('unknown consultation boundary') } })).rejects.toThrow('unknown consultation boundary')
    const before = await readProductRuntimeState(f.sessionId), blocked = await readTtrpgOpenConsultationDeskV1(host)
    expect(blocked.canStart).toBe(false); expect(blocked.canConsult).toBe(false); expect(blocked.sharing.canShare).toBe(false); expect(blocked.canClose).toBe(false)
    await expect(start(host)).rejects.toThrow(/原窗口/)
    expect(await readProductRuntimeState(f.sessionId)).toEqual(before)
    await finishTtrpgOpenBriefDeskV1(host)
    expect((await readTtrpgOpenConsultationDeskV1(host)).canStart).toBe(true)
    await start(host, 'explicit-distinct-window')
    expect((await readProductRuntimeState(f.sessionId)).ttrpg!.openRun!.coordination.calls[0]).toEqual(before.ttrpg!.openRun!.coordination.calls[0])
    expect(sends).toBe(1)
  })
})
