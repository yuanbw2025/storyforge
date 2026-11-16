import { afterEach, beforeEach, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { createWorldPackage } from '../../src/lib/world-engine/world-package'
import { installWorldSourcePackageV1 } from '../../src/lib/world-engine/source-receipt'
import { assertWorldSourcePurposeCasV1, freezeWorldSourcePurposeV1, prepareWorldSourcePurposeCasV1,
  worldSourcePurposeTransactionTablesV1 } from '../../src/lib/world-engine/source-purpose'
import { listLocalWorldReferenceChoicesV1 } from '../../src/lib/world-engine/reference-cache'
import { seedCurrentProductWorld } from '../helpers/current-product-world'
import { createWorldRevision } from '../../src/lib/world-engine/releases'
import { freezeWorldSourcePurposeV1 as freezePurposeAction } from '../../src/lib/world-engine/source-purpose-actions'

beforeEach(async () => { await db.delete(); await db.open() })
afterEach(() => { db.close() })

async function foreignSameCodeCache() {
  const producer = await seedCurrentProductWorld('021 external publisher on an isolated device')
  const publisher = await db.projects.get(producer.scope.projectId)
  const publishedWorld = await db.worlds.get(producer.scope.worldId)
  if (!publisher || !publishedWorld) throw new Error('publisher fixture missing')
  const wire = await createWorldPackage(producer.release.id!, {
    authorName: '合成外部作者', attribution: '保留外部声明', license: 'CC-BY-4.0', contentWarnings: [],
    allowedUses: { 'world-remix': true, ttrpg: false, 'character-interaction': false,
      'ai-town': false, 'text-adventure': false, avg: true, 'text-open-world': false },
  })
  // Model a separate receiving device. The code collision is a valid public
  // identity value; it must never turn an imported cache into authorship.
  await db.delete(); await db.open()
  const target = await createWorkspace({ name: '021 receiving author world', description: '', genres: ['other'],
    status: 'drafting', targetWordCount: 0 }, { purpose: 'world-engine', kind: 'novel', novelProfile: 'long' })
  expect(target.project.workspaceUid).not.toBe(publisher.workspaceUid)
  await db.worlds.update(target.scope.worldId, { code: publishedWorld.code })
  const installed = await installWorldSourcePackageV1(target.scope, wire)
  expect((await db.worlds.get(target.scope.worldId))?.communityOrigin).toBeUndefined()
  expect((await db.worldReleases.get(installed.worldReleaseId))?.sourceWorldCode).toBe(publishedWorld.code)
  return { target, installed }
}

it('an imported denied D with the same public code cannot gain implicit local-author permission', async () => {
  const { target, installed } = await foreignSameCodeCache()
  await expect(freezeWorldSourcePurposeV1({ worldReleaseId: installed.worldReleaseId,
    expectedProjectId: target.scope.projectId, expectedWorldId: target.scope.worldId, purpose: 'ttrpg',
  })).rejects.toThrow(/明确|unknown|来源|本地/)
})

it('the real source selector never offers that readonly cache as an allowed native author choice', async () => {
  const { target, installed } = await foreignSameCodeCache()
  const choices = await listLocalWorldReferenceChoicesV1({ purpose: 'ttrpg', scope: target.scope })
  const selected = choices.filter(choice => choice.id === installed.worldReleaseId)
  expect(selected.length).toBeGreaterThan(0)
  expect(selected.some(choice => choice.purposeAllowed)).toBe(false)
})

it('refuses a changed seal origin at the product transaction even when frozen release bytes and world code stay identical', async () => {
  const author = await seedCurrentProductWorld('021 原作者用途 CAS')
  const selection = { worldReleaseId: author.release.id!, expectedProjectId: author.scope.projectId,
    expectedWorldId: author.scope.worldId, purpose: 'ttrpg' as const }
  const proof = await freezeWorldSourcePurposeV1(selection)
  expect(proof.origin.kind).toBe('local-author')
  const witness = await prepareWorldSourcePurposeCasV1({ ...selection, proof })
  const revision = (await db.worldRevisions.get(author.release.revisionId))!
  await db.worldRevisions.update(revision.id!, { publicationOrigin: { ...revision.publicationOrigin!, kind: 'reference-cache' } })
  await expect(db.transaction('rw', worldSourcePurposeTransactionTablesV1(), () => assertWorldSourcePurposeCasV1(witness)))
    .rejects.toThrow(/变化|来源|权限/)
  expect((await db.worldReleases.get(author.release.id!))?.manifestJson).toBe(author.release.manifestJson)
  expect(await db.agentRuns.count()).toBe(0)
})

it('keeps the selected immutable R authorized while the author edits mutable Work data and seals another draft revision', async () => {
  const author = await seedCurrentProductWorld('021 冻结引用与可变草稿隔离')
  const selection = { worldReleaseId: author.release.id!, expectedProjectId: author.scope.projectId,
    expectedWorldId: author.scope.worldId, purpose: 'ttrpg' as const }
  const proof = await freezeWorldSourcePurposeV1(selection)
  const witness = await prepareWorldSourcePurposeCasV1({ ...selection, proof })
  const work = (await db.works.get(author.scope.workId))!
  await db.works.update(author.scope.workId, { description: '作者继续编辑后续草稿；原冻结世界内容未变', updatedAt: work.updatedAt + 1 })
  await createWorldRevision({ scope: author.scope, label: '后续草稿修订；不是选中的冻结 R' })
  await expect(db.transaction('rw', worldSourcePurposeTransactionTablesV1(), () => assertWorldSourcePurposeCasV1(witness))).resolves.toBeUndefined()
  expect((await db.worldReleases.get(author.release.id!))?.manifestJson).toBe(author.release.manifestJson)
})

it('captures the chosen owner and release before lazy admission loading yields to caller mutation', async () => {
  const first = await seedCurrentProductWorld('021 调用时原作者')
  const second = await seedCurrentProductWorld('021 之后切换的作者')
  const request = { worldReleaseId: first.release.id!, expectedProjectId: first.scope.projectId,
    expectedWorldId: first.scope.worldId, purpose: 'ttrpg' as const }
  const pending = freezePurposeAction(request)
  Object.assign(request, {worldReleaseId: second.release.id!, expectedProjectId: second.scope.projectId,
    expectedWorldId: second.scope.worldId})
  expect((await pending).selectedRelease.releaseUid).toBe(first.release.releaseUid)
  expect(await db.agentRuns.count()).toBe(0)
})
