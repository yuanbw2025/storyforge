import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import * as events from '../../src/lib/agent/run/event-store'
import { seedOpenBrowserProductionV1, runOpenBrowserProductionV1 } from '../helpers/open-ttrpg-production-browser'
import { publishProductProductionV1, recoverImportedProductProductionProofsV1 } from '../../src/lib/product-production/service'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'

beforeEach(async () => { await db.delete(); await db.open() })
afterEach(() => { vi.restoreAllMocks(); db.close() })

async function fixture() {
  const source = await seedOpenBrowserProductionV1()
  await runOpenBrowserProductionV1(source)
  await runOpenBrowserProductionV1(source, true)
  await runOpenBrowserProductionV1(source, true)
  await publishProductProductionV1(source)
  const original = (await db.productProductions.get(source.productionId))!
  const projectId = await importProjectJSON(await exportProjectJSON(source.scope.projectId))
  const production = (await db.productProductions.where('projectId').equals(projectId).toArray())
    .find(row => row.productionKey === original.productionKey)!
  const input = { scope: { projectId, worldId: production.worldId, workId: production.workId }, productionId: production.id! }
  const build = (await db.productBuilds.where('productionId').equals(production.id!).first())!
  const release = (await db.productReleases.get(build.releasedProductReleaseId!))!
  const rootId = JSON.parse(build.budgetLedgerJson).rootRunId as number
  return { input, production, build, release, rootId }
}

type Cut = 'started-return' | 'accepted-before' | 'accepted-return'
async function interrupt(f: Awaited<ReturnType<typeof fixture>>, cut: Cut) {
  const retained = events.appendAgentRunEventV1
  vi.spyOn(events, 'appendAgentRunEventV1').mockImplementation(async input => {
    if (input.runId === f.rootId && input.type === 'verification.accepted' && cut === 'accepted-before') {
      throw new Error(`fixture-root-cut:${cut}`)
    }
    const result = await retained(input)
    if (input.runId === f.rootId && ((input.type === 'verification.started' && cut === 'started-return')
      || (input.type === 'verification.accepted' && cut === 'accepted-return'))) {
      throw new Error(`fixture-root-cut:${cut}`)
    }
    return result
  })
  await expect(recoverImportedProductProductionProofsV1(f.input)).rejects.toThrow(`fixture-root-cut:${cut}`)
  vi.restoreAllMocks()
}

it.each<Cut>(['started-return', 'accepted-before', 'accepted-return'])(
  'resumes the same published import verification after %s without another start or changed publication', async cut => {
    const f = await fixture()
    await interrupt(f, cut)
    expect((await events.readAgentRunV1(f.input.scope, f.rootId)).projection.state)
      .toBe(cut === 'accepted-return' ? 'completed' : 'verifying')
    expect((await recoverImportedProductProductionProofsV1(f.input)).terminal).toBe(true)
    expect((await recoverImportedProductProductionProofsV1(f.input)).terminal).toBe(true)
    expect(await db.productBuilds.get(f.build.id!)).toEqual(f.build)
    expect(await db.productProductions.get(f.production.id!)).toEqual(f.production)
    expect(await db.productReleases.get(f.release.id!)).toEqual(f.release)
    const root = await events.readAgentRunV1(f.input.scope, f.rootId)
    expect(root.events.filter(event => event.type === 'verification.started'
      && event.payload.verifierSetVersion === 'product-production-root-published-origin-rebind-v1')).toHaveLength(1)
    expect(root.projection.terminalReceiptHash).toBe(f.build.rootTerminalReceiptHash)
  }, 60000,
)

it.each(['wrong-verifier', 'changed-cost', 'missing-origin'] as const)(
  'refuses a pending import root with %s without writing any further receipt or publication', async mode => {
    const f = await fixture()
    await interrupt(f, 'started-return')
    if (mode === 'wrong-verifier') {
      const row = (await db.agentRunEvents.where('runId').equals(f.rootId).toArray())
        .find(row => row.type === 'verification.started' && JSON.parse(row.payloadJson).verifierSetVersion === 'product-production-root-published-origin-rebind-v1')!
      await db.agentRunEvents.update(row.id!, { payloadJson: JSON.stringify({ verifierSetVersion: 'unrelated-verifier' }) })
    } else if (mode === 'changed-cost') {
      const ledger = JSON.parse(f.build.budgetLedgerJson)
      ledger.attempts[0].usage.costUsd = 99
      await db.productBuilds.update(f.build.id!, { budgetLedgerJson: JSON.stringify(ledger) })
    } else {
      await db.agentRuns.update(f.rootId, { portablePublishedRootOriginJson: undefined })
    }
    const root = await events.readAgentRunV1(f.input.scope, f.rootId)
    const build = await db.productBuilds.get(f.build.id!)
    await expect(recoverImportedProductProductionProofsV1(f.input)).rejects.toThrow()
    expect(await events.readAgentRunV1(f.input.scope, f.rootId)).toEqual(root)
    expect(await db.productBuilds.get(f.build.id!)).toEqual(build)
    expect(await db.productProductions.get(f.production.id!)).toEqual(f.production)
    expect(await db.productReleases.get(f.release.id!)).toEqual(f.release)
  }, 60000,
)

it('archives a genuinely interrupted verification and resumes it after another colliding full import', async () => {
  const f = await fixture()
  await interrupt(f, 'started-return')
  const prior = await events.readAgentRunV1(f.input.scope, f.rootId)
  const projectId = await importProjectJSON(await exportProjectJSON(f.input.scope.projectId))
  const production = (await db.productProductions.where('projectId').equals(projectId).toArray())
    .find(row => row.productionKey === f.production.productionKey)!
  const build = (await db.productBuilds.where('productionId').equals(production.id!).first())!
  const rootId = JSON.parse(build.budgetLedgerJson).rootRunId as number
  const scope = { projectId, worldId: production.worldId, workId: production.workId }
  expect(rootId).not.toBe(f.rootId)
  expect((await db.agentRuns.get(rootId))!.portablePublishedRootOriginJson).toBe(prior.run.portablePublishedRootOriginJson)
  expect((await recoverImportedProductProductionProofsV1({ scope, productionId: production.id! })).terminal).toBe(true)
  expect(await db.productBuilds.get(build.id!)).toEqual(build)
  expect(await db.productProductions.get(production.id!)).toEqual(production)
  expect(await events.readAgentRunV1(f.input.scope, f.rootId)).toEqual(prior)
}, 60000)
