import { beforeEach, afterEach, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { openWorldSemanticResourceCatalogV1 } from '../../src/lib/context-gateway/world-release-client'
import { assertFormalProductProductionStartV1, createConfirmedProductBriefV1, freezeProductSourcePlanV1, validateProductSourcePlan, type WorldRequirementAdapterV1 } from '../../src/lib/product/source-contracts'
import { canonicalProductProductionJsonV2 } from '../../src/lib/product-production/hash'
import { assertWorldSourcePurposeCasV1, prepareWorldSourcePurposeCasV1, readWorldSourcePurposeDeclarationV1 } from '../../src/lib/world-engine/source-purpose'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { listTextOpenWorldCreatorWorldSourcesV1 } from '../../src/lib/open-world/creator-source'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { createWorldPackage } from '../../src/lib/world-engine/world-package'
import { installWorldSourcePackageV1 } from '../../src/lib/world-engine/source-receipt'
import { cacheWorldReferenceForProductV1, selectWorldReferenceForProductPurposeV1 } from '../../src/lib/world-engine/reference-cache'
import { createWorldReferenceV1 } from '../../src/lib/world-engine/world-reference'
import { seedCurrentProductWorld as fixture } from '../helpers/current-product-world'

beforeEach(async () => { await db.delete(); await db.open() })
afterEach(() => db.close())

async function prepare(mode: 'explicit-denied' | 'ambiguous' | 'unique' | 'r-only' | 'native' | 'explicit-allowed') {
  const f = await fixture('021 original populated authored world')
  const local = await createWorkspace({ name: '021 purpose target', description: '', genres: ['other'], status: 'drafting', targetWordCount: 0 },
    { purpose: 'independent-work', kind: 'ttrpg' })
  const scope = mode === 'native' ? f.scope : local.scope
  let releaseId = f.release.id!
  let sourceDeclarationHash: string | undefined
  if (mode === 'r-only') releaseId = await cacheWorldReferenceForProductV1(local.scope, f.release.id!)
  if (mode === 'explicit-denied' || mode === 'ambiguous' || mode === 'unique' || mode === 'explicit-allowed') {
    const options = { authorName: '021合成作者', attribution: ' 逐字署名 é ', license: 'CC-BY-4.0' as const,
      contentWarnings: [' 原警告 '],
      allowedUses: { 'world-remix': true, ttrpg: true, 'character-interaction': false, 'ai-town': false,
        'text-adventure': false, avg: true, 'text-open-world': true } }
    const accepted = await installWorldSourcePackageV1(local.scope, await createWorldPackage(f.release.id!, options))
    releaseId = accepted.worldReleaseId
    if (mode !== 'unique') {
      const rejected = await createWorldPackage(f.release.id!, { ...options, allowedUses: { ...options.allowedUses, ttrpg: false, 'text-open-world': false } })
      const denied = await installWorldSourcePackageV1(local.scope, rejected)
      expect(accepted.worldReleaseId).toBe(denied.worldReleaseId)
      expect(accepted.declarationHash).not.toBe(denied.declarationHash)
      releaseId = denied.worldReleaseId
      if (mode === 'explicit-denied') sourceDeclarationHash = denied.declarationHash
      if (mode === 'explicit-allowed') sourceDeclarationHash = accepted.declarationHash
    }
  }
  const catalog = await openWorldSemanticResourceCatalogV1({
    localReleaseRecordId: releaseId, expectedProjectId: scope.projectId, expectedWorldId: scope.worldId,
  })
  const descriptor = catalog.resources.find(row => row.worldSemantic)
  if (!descriptor?.worldSemantic) throw new Error('Expected actual nonempty source catalog')
  const adapter: WorldRequirementAdapterV1<null> = { adapterId: 'test.021-purpose', adapterVersion: 1,
    productType: 'ttrpg', contextTaskKind: 'agent-outline', resolve: () => [{ key: 'source', label: '原来源',
      level: 'stable-required', minimumResources: 1, condition: null,
      selector: { areas: [descriptor.worldSemantic!.area], resourceKinds: [descriptor.worldSemantic!.resourceKind],
        contextKinds: [descriptor.kind], query: null } }] }
  return { scope, releaseId, authorReleaseId: f.release.id!, productInstanceKey: 'purpose-021', worldReference: await createWorldReferenceV1(releaseId),
    adapter, goal: null, missingStrategy: 'block' as const, sourceDeclarationHash }
}

it.each(['explicit-denied', 'ambiguous', 'unique', 'r-only'] as const)('021 actual common product plan refuses unauthorized %s before authority exists', async mode => {
  const input = await prepare(mode)
  await expect(freezeProductSourcePlanV1(input)).rejects.toThrow(
    mode === 'explicit-denied' ? /不允许/ : /明确选择|unknown/,
  )
  expect(await db.agentRuns.count()).toBe(0)
  expect(await db.productBuilds.count()).toBe(0)
})

it('021 locally authored release can still freeze a product plan', async () => {
  expect((await freezeProductSourcePlanV1(await prepare('native'))).readiness).toBe('ready')
})

it('021 allowed D survives canonical product persistence, Start and real same/fresh backup; changing D invalidates new actions only', async () => {
  const input = await prepare('explicit-allowed')
  const plan = await freezeProductSourcePlanV1(input)
  const persisted = await validateProductSourcePlan(JSON.parse(canonicalProductProductionJsonV2(plan)))
  const proof = persisted.sourcePurpose!
  expect(proof.origin.kind).toBe('declared')
  if (proof.origin.kind !== 'declared') throw new Error('Expected exact original declaration')
  expect(readWorldSourcePurposeDeclarationV1(proof.origin)).toMatchObject({
    declarationHash: input.sourceDeclarationHash, attribution: ' 逐字署名 é ', contentWarnings: [' 原警告 '],
  })
  const confirmedBrief = await createConfirmedProductBriefV1({ productType: 'ttrpg', productInstanceKey: plan.productInstanceKey,
    sourcePlan: plan, briefRevision: 1, briefContentHash: 'b'.repeat(64), authorStartRevision: 1 })
  await expect(assertFormalProductProductionStartV1({ sourcePlan: persisted, confirmedBrief, authorStartRevision: 1 })).resolves.toBeUndefined()

  const candidates = await listTextOpenWorldCreatorWorldSourcesV1(input.scope)
  expect(candidates).toHaveLength(2)
  expect(new Set(candidates.map(row => row.sourceChoiceKey)).size).toBe(2)
  expect(candidates.map(row => row.purposeAllowed).sort()).toEqual([false, true])

  const backup = await exportProjectJSON(input.scope.projectId)
  for (const fresh of [false, true]) {
    if (fresh) { await db.delete(); await db.open() }
    const projectId = await importProjectJSON(backup)
    const world = (await db.worlds.where('projectId').equals(projectId).toArray())[0]
    const restored = await db.worldReleases.where('worldId').equals(world.id!).first()
    const witness = await prepareWorldSourcePurposeCasV1({
      worldReleaseId: restored!.id!, expectedProjectId: projectId, expectedWorldId: world.id!, purpose: 'ttrpg', proof,
    })
    const exact = await db.worldSourceReceipts.where('[worldId+declarationHash]').equals([world.id!, input.sourceDeclarationHash!]).first()
    await db.worldSourceReceipts.delete(exact!.id!)
    await expect(assertWorldSourcePurposeCasV1(witness)).rejects.toThrow(/提交前变化/)
    await expect(prepareWorldSourcePurposeCasV1(witness.input)).rejects.toThrow(/receipt 缺失/)
    expect((await validateProductSourcePlan(persisted)).planHash).toBe(plan.planHash)
  }
})

it('021 explicit cross-workspace author selection cannot turn an R-only cache into permanent authority', async () => {
  const input = await prepare('r-only')
  const choice = await selectWorldReferenceForProductPurposeV1(input.scope, input.authorReleaseId, 'ttrpg')
  expect(choice.localId).toBe(input.releaseId)
  const plan = await freezeProductSourcePlanV1({ ...input, sourcePurpose: choice.sourcePurpose })
  const confirmedBrief = await createConfirmedProductBriefV1({ productType: 'ttrpg', productInstanceKey: plan.productInstanceKey,
    sourcePlan: plan, briefRevision: 1, briefContentHash: 'c'.repeat(64), authorStartRevision: 1 })
  await expect(assertFormalProductProductionStartV1({ sourcePlan: plan, confirmedBrief, authorStartRevision: 1 })).resolves.toBeUndefined()
  await db.worldReleases.delete(input.authorReleaseId)
  await expect(assertFormalProductProductionStartV1({ sourcePlan: plan, confirmedBrief, authorStartRevision: 1 }))
    .rejects.toThrow(/原作者冻结版本.*不可核实/)
  expect((await validateProductSourcePlan(plan)).planHash).toBe(plan.planHash)
})
