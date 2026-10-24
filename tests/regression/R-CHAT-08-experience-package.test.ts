import {beforeEach, afterEach, expect, it} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {createChatDraftV3} from '../../src/lib/character-interaction/draft-service'
import {previewChatExperiencePackageV1, installChatExperiencePackageV1, exportChatExperiencePackageV1} from '../../src/lib/character-interaction/experience-package'
import {seedChatExperiencePackageFixture} from '../helpers/chat-experience-package-fixture'
import {useCharacterInteractionPlayerStore as player} from '../../src/stores/character-interaction-player'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {deleteWorkspace} from '../../src/lib/workspace/lifecycle'
import {createFixtureProductReleaseManifestV1} from '../helpers/product-release-v1'
import {hashProductProductionValueV2} from '../../src/lib/product-production/hash'

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).buffer
beforeEach(async () => {db.close(); await db.delete(); await db.open(); player.setState({scope: null, busy: false, selectedSessionId: null})})
afterEach(() => db.close())

it('previews locally without secrets or writes, installs both versions, preserves old saves and restores the full independent copy', async () => {
  const f = await seedChatExperiencePackageFixture(), target = await createChatDraftV3('独立体验包工作区')
  const world = await db.worldReleases.toArray(), preview = await previewChatExperiencePackageV1({scope: target.scope, bytes: bytes(f.original)})
  for (const fact of f.original.productRelease.manifest.runtimePackage.interaction!.chatNarrative!.initialSituation.facts.filter(fact => !fact.audienceKeys.includes('player'))) {
    expect(JSON.stringify(preview)).not.toContain(fact.text)
  }
  expect(await db.productReleases.where('workId').equals(target.scope.workId).count()).toBe(0)
  const oldRelease = await installChatExperiencePackageV1(preview)
  await player.getState().load(target.scope, null)
  const oldSessionId = await player.getState().start(oldRelease.id!, '保留旧故事')
  await player.getState().sendPlayerMessage('我先在这里休息。')
  const oldSession = await db.productRuntimeSessions.get(oldSessionId), oldEvents = await db.productRuntimeEvents.where('sessionId').equals(oldSessionId).toArray()
  const next = await previewChatExperiencePackageV1({scope: target.scope, bytes: bytes(f.illustrated)})
  expect(next.existing).toMatchObject([{releaseId: oldRelease.id, sameContent: false}])
  expect(next.summary.media).toHaveLength(3)
  const newRelease = await installChatExperiencePackageV1(next)
  expect(newRelease.id).not.toBe(oldRelease.id)
  expect(await db.productRuntimeSessions.get(oldSessionId)).toEqual(oldSession)
  expect(await db.productRuntimeEvents.where('sessionId').equals(oldSessionId).toArray()).toEqual(oldEvents)
  const repeat = await previewChatExperiencePackageV1({scope: target.scope, bytes: bytes(f.illustrated)})
  expect(repeat.existing.filter(row => row.sameContent)).toHaveLength(1)
  expect((await installChatExperiencePackageV1(repeat)).id).toBe(newRelease.id)
  expect(await db.productReleases.where('workId').equals(target.scope.workId).count()).toBe(2)
  expect(await exportChatExperiencePackageV1({scope: target.scope, productReleaseId: newRelease.id!})).toEqual(f.illustrated)
  expect(await db.worldReleases.toArray()).toEqual(world)
  expect(await db.worldReleases.where('worldId').equals(target.scope.worldId).count()).toBe(0)
  expect(await db.agentRuns.where('workId').equals(target.scope.workId).count()).toBe(0)
  const importedProject = await importProjectJSON(await exportProjectJSON(target.scope.projectId))
  const copy = (await db.productReleases.where('projectId').equals(importedProject).filter(row => row.contentHash === newRelease.contentHash).first())!
  await deleteWorkspace(f.sourceScope.projectId)
  expect(await exportChatExperiencePackageV1({scope: {projectId: copy.projectId, workId: copy.workId, worldId: copy.worldId}, productReleaseId: copy.id!})).toEqual(f.illustrated)
  await player.getState().load(target.scope, null, oldSessionId)
  expect(player.getState().runtimeState.interaction!.messages.at(-1)?.text).toBe('我先在这里休息。')
}, 30_000)

it('rejects forged previews, foreign work/export, missing pictures and malformed files without partial installation', async () => {
  const f = await seedChatExperiencePackageFixture(), target = await createChatDraftV3('预览反例')
  await expect(previewChatExperiencePackageV1({scope: f.sourceScope, bytes: bytes(f.illustrated)})).rejects.toThrow('角色聊天作品')
  const preview = await previewChatExperiencePackageV1({scope: target.scope, bytes: bytes(f.illustrated)})
  await expect(installChatExperiencePackageV1(structuredClone(preview))).rejects.toThrow('预览已变化')
  preview.title = '迟到修改'
  await expect(installChatExperiencePackageV1(preview)).rejects.toThrow('预览已变化')
  const damaged = structuredClone(f.illustrated); damaged.media.pop()
  await expect(previewChatExperiencePackageV1({scope: target.scope, bytes: bytes(damaged)})).rejects.toThrow('媒资数量')
  await expect(previewChatExperiencePackageV1({scope: target.scope, bytes: new Uint8Array([0xff]).buffer})).rejects.toThrow('UTF-8')
  const sourceRelease = (await db.productReleases.where('workId').equals(f.sourceScope.workId).first())!
  await expect(exportChatExperiencePackageV1({scope: target.scope, productReleaseId: sourceRelease.id!})).rejects.toThrow('不属于')
  expect(await db.productReleases.where('workId').equals(target.scope.workId).count()).toBe(0)
  expect(await db.mediaBlobObjects.where('workId').equals(target.scope.workId).count()).toBe(0)
}, 30_000)

it('preserves authored version numbers when installing newest first and refuses conflicting content under the same identity', async () => {
  const f = await seedChatExperiencePackageFixture(), target = await createChatDraftV3('倒序安装')
  const newest = await installChatExperiencePackageV1(await previewChatExperiencePackageV1({scope: target.scope, bytes: bytes(f.illustrated)}))
  expect(newest.version).toBe(2)
  const older = await installChatExperiencePackageV1(await previewChatExperiencePackageV1({scope: target.scope, bytes: bytes(f.original)}))
  expect(older.version).toBe(1)
  const prior = await db.productReleases.where('workId').equals(target.scope.workId).toArray()
  const fake = structuredClone(f.original)
  const runtimePackage = structuredClone(fake.productRelease.manifest.runtimePackage)
  runtimePackage.definition.description = '同一发行身份下的另一份内容'
  fake.productRelease.manifest = await createFixtureProductReleaseManifestV1({runtimePackage,
    productionKey: fake.productRelease.manifest.productionProvenance.productionKey, releaseVersion: 1})
  fake.productRelease.contentHash = await hashProductProductionValueV2(fake.productRelease.manifest)
  const {bundleHash: _hash, ...body} = fake
  fake.bundleHash = await hashProductProductionValueV2(body)
  const preview = await previewChatExperiencePackageV1({scope: target.scope, bytes: bytes(fake)})
  await expect(installChatExperiencePackageV1(preview)).rejects.toThrow('同一发行版本号')
  expect(await db.productReleases.where('workId').equals(target.scope.workId).toArray()).toEqual(prior)
  const restored = await importProjectJSON(await exportProjectJSON(target.scope.projectId))
  expect((await db.productReleases.where('projectId').equals(restored).toArray()).map(release => release.version).sort()).toEqual([1, 2])
  await db.productReleases.update(older.id!, {version: 7})
  const damaged = await previewChatExperiencePackageV1({scope: target.scope, bytes: bytes(f.original)})
  expect(damaged.existing.find(row => row.releaseId === older.id)?.error).toContain('完整性')
  await expect(installChatExperiencePackageV1(damaged)).rejects.toThrow('身份')
  expect((await db.productReleases.get(older.id!))!.version).toBe(7)
}, 30_000)
