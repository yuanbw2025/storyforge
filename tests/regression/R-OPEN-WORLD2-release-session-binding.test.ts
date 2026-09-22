import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { branchTextOpenWorldSessionFromCheckpointV1, createTextOpenWorldCheckpointV1 } from '../../src/lib/open-world/checkpoints'
import { commitTextOpenWorldCommandV1 } from '../../src/lib/open-world/commands'
import { verifyTextOpenWorldVNextSessionBindingV1 } from '../../src/lib/open-world/session-binding'
import { createInitialTextOpenWorldSessionProjectionV1 } from '../../src/lib/open-world/session-projection'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import {
  parseProductRuntimePackageV1,
  verifyProductReleaseManifestV1,
} from '../../src/lib/product-production/runtime-package'
import { assertProductReleaseUnchanged, parseTextOpenWorldProductReleaseManifest } from '../../src/lib/product/releases'
import { createTextOpenWorldInstance } from '../../src/lib/product/runtime-instances'
import {
  hashProductRuntimeStateV1,
  readProductRuntimeState,
  readProductRuntimeStateVersion,
} from '../../src/lib/product/runtime-core'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import { EMPTY_PRODUCT_RUNTIME_STATE, type ProductRelease } from '../../src/lib/types'
import { useTextOpenWorldPlayerStore } from '../../src/stores/text-open-world-player'
import { createFixtureProductReleaseManifestV1 } from '../helpers/product-release-v1'
import {
  createGovernedTextOpenWorldSessionFixtureV1,
  createHybridTextOpenWorldProductRuntimePackageFixtureV1,
  createLegacyTextOpenWorldProductRuntimePackageFixtureV1,
  createTextOpenWorldProductRuntimePackageFixtureV1,
  createTextOpenWorldVNextOnlyProductRuntimePackageFixtureV1,
} from '../helpers/text-open-world-product-session'
import { createTextOpenWorldVNextFixture } from '../helpers/text-open-world-vnext-fixture'

describe('Text Open World vNext · ProductBuild/ProductRelease、InitialState和Session绑定', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    useTextOpenWorldPlayerStore.setState({
      scope: null, worldGroupId: null, releases: [], sessions: [], selectedSessionId: null,
      events: [], checkpoints: [], runtimeState: structuredClone(EMPTY_PRODUCT_RUNTIME_STATE),
      selectedManifest: null, lastFeedback: null, generatedCandidate: null,
      loading: false, busy: false, error: '',
    })
  })
  afterAll(() => db.close())

  it('vNext 15模块作为共享ProductRuntimePackage字段逐层校验', async () => {
    const textOpenWorldVNext = createTextOpenWorldVNextFixture()
    const runtimePackage = createTextOpenWorldProductRuntimePackageFixtureV1(textOpenWorldVNext)
    expect(parseProductRuntimePackageV1(runtimePackage).textOpenWorldVNext).toEqual(textOpenWorldVNext)

    const manifest = await createFixtureProductReleaseManifestV1({ runtimePackage })
    await expect(verifyProductReleaseManifestV1(manifest)).resolves.toEqual(manifest)
    await expect(verifyProductReleaseManifestV1({
      ...manifest,
      runtimePackage: {
        ...manifest.runtimePackage,
        textOpenWorldVNext: {
          ...manifest.runtimePackage.textOpenWorldVNext!,
          metadata: { ...manifest.runtimePackage.textOpenWorldVNext!.metadata, title: '被改写' },
        },
      },
    })).rejects.toThrow(/packageHash/)

    expect(() => parseProductRuntimePackageV1({
      ...runtimePackage,
      textOpenWorldVNext: {
        ...textOpenWorldVNext,
        sourceManifest: { ...textOpenWorldVNext.sourceManifest, contentHash: 'f'.repeat(64) },
      },
    })).toThrow(/来源或规则版本不一致/)
  })

  it('产品专用Release reader同时接受legacy-only、hybrid和vNext-only三态', async () => {
    const textOpenWorldVNext = createTextOpenWorldVNextFixture()
    const hybrid = createHybridTextOpenWorldProductRuntimePackageFixtureV1(textOpenWorldVNext)
    const legacyOnly = createLegacyTextOpenWorldProductRuntimePackageFixtureV1(
      textOpenWorldVNext.sourceManifest.contentHash,
    )
    const vNextOnly = createTextOpenWorldVNextOnlyProductRuntimePackageFixtureV1(textOpenWorldVNext)
    const [legacyManifest, hybridManifest, vNextManifest] = await Promise.all([
      createFixtureProductReleaseManifestV1({ runtimePackage: parseProductRuntimePackageV1(legacyOnly) }),
      createFixtureProductReleaseManifestV1({ runtimePackage: hybrid }),
      createFixtureProductReleaseManifestV1({ runtimePackage: vNextOnly }),
    ])

    const parsedLegacy = parseTextOpenWorldProductReleaseManifest(JSON.stringify(legacyManifest))
    expect(parsedLegacy.openWorld).toBeDefined()
    expect(parsedLegacy.textOpenWorldVNext).toBeUndefined()
    const parsedHybrid = parseTextOpenWorldProductReleaseManifest(JSON.stringify(hybridManifest))
    expect(parsedHybrid.openWorld).toBeDefined()
    expect(parsedHybrid.textOpenWorldVNext).toBeDefined()
    expect(parsedHybrid.definition.enabledCapabilities).toContain('textOpenWorldVNext')
    const parsedVNext = parseTextOpenWorldProductReleaseManifest(JSON.stringify(vNextManifest))
    expect(parsedVNext.openWorld).toBeUndefined()
    expect(parsedVNext.textOpenWorldVNext).toBeDefined()

    const partialHybridManifest = structuredClone(vNextManifest)
    partialHybridManifest.runtimePackage.interaction = hybrid.interaction
    expect(() => parseTextOpenWorldProductReleaseManifest(JSON.stringify(partialHybridManifest)))
      .toThrow(/旧四运行模块必须完整存在或完整省略/)

    const hybridWithPresentation = parseProductRuntimePackageV1({
      ...hybrid,
      definition: {
        ...hybrid.definition,
        enabledCapabilities: [...hybrid.definition.enabledCapabilities, 'presentation'],
      },
      presentation: { version: 1, cues: [], assets: [] },
    })
    expect(hybridWithPresentation.presentation).toEqual({ version: 1, cues: [], assets: [] })
    expect(hybridWithPresentation.definition.enabledCapabilities).toEqual([
      'narrative', 'interaction', 'adventure', 'openWorldEvolution', 'open-world',
      'textOpenWorldVNext', 'presentation',
    ])
  })

  it('正式Session由ProductRelease确定性开局，Release被篡改后fail-closed', async () => {
    const textOpenWorldVNext = createTextOpenWorldVNextFixture()
    const created = await createGovernedTextOpenWorldSessionFixtureV1({
      name: 'TEXT-OPEN-WORLD Release绑定验收', textOpenWorldVNext,
      runtimeShape: 'hybrid-compatibility',
      title: '盐脊新游戏', seed: 'release-seed',
    })
    const state = await readProductRuntimeState(created.session.id!)
    expect(created.session).toMatchObject({
      kind: 'text-open-world', productReleaseId: created.release.id,
      productBuildId: null, runtimeSourceHash: created.manifest.packageHash,
    })
    expect(state.textOpenWorld).toEqual(createInitialTextOpenWorldSessionProjectionV1(textOpenWorldVNext))
    expect(state.interaction).not.toBeNull()
    expect(state.adventure).not.toBeNull()
    expect(state.openWorldEvolution).not.toBeNull()
    expect(state.openWorld).not.toBeNull()
    await expect(verifyTextOpenWorldVNextSessionBindingV1(created.session)).resolves.toMatchObject({
      runtimePackage: textOpenWorldVNext,
    })

    await db.productReleases.update(created.release.id!, {
      manifestJson: created.release.manifestJson.replace('首个纵向验收世界', '被改写的世界'),
    })
    await expect(assertProductReleaseUnchanged(created.release.id!)).rejects.toThrow(/packageHash|已被篡改/)
  })

  it('vNext-only正式Release可入玩家库、启动并装配运行Context，越界读取和篡改继续fail-closed', async () => {
    const textOpenWorldVNext = createTextOpenWorldVNextFixture()
    expect(createTextOpenWorldVNextOnlyProductRuntimePackageFixtureV1(textOpenWorldVNext))
      .toMatchObject({ definition: { enabledCapabilities: ['narrative', 'textOpenWorldVNext'] } })
    const created = await createGovernedTextOpenWorldSessionFixtureV1({
      name: 'TEXT-OPEN-WORLD vNext-only绑定验收',
      textOpenWorldVNext,
      runtimeShape: 'vnext-only',
    })
    const state = await readProductRuntimeState(created.session.id!)
    expect(state.textOpenWorld).toEqual(createInitialTextOpenWorldSessionProjectionV1(textOpenWorldVNext))
    expect(state.interaction).toBeNull()
    expect(state.adventure).toBeNull()
    expect(state.openWorldEvolution).toBeNull()
    expect(state.openWorld).toBeNull()

    await useTextOpenWorldPlayerStore.getState().load(created.scope, null)
    const libraryItem = useTextOpenWorldPlayerStore.getState().releases
      .find(item => item.release.id === created.release.id)
    expect(libraryItem).toMatchObject({ error: '' })
    expect(libraryItem?.manifest?.textOpenWorldVNext?.metadata.packageKey)
      .toBe(textOpenWorldVNext.metadata.packageKey)
    expect(libraryItem?.manifest?.openWorld).toBeUndefined()

    const startedSessionId = await useTextOpenWorldPlayerStore.getState()
      .start(created.release.id!, 'vNext-only玩家入口')
    expect(useTextOpenWorldPlayerStore.getState()).toMatchObject({
      selectedSessionId: startedSessionId,
      error: '',
      runtimeState: { interaction: null, adventure: null, openWorldEvolution: null, openWorld: null },
    })
    expect(useTextOpenWorldPlayerStore.getState().runtimeState.textOpenWorld).not.toBeNull()

    const context = await assembleContext({
      projectId: created.scope.projectId,
      scope: created.scope,
      worldGroupId: null,
      productRuntimeSessionId: startedSessionId,
      sourceKeys: ['openWorldRuntime'],
    })
    expect(context.included).toEqual(['openWorldRuntime'])
    expect(context.text).toContain('【文字开放世界vNext玩家视角】vNext-only玩家入口')
    expect(context.text).toContain('【当前位置】盐港／盐港')

    const wrongWorld = await assembleContext({
      projectId: created.scope.projectId,
      scope: created.scope,
      worldGroupId: 404,
      productRuntimeSessionId: startedSessionId,
      sourceKeys: ['openWorldRuntime'],
    })
    expect(wrongWorld.included).toEqual([])
    expect(wrongWorld.text).toBe('')

    const tampered = JSON.parse(created.release.manifestJson)
    tampered.runtimePackage.textOpenWorldVNext.metadata.title = '被篡改的vNext-only发布'
    await db.productReleases.update(created.release.id!, { manifestJson: JSON.stringify(tampered) })
    await useTextOpenWorldPlayerStore.getState().load(created.scope, null)
    const rejected = useTextOpenWorldPlayerStore.getState().releases
      .find(item => item.release.id === created.release.id)
    expect(rejected?.manifest).toBeNull()
    expect(rejected?.error).toMatch(/packageHash|已被篡改/)
  }, 20_000)

  it('新ProductRelease不迁移旧存档，投影不能混用另一Release的vNext包', async () => {
    const firstPackage = createTextOpenWorldVNextFixture()
    const created = await createGovernedTextOpenWorldSessionFixtureV1({
      name: 'TEXT-OPEN-WORLD 多版本验收', textOpenWorldVNext: firstPackage,
      title: 'v1存档', seed: 'release-v1',
    })
    const secondPackage = structuredClone(firstPackage)
    secondPackage.metadata.description = '第二版盐脊运行包。'
    const secondRuntime = createTextOpenWorldProductRuntimePackageFixtureV1(secondPackage)
    const secondManifest = await createFixtureProductReleaseManifestV1({
      runtimePackage: secondRuntime,
      productionKey: created.manifest.productionProvenance.productionKey,
      releaseVersion: 2,
      parentRelease: {
        releaseUid: created.manifest.lineage.releaseUid,
        releaseHash: created.manifest.lineage.releaseHash,
      },
    })
    const now = Date.now()
    const secondRelease: ProductRelease = {
      projectId: created.scope.projectId, worldId: created.scope.worldId, workId: created.scope.workId,
      productionKey: secondManifest.productionProvenance.productionKey,
      productType: 'text-open-world', worldReleaseId: null, version: 2, label: '盐脊 v2',
      manifestJson: JSON.stringify(secondManifest),
      contentHash: await hashProductProductionValueV2(secondManifest), createdAt: now,
    }
    secondRelease.id = await db.productReleases.add(secondRelease) as number
    const secondSession = await createTextOpenWorldInstance({
      scope: created.scope, productReleaseId: secondRelease.id,
      title: 'v2存档', seed: 'release-v2',
    })
    expect((await db.productRuntimeSessions.get(created.session.id!))?.productReleaseId).toBe(created.release.id)
    expect(secondSession.productReleaseId).toBe(secondRelease.id)

    const firstRow = await db.productRuntimeSessions.get(created.session.id!)
    const firstInitial = JSON.parse(firstRow!.initialStateJson)
    firstInitial.textOpenWorld = createInitialTextOpenWorldSessionProjectionV1(secondPackage)
    await db.productRuntimeSessions.update(created.session.id!, { initialStateJson: JSON.stringify(firstInitial) })
    await expect(verifyTextOpenWorldVNextSessionBindingV1((await db.productRuntimeSessions.get(created.session.id!))!))
      .rejects.toThrow(/vNext RuntimePackage与ProductRelease\/Build不一致/)
  })

  it('命令边界重新核验冻结来源，检查点子分支继续固定父ProductRelease', async () => {
    const created = await createGovernedTextOpenWorldSessionFixtureV1({
      name: 'TEXT-OPEN-WORLD 命令绑定验收', textOpenWorldVNext: createTextOpenWorldVNextFixture(),
      title: '绑定测试', seed: 'binding-seed',
    })
    const base = await readProductRuntimeStateVersion(created.session.id!)
    const command = {
      schema: 'storyforge.text-open-world.command' as const, version: 1 as const,
      commandId: 'command.binding.1', sessionId: created.session.id!, actorKey: 'player',
      actionKey: 'action.investigate-channel', payload: { targetKey: 'location.salt-port' },
      baseSequence: base.sequence, baseStateHash: base.stateHash,
      source: 'system-action' as const, requestedAt: 1_000,
    }
    await db.productRuntimeSessions.update(created.session.id!, { runtimeSourceHash: 'f'.repeat(64) })
    await expect(commitTextOpenWorldCommandV1(command)).rejects.toThrow(/冻结运行包 hash|冻结 Product Release/)
    await db.productRuntimeSessions.update(created.session.id!, { runtimeSourceHash: created.manifest.packageHash })

    const checkpoint = await createTextOpenWorldCheckpointV1({ sessionId: created.session.id!, name: 'Release起点' })
    const child = await branchTextOpenWorldSessionFromCheckpointV1({ checkpointId: checkpoint.id!, title: 'Release分支' })
    expect(child).toMatchObject({
      productReleaseId: created.release.id, productBuildId: null,
      runtimeSourceHash: created.manifest.packageHash, parentSessionId: created.session.id,
    })
    expect(await hashProductRuntimeStateV1(await readProductRuntimeState(child.id!))).toMatch(/^[a-f0-9]{64}$/)
  })
})
