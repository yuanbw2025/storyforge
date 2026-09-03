import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { prepareProductProductionAdoption } from '../../src/lib/product-production/adoption'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { draftProductProductionBriefV3, suggestProductStartingPoints } from '../../src/lib/product-production/consultation'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { PRODUCT_BROWSER_PERFORMANCE_POLICY_V1 } from '../../src/lib/product-production/browser-performance'
import {
  resolveProductMediaProviderAdapterV1,
  type MediaProviderTransportV1,
  type RedactedMediaTransportRequestV1,
} from '../../src/lib/product-production/media-adapters'
import type { ResolvedProductMediaCapabilityV1 } from '../../src/lib/product-production/media-transport'
import {
  createBuiltInProductionCapabilityBindingV1,
  createConfiguredProductProductionExecutorV1,
  isolateCharacterProviderPromptV1,
  parseProductMediaRequirementsArtifactV2,
  parseProductionModelJsonObjectV1,
  type ProductionTextRunnerV1,
} from '../../src/lib/product-production/production-executor'
import { runProductProductionUntilBlockedV1 } from '../../src/lib/product-production/scheduler'
import { parseProductRuntimePackageV1 } from '../../src/lib/product-production/runtime-package'
import { resolveProductRuntimeSource } from '../../src/lib/product-production/preview-source'
import {
  recordProductBrowserPerformanceMeasurementV1,
  recordProductBuildMainRoutePlaythroughV1,
  recordProductMediaRuntimeMeasurementV1,
} from '../../src/lib/product-production/quality-receipts'
import { beginProductProductionEvolutionV1, publishProductProductionV1, startProductProductionPreviewV1 } from '../../src/lib/product-production/service'
import {
  commitNarrativeChoice,
  readProductRuntimeState,
  readProductRuntimeStateVersion,
} from '../../src/lib/product/runtime-api'
import {
  completeTtrpgSessionZero,
  openTtrpgCampaignScene,
  submitTtrpgActionIntentV2,
} from '../../src/lib/ttrpg/runtime-api'
import { reachAvgPresentationBeat } from '../../src/lib/avg/runtime-api'
import {
  configureTtrpgSessionParticipantV2,
  readTtrpgSessionParticipantsV2,
} from '../../src/lib/ttrpg/participants'
import type { ProductionProductKindV1 } from '../../src/lib/types'
import { seedCurrentProductWorld } from '../helpers/current-product-world'

async function fixture(qualityProfile: 'prototype' | 'commercial-candidate' = 'prototype') {
  const owned = await seedCurrentProductWorld('formal-executor')
  const release = owned.release
  const suggestions = await suggestProductStartingPoints({ scope: owned.scope, worldReleaseId: release.id! })
  const brief = await draftProductProductionBriefV3({
    scope: owned.scope, worldReleaseId: release.id!, suggestionKey: suggestions.suggestions[0].suggestionKey,
    productType: 'avg', qualityProfile, scale: 'scene', visualLevel: 'key-scenes', audioLevel: 'music-sfx',
    requiredFacts: ['冻结世界事实保持一致'], forbiddenChanges: ['不得写回世界正式表'],
  })
  const created = await executeProductProductionCommand({
    scope: owned.scope,
    command: {
      type: 'create-intent', commandId: 'formal.intent', productionKey: 'formal.production',
      productType: 'avg', worldReleaseId: release.id!, userText: '正式自动制作 AVG',
    },
  })
  const saved = await executeProductProductionCommand({
    scope: owned.scope, productionId: created.productionId,
    command: {
      type: 'save-brief-revision', commandId: 'formal.brief', expectedStateRevision: 0,
      parentRevision: null, brief,
    },
  })
  await executeProductProductionCommand({
    scope: owned.scope, productionId: created.productionId,
    command: {
      type: 'authorize-start', commandId: 'formal.authorize', expectedStateRevision: 1,
      briefRevision: 1, briefHash: saved.result.briefHash as string, authorizationNonce: 'formal.click',
    },
  })
  return { ...owned, release, brief, productionId: created.productionId }
}

async function fixtureForProduct(productType: ProductionProductKindV1) {
  const owned = await seedCurrentProductWorld(`formal-${productType}`)
  const release = owned.release
  const suggestions = await suggestProductStartingPoints({ scope: owned.scope, worldReleaseId: release.id! })
  const brief = await draftProductProductionBriefV3({
    scope: owned.scope, worldReleaseId: release.id!, suggestionKey: suggestions.suggestions[0].suggestionKey,
    productType, qualityProfile: 'prototype', scale: 'scene', visualLevel: 'none', audioLevel: 'none',
    playerRole: `扮演 ${productType} 的冻结世界行动者`,
    openingSituation: `从用户确认的雾港潮门入口开始 ${productType} 体验。`,
    requiredFacts: ['冻结世界事实保持一致'], forbiddenChanges: ['不得写回世界正式表'],
    confirmTtrpgDefaultMappings: productType === 'ttrpg',
  })
  const created = await executeProductProductionCommand({
    scope: owned.scope,
    command: {
      type: 'create-intent', commandId: `current.${productType}.intent`, productionKey: `current.${productType}`,
      productType, worldReleaseId: release.id!, userText: `正式自动制作 ${productType}`,
    },
  })
  const saved = await executeProductProductionCommand({
    scope: owned.scope, productionId: created.productionId,
    command: {
      type: 'save-brief-revision', commandId: `six.${productType}.brief`, expectedStateRevision: 0,
      parentRevision: null, brief,
    },
  })
  if (!saved.ok) {
    throw new Error(`save ${productType} failed: ${saved.errorCode ?? 'unknown'} ${String(saved.result.message ?? '')}`)
  }
  const authorized = await executeProductProductionCommand({
    scope: owned.scope, productionId: created.productionId,
    command: {
      type: 'authorize-start', commandId: `six.${productType}.authorize`, expectedStateRevision: 1,
      briefRevision: 1, briefHash: saved.result.briefHash as string, authorizationNonce: `six.${productType}.click`,
    },
  })
  if (!authorized.ok) {
    throw new Error(`authorize ${productType} failed: ${authorized.errorCode ?? 'unknown'} ${String(authorized.result.message ?? '')}`)
  }
  return { ...owned, release, brief, productionId: created.productionId }
}

function firstCharacterAnchor(brief: Awaited<ReturnType<typeof fixture>>['brief']): string {
  const selected = brief.source.selection.roleBindings.characters
    ?? brief.source.selection.roleBindings.participants ?? []
  return selected.length ? 'character:1' : 'intent:protagonist'
}

async function completeAvgBuildPreviewMainRoute(input: {
  scope: Awaited<ReturnType<typeof fixture>>['scope']
  productionId: number
}): Promise<number> {
  const opened = await startProductProductionPreviewV1({
    scope: input.scope, productionId: input.productionId, worldGroupId: null,
  })
  expect(opened.productType).toBe('avg')
  for (let turn = 0; turn < 30; turn += 1) {
    let state = await readProductRuntimeState(opened.sessionId)
    if (state.narrative?.completed) return opened.sessionId
    const nodeKey = state.narrative?.currentNodeKey
    if (!nodeKey) throw new Error('商业 AVG 主路线缺少当前节点')
    const beats = (state.narrative?.beats ?? [])
      .filter(beat => beat.nodeKey === nodeKey)
      .sort((left, right) => left.order - right.order || left.beatKey.localeCompare(right.beatKey))
    const reachedIndex = state.presentation?.currentNodeKey === nodeKey && state.presentation.currentBeatKey
      ? beats.findIndex(beat => beat.beatKey === state.presentation!.currentBeatKey) : -1
    for (const beat of beats.slice(reachedIndex + 1)) {
      const base = await readProductRuntimeStateVersion(opened.sessionId)
      await reachAvgPresentationBeat({
        sessionId: opened.sessionId, beatKey: beat.beatKey,
        commandId: `commercial-preview:beat:${opened.sessionId}:${beat.beatKey}`,
        baseSequence: base.sequence, baseStateHash: base.stateHash,
        snapshotKey: `commercial-preview:${nodeKey}`,
      })
    }
    state = await readProductRuntimeState(opened.sessionId)
    const choiceKey = state.narrative?.availableChoiceKeys?.[0]
    if (!choiceKey) throw new Error('商业 AVG 主路线没有可提交选择')
    const base = await readProductRuntimeStateVersion(opened.sessionId)
    await commitNarrativeChoice({
      sessionId: opened.sessionId, choiceKey,
      commandId: `commercial-preview:choice:${opened.sessionId}:${turn}`,
      baseSequence: base.sequence, baseStateHash: base.stateHash,
    })
  }
  throw new Error('商业 AVG 主路线在 30 次选择内未到达结局')
}

function modelOutputs(
  worldHash: string,
  productType: ProductionProductKindV1 = 'avg',
  characterAnchorRef = 'character:0',
  playerRole = '扮演冻结 Brief 主角',
) {
  return {
    'content.design': {
      schema: 'storyforge.product-design-artifact', version: 1, title: '雾港抉择',
      logline: '玩家必须在潮汐封锁前选择真相或庇护。', playerGoal: '调查港口信号并决定公开何种事实。',
      coreLoop: ['阅读现场', '作出选择', '承受后果'], sourceAnchors: [`world:${worldHash}`],
      invariants: ['冻结世界事实保持一致', '不得写回世界正式表'], tone: ['沉浸', '克制'],
      targetPlayMinutes: 20, targetEndingCount: 2,
    },
    'content.narrative': {
      schema: 'storyforge.product-narrative-artifact', version: 1, moduleKind: 'main', moduleTitle: '雾港抉择',
      entryNodeKey: 'opening',
      nodes: [
        { key: 'opening', kind: 'entry', title: '潮门之前', summary: '玩家抵达信号塔。', condition: {}, effects: [] },
        { key: '公开真相结局', kind: 'scene', title: '公开真相', summary: '真相改变了港口。', condition: {}, effects: [] },
        { key: 'shelter-ending', kind: 'ending', title: '守住庇护', summary: '秘密换来短暂安稳。', condition: {}, effects: [] },
        { key: '未连接草稿', kind: 'scene', title: '未采用草稿', summary: '供应商附带但入口不可达的草稿节点。', condition: {}, effects: [] },
      ],
      beats: [
        { beatKey: 'beat.opening', nodeKey: 'opening', kind: 'narration', speakerKey: null, text: '潮声压过了塔顶的警铃。', order: 0 },
        { beatKey: '真相段落', nodeKey: '公开真相结局', kind: 'narration', speakerKey: null, text: '灯光把所有证词投向海面。', order: 0 },
        { beatKey: 'beat.shelter', nodeKey: 'shelter-ending', kind: 'narration', speakerKey: null, text: '门重新合拢，秘密仍在呼吸。', order: 0 },
        { beatKey: '草稿段落', nodeKey: '未连接草稿', kind: 'narration', speakerKey: null, text: '这段草稿不进入可玩闭包。', order: 0 },
      ],
      choices: [
        { choiceKey: '公开真相选项', sourceNodeKey: 'opening', text: '公开信号记录', description: '承担真相的后果', unavailableReason: '', targetNodeKey: '公开真相结局', displayCondition: {}, availableCondition: {}, effects: [], tags: ['真相'], order: 0 },
        { choiceKey: 'choice.shelter', sourceNodeKey: 'opening', text: '封存信号记录', description: '保护眼前的人', unavailableReason: '', targetNodeKey: 'shelter-ending', displayCondition: {}, availableCondition: {}, effects: [], tags: ['shelter'], order: 1 },
      ],
    },
    'content.product-module': {
      schema: 'storyforge.product-module-artifact', version: 1, productType,
      interfaceStyle: '低饱和雾港舞台，文字保持高对比。', interactionNotes: ['每次选择后明确展示后果。'],
      presentationPolicy: { pacing: 'balanced', transitionMs: 500, backgroundStrategy: 'key-scenes' },
    },
    'media.requirements': {
      schema: 'storyforge.product-media-requirements-artifact', version: 2,
      visual: [
        { artifactKey: 'media.visual.001', mediaKind: 'background', sceneTag: 'opening', beatKey: 'beat.opening', prompt: '雾港信号塔与潮门的宽幅原创场景。', altText: '雾中的港口信号塔和潮门。', width: 1280, height: 720, palette: ['#0d1b2a', '#31506b', '#d8b26e'], characterAnchorRefs: [], hardConstraints: [] },
        { artifactKey: 'media.visual.002', mediaKind: 'character-pose', sceneTag: 'protagonist', beatKey: 'beat.opening', prompt: '披风主角的原创剪影立绘。', altText: '站在雾中的披风主角。', width: 720, height: 1080, palette: ['#14213d', '#6c7a89', '#e5c07b'], characterAnchorRefs: [characterAnchorRef], hardConstraints: ['不得写回世界正式表', '保持角色身份、年龄段与核心视觉特征', `角色定位：${playerRole}`].sort() },
      ],
      audio: [
        { artifactKey: 'media.audio.001', mediaKind: 'bgm', sceneTag: 'opening', beatKey: 'beat.opening', prompt: '雾港开场的克制主题音。', altText: '低沉而克制的雾港主题音。', durationMs: 3000 },
        { artifactKey: 'media.audio.002', mediaKind: 'sfx', sceneTag: 'opening-bell', beatKey: 'beat.opening', prompt: '远处的港口警铃。', altText: '远处港口警铃声。', durationMs: 1000 },
        { artifactKey: 'media.audio.003', mediaKind: 'sfx', sceneTag: 'truth-light', beatKey: 'beat.truth', prompt: '信号灯启动的短促电流声。', altText: '信号灯启动声。', durationMs: 1000 },
        { artifactKey: 'media.audio.004', mediaKind: 'sfx', sceneTag: 'shelter-door', beatKey: 'beat.shelter', prompt: '沉重潮门缓慢闭合。', altText: '潮门闭合声。', durationMs: 1000 },
      ],
    },
  } as const
}

async function relayCapabilities(brief: Awaited<ReturnType<typeof fixture>>['brief'], calls: RedactedMediaTransportRequestV1[]) {
  const png = (width: number, height: number) => {
    const bytes = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0, 0, 0, 0, 0, 0, 0, 0,
    ])
    const view = new DataView(bytes.buffer)
    view.setUint32(16, width, false); view.setUint32(20, height, false)
    return String.fromCharCode(...bytes)
  }
  const transport: MediaProviderTransportV1 = {
    executionLocation: 'trusted-relay',
    async request(request) {
      calls.push(structuredClone(request))
      if (request.adapterId === 'openai.gpt-image-2.v1') return {
        status: 200, contentType: 'application/json', body: null,
        json: { created: 1, data: [{
          b64_json: btoa(png(String(request.body.prompt).includes('主角') ? 720 : 1280,
            String(request.body.prompt).includes('主角') ? 1080 : 720)),
          revised_prompt: '原创雾港构图',
        }] },
        providerRequestId: request.requestId, usage: { outputImages: 1 }, costUsd: 0.02,
      }
      return {
        status: 200, contentType: 'audio/mpeg',
        body: Uint8Array.from([0x49, 0x44, 0x33, 0x04]).buffer, json: null,
        providerRequestId: request.requestId, usage: { outputAudio: 1 }, costUsd: 0.01,
      }
    },
  }
  const resolved = new Map<string, ResolvedProductMediaCapabilityV1>()
  for (const requirement of brief.capabilityRequirements.filter(item => ['image', 'music', 'sfx'].includes(item.mediaClass))) {
    const adapterId = requirement.mediaClass === 'image'
      ? 'openai.gpt-image-2.v1'
      : requirement.mediaClass === 'music' ? 'elevenlabs.music.v2' : 'elevenlabs.sound-effects.v2'
    const capabilityHash = await hashProductProductionValueV2({ requirementKey: requirement.requirementKey, adapterId })
    const adapter = resolveProductMediaProviderAdapterV1(adapterId)
    resolved.set(requirement.requirementKey, {
      adapter, transport,
      binding: { requirementKey: requirement.requirementKey, adapterId, bindingHash: capabilityHash },
      receipt: {
        schema: 'storyforge.media-relay-binding-receipt', version: 1,
        requirementKey: requirement.requirementKey, adapterId, adapterVersion: 1,
        relayOrigin: 'https://relay.fixture.invalid', executionLocation: 'trusted-relay',
        credentialSource: 'relay-session', capabilityHash, boundAt: 1,
        receiptHash: await hashProductProductionValueV2({ requirementKey: requirement.requirementKey, capabilityHash }),
      },
    })
  }
  return resolved
}

describe('R-PRODUCTPROD-1F · provider JSON response normalization', () => {
  it('角色 provider prompt 在冻结前剥离模型夹带的场景描述', () => {
    expect(isolateCharacterProviderPromptV1(
      '青年守灯人，深蓝制服，手持潮汐纸条；背景为灯塔控制室与风暴海面',
      '守灯人立绘',
    )).toBe('青年守灯人，深蓝制服，手持潮汐纸条')
  })

  it('接受原始对象、Markdown 围栏和单一说明文字包装，并正确处理字符串内花括号', () => {
    expect(parseProductionModelJsonObjectV1('{"ok":true}', 'raw')).toEqual({ ok: true })
    expect(parseProductionModelJsonObjectV1('```json\n{"ok":true}\n```', 'fenced')).toEqual({ ok: true })
    expect(parseProductionModelJsonObjectV1(
      '这是请求的结果：\n{"message":"保留 {角色} 与 \\"引号\\"","ok":true}\n以上。',
      'wrapped',
    )).toEqual({ message: '保留 {角色} 与 "引号"', ok: true })
  })

  it('拒绝数组、多个对象、结构损坏和过长输出', () => {
    expect(() => parseProductionModelJsonObjectV1('[{"ok":true}]', 'array')).toThrow('array 必须是对象')
    expect(() => parseProductionModelJsonObjectV1('{"a":1}\n{"b":2}', 'multiple')).toThrow('必须只包含一个完整 JSON 对象')
    expect(() => parseProductionModelJsonObjectV1('```json\n{"a":"unterminated}\n```', 'broken')).toThrow('必须只包含一个完整 JSON 对象')
    expect(() => parseProductionModelJsonObjectV1('x'.repeat(2_000_001), 'large')).toThrow('模型输出为空或过长')
  })
})

describe('R-PRODUCTPROD-1F · configured formal production executor', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('复用非密钥 binding，并行生成内容、视觉、音频，预览后完成三轮连续演化', async () => {
    const owned = await fixture()
    const textRequirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'text')!
    const imageRequirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'image')!
    const audioRequirements = owned.brief.capabilityRequirements.filter(item => item.mediaClass === 'music' || item.mediaClass === 'sfx')
    const bindingHash = await hashProductProductionValueV2({ provider: 'existing-global-config' })
    const outputs = modelOutputs(
      owned.brief.source.worldContentHash,
      'avg',
      firstCharacterAnchor(owned.brief),
      owned.brief.intent.playerRole,
    )
    const forgedAnchors = structuredClone(outputs['media.requirements'])
    forgedAnchors.visual[1].characterAnchorRefs = ['character:999999']
    expect(() => parseProductMediaRequirementsArtifactV2(forgedAnchors, owned.brief))
      .toThrow(/角色锚点未绑定 Brief 冻结角色/)
    const anchoredScene = structuredClone(outputs['media.requirements'])
    anchoredScene.visual[0].characterAnchorRefs = [firstCharacterAnchor(owned.brief)]
    anchoredScene.visual[0].hardConstraints = [
      '不得写回世界正式表',
      '保持角色身份、年龄段与核心视觉特征',
      `角色定位：${owned.brief.intent.playerRole}`,
    ].sort()
    expect(parseProductMediaRequirementsArtifactV2(anchoredScene, owned.brief).visual[0].characterAnchorRefs)
      .toEqual(anchoredScene.visual[0].characterAnchorRefs)
    const weakenedConstraints = structuredClone(outputs['media.requirements'])
    weakenedConstraints.visual[1].hardConstraints = ['模型建议缩小约束']
    expect(parseProductMediaRequirementsArtifactV2(weakenedConstraints, owned.brief).visual[1].hardConstraints)
      .toEqual([
        '不得写回世界正式表',
        '保持角色身份、年龄段与核心视觉特征',
        `角色定位：${owned.brief.intent.playerRole}`,
      ].sort())
    const backgroundSuggestion = structuredClone(outputs['media.requirements'])
    backgroundSuggestion.visual[0].hardConstraints = ['背景不得出现人物']
    expect(parseProductMediaRequirementsArtifactV2(backgroundSuggestion, owned.brief).visual[0].hardConstraints)
      .toEqual([])
    const forgedSceneAnchor = structuredClone(anchoredScene)
    forgedSceneAnchor.visual[0].characterAnchorRefs = ['character:999999']
    expect(() => parseProductMediaRequirementsArtifactV2(forgedSceneAnchor, owned.brief))
      .toThrow(/角色锚点未绑定 Brief 冻结角色/)
    const calls: string[] = []
    const runText: ProductionTextRunnerV1 = async request => {
      const taskKey = Object.keys(outputs).find(key => request.system.includes(`任务=${key}。`)) as keyof typeof outputs
      if (!taskKey) throw new Error('unknown formal model task')
      calls.push(taskKey)
      const output = taskKey === 'content.narrative'
        ? {
            ...outputs[taskKey],
            choices: outputs[taskKey].choices.map((choice, index) => (
              index === 1 ? { ...choice, targetNodeKey: '公开真相结局' } : choice
            )),
          }
        : outputs[taskKey]
      return {
        output: JSON.stringify(output), usage: { inputTokens: 100, outputTokens: 100 },
        bindingReceipt: {
          schema: 'storyforge.provider-binding-receipt', version: 1,
          requirementKey: textRequirement.requirementKey, adapterId: 'configured-text.v1', adapterVersion: 1,
          provider: 'fixture', model: 'fixture-model', endpointOrigin: 'https://fixture.invalid',
          executionLocation: 'browser-direct', credentialSource: 'existing-ai-config', credentialPresent: true,
          capabilityHash: bindingHash, boundAt: 1, receiptHash: 'a'.repeat(64),
        },
      }
    }
    const production = (await db.productProductions.get(owned.productionId))!
    const executor = createConfiguredProductProductionExecutorV1({ production, brief: owned.brief, runText })
    const capabilityBindings = [
      { requirementKey: textRequirement.requirementKey, adapterId: 'configured-text.v1', bindingHash },
      await createBuiltInProductionCapabilityBindingV1({
        requirementKey: imageRequirement.requirementKey, adapterId: 'storyforge.procedural-svg.v1',
      }),
      ...await Promise.all(audioRequirements.map(requirement => createBuiltInProductionCapabilityBindingV1({
        requirementKey: requirement.requirementKey, adapterId: 'storyforge.procedural-audio.v1',
      }))),
    ]
    const projection = await runProductProductionUntilBlockedV1({
      scope: owned.scope, productionId: owned.productionId, executor,
      capabilityBindings,
    })
    expect(projection.terminal).toBe(true)
    expect(calls.sort()).toEqual([
      'content.design', 'content.narrative', 'content.product-module', 'media.requirements',
    ].sort())
    const build = (await db.productBuilds.get(projection.buildId))!
    expect(build.status).toBe('release-ready')
    expect(JSON.parse(build.compatibilityJson)).toMatchObject({
      schema: 'storyforge.product-build-compatibility', level: 'compatible', migrationPolicy: 'initial-session',
    })
    const packageArtifact = await db.productBuildArtifacts
      .where('[buildId+artifactKey]').equals([build.id!, 'runtime.package']).first()
    const runtimePackage = parseProductRuntimePackageV1(packageArtifact!.payloadJson)
    expect(runtimePackage.presentation?.assets).toHaveLength(6)
    expect(runtimePackage.presentation?.cues).toHaveLength(6)
    expect(runtimePackage.presentation?.assets.filter(asset => asset.mimeType === 'audio/wav')).toHaveLength(4)
    expect(await db.mediaBlobObjects.count()).toBe(6)
    const prepared = await prepareProductProductionAdoption({ scope: owned.scope, productionId: owned.productionId })
    expect(prepared).toMatchObject({ productType: 'avg', mediaAssetKeys: expect.arrayContaining([
      'formal.production.build-1.media.visual.001', 'formal.production.build-1.media.visual.002',
    ]) })
    const opened = await startProductProductionPreviewV1({
      scope: owned.scope, productionId: owned.productionId,
    })
    expect(opened.productType).toBe('avg')
    expect(await db.productRuntimeSessions.get(opened.sessionId)).toMatchObject({
      productBuildId: build.id, productReleaseId: null, kind: 'avg', runtimeSourceHash: build.packageHash,
    })
    const playable = await resolveProductRuntimeSource({
      scope: owned.scope,
      source: { kind: 'build', productBuildId: build.id!, expectedPreviewHash: build.previewHash },
    })
    const imageAsset = runtimePackage.presentation!.assets.find(asset => asset.mimeType === 'image/svg+xml')!
    const media = await playable.mediaResolver.read(imageAsset.assetKey)
    expect(media.type).toBe('image/svg+xml')
    expect(media.size).toBeGreaterThan(100)
    playable.mediaResolver.dispose()
    const published = await publishProductProductionV1({
      scope: owned.scope, productionId: owned.productionId,
    })
    const releasedPlayable = await resolveProductRuntimeSource({
      scope: owned.scope,
      source: { kind: 'release', productReleaseId: published.receipt.productReleaseId },
    })
    expect(releasedPlayable.packageHash).toBe(build.packageHash)
    expect(releasedPlayable.runtimePackage).toEqual(runtimePackage)
    const releasedMedia = await releasedPlayable.mediaResolver.read(imageAsset.assetKey)
    expect(releasedMedia.size).toBe(media.size)
    releasedPlayable.mediaResolver.dispose()
    const evolution = await beginProductProductionEvolutionV1({
      scope: owned.scope, productionId: owned.productionId,
      userText: '承接守住庇护的结局，让原来的配角调查第二座信号塔。',
    })
    const nextBriefRow = await db.productProductionBriefs
      .where('[productionId+revision]').equals([owned.productionId, evolution.briefRevision]).first()
    expect(nextBriefRow).toMatchObject({ parentRevision: 1, status: 'draft' })
    expect(JSON.parse(nextBriefRow!.briefJson)).toMatchObject({
      intent: { openingSituation: '承接守住庇护的结局，让原来的配角调查第二座信号塔。' },
      unresolvedDecisionKeys: [],
    })
    expect(await db.productProductions.get(owned.productionId)).toMatchObject({
      status: 'brief-ready', currentBriefRevision: evolution.briefRevision, currentBuildNumber: 1,
    })
    const currentProduction = (await db.productProductions.get(owned.productionId))!
    const authorized = await executeProductProductionCommand({
      scope: owned.scope, productionId: owned.productionId,
      command: {
        type: 'authorize-start', commandId: 'formal.evolution.authorize',
        expectedStateRevision: currentProduction.stateRevision,
        briefRevision: evolution.briefRevision, briefHash: nextBriefRow!.briefHash,
        authorizationNonce: 'formal.evolution.click',
      },
    })
    expect(authorized).toMatchObject({ ok: true, result: { buildNumber: 2 } })
    const nextBrief = parseProductProductionBriefV3(nextBriefRow!.briefJson)
    const evolvedProjection = await runProductProductionUntilBlockedV1({
      scope: owned.scope, productionId: owned.productionId,
      executor: createConfiguredProductProductionExecutorV1({
        production: (await db.productProductions.get(owned.productionId))!, brief: nextBrief, runText,
      }),
      capabilityBindings,
    })
    expect(evolvedProjection.terminal).toBe(true)
    expect(await db.productBuilds.get(evolvedProjection.buildId)).toMatchObject({
      buildNumber: 2, parentBuildNumber: 1, sourceProductReleaseId: published.receipt.productReleaseId,
      status: 'release-ready',
    })
    expect(JSON.parse((await db.productBuilds.get(evolvedProjection.buildId))!.compatibilityJson)).toMatchObject({
      schema: 'storyforge.product-build-compatibility', fromBuildNumber: 1, toBuildNumber: 2,
      level: 'compatible', migrationPolicy: 'identity',
    })
    expect(await db.productBuilds.get(build.id!)).toMatchObject({
      status: 'released', previewHash: build.previewHash, releasedProductReleaseId: published.receipt.productReleaseId,
    })
    expect(await db.productRuntimeSessions.get(opened.sessionId)).toMatchObject({ productBuildId: build.id })

    let previousBuildNumber = 2
    for (const [index, goal] of [
      '继续第二座信号塔的调查，让第一轮选择改变可用路线与同伴态度。',
      '把已经揭示的真相推进到港口议会，保留前三版全部后果并增加最终抉择。',
    ].entries()) {
      const nextEvolution = await beginProductProductionEvolutionV1({
        scope: owned.scope, productionId: owned.productionId, userText: goal,
      })
      const row = await db.productProductionBriefs
        .where('[productionId+revision]').equals([owned.productionId, nextEvolution.briefRevision]).first()
      const productionBeforeStart = (await db.productProductions.get(owned.productionId))!
      await executeProductProductionCommand({
        scope: owned.scope, productionId: owned.productionId,
        command: {
          type: 'authorize-start', commandId: `formal.evolution.${index + 2}.authorize`,
          expectedStateRevision: productionBeforeStart.stateRevision,
          briefRevision: nextEvolution.briefRevision, briefHash: row!.briefHash,
          authorizationNonce: `formal.evolution.${index + 2}.click`,
        },
      })
      const parsedBrief = parseProductProductionBriefV3(row!.briefJson)
      const nextProjection = await runProductProductionUntilBlockedV1({
        scope: owned.scope, productionId: owned.productionId,
        executor: createConfiguredProductProductionExecutorV1({
          production: (await db.productProductions.get(owned.productionId))!, brief: parsedBrief, runText,
        }),
        capabilityBindings,
      })
      expect(nextProjection.terminal).toBe(true)
      const nextBuild = (await db.productBuilds.get(nextProjection.buildId))!
      expect(nextBuild).toMatchObject({
        buildNumber: previousBuildNumber + 1, parentBuildNumber: previousBuildNumber,
        sourceProductReleaseId: published.receipt.productReleaseId, status: 'release-ready',
      })
      previousBuildNumber = nextBuild.buildNumber
    }
    expect(previousBuildNumber).toBe(4)
    expect(await db.productBuilds.where('productionId').equals(owned.productionId).count()).toBe(4)
    expect(await db.productReleases.get(published.receipt.productReleaseId)).toMatchObject({
      contentHash: published.receipt.releaseContentHash,
    })
    expect(await db.productRuntimeSessions.get(opened.sessionId)).toMatchObject({
      productBuildId: build.id, runtimeSourceHash: build.packageHash,
    })
  }, 30_000)

  it('商业候选通过可信中继生成可验证 PNG/MP3，且执行请求与冻结证据不含 API Key', async () => {
    const owned = await fixture('commercial-candidate')
    const textRequirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'text')!
    const textBindingHash = await hashProductProductionValueV2({ provider: 'existing-global-config' })
    const outputs = modelOutputs(
      owned.brief.source.worldContentHash,
      'avg',
      firstCharacterAnchor(owned.brief),
      owned.brief.intent.playerRole,
    )
    const runText: ProductionTextRunnerV1 = async request => {
      const taskKey = Object.keys(outputs).find(key => request.system.includes(`任务=${key}。`)) as keyof typeof outputs
      if (!taskKey) throw new Error('unknown formal model task')
      return {
        output: JSON.stringify(outputs[taskKey]), usage: { inputTokens: 100, outputTokens: 100 },
        bindingReceipt: {
          schema: 'storyforge.provider-binding-receipt', version: 1,
          requirementKey: textRequirement.requirementKey, adapterId: 'configured-text.v1', adapterVersion: 1,
          provider: 'fixture', model: 'fixture-model', endpointOrigin: 'https://fixture.invalid',
          executionLocation: 'browser-direct', credentialSource: 'existing-ai-config', credentialPresent: true,
          capabilityHash: textBindingHash, boundAt: 1, receiptHash: 'b'.repeat(64),
        },
      }
    }
    const relayCalls: RedactedMediaTransportRequestV1[] = []
    const mediaCapabilities = await relayCapabilities(owned.brief, relayCalls)
    const capabilityBindings = [
      { requirementKey: textRequirement.requirementKey, adapterId: 'configured-text.v1', bindingHash: textBindingHash },
      ...[...mediaCapabilities.values()].map(item => item.binding),
    ]
    const projection = await runProductProductionUntilBlockedV1({
      scope: owned.scope, productionId: owned.productionId,
      executor: createConfiguredProductProductionExecutorV1({
        production: (await db.productProductions.get(owned.productionId))!,
        brief: owned.brief, runText, mediaCapabilities,
      }),
      capabilityBindings,
    })
    expect(projection.terminal).toBe(true)
    expect(relayCalls).toHaveLength(6)
    expect(JSON.stringify(relayCalls)).not.toMatch(/api[-_]?key|authorization|bearer\s|sk-/i)
    const characterImageCall = relayCalls.find(call => call.adapterId === 'openai.gpt-image-2.v1'
      && String(call.body.prompt).includes('冻结角色锚点'))
    expect(characterImageCall?.body.prompt).toContain('保持角色身份、年龄段与核心视觉特征')
    const backgroundImageCall = relayCalls.find(call => call.adapterId === 'openai.gpt-image-2.v1'
      && !String(call.body.prompt).includes('冻结角色锚点'))
    expect(backgroundImageCall?.body.prompt).toContain('不得出现任何人物、肖像、人形、倒影、剪影或照片')
    const build = (await db.productBuilds.get(projection.buildId))!
    expect(build.status).toBe('preview-ready')
    const media = await db.productBuildArtifacts.where('buildId').equals(build.id!).toArray()
    const providerMedia = media.filter(item => item.blobObjectId != null)
    expect(providerMedia.filter(item => item.mimeType === 'image/png')).toHaveLength(2)
    expect(providerMedia.filter(item => item.mimeType === 'audio/mpeg')).toHaveLength(4)
    for (const artifact of providerMedia) {
      expect(JSON.parse(artifact.qualityJson)).toMatchObject({
        mimeVerified: true, contentHashVerified: true,
        providerReceiptHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      })
      expect(JSON.parse(artifact.rightsJson)).toMatchObject({
        origin: 'generated', commercialUse: true,
        license: expect.stringMatching(/^rights-policy:/),
      })
      expect(artifact.qualityJson).not.toContain('outputImages')
      expect(artifact.qualityJson).not.toContain('outputAudio')
    }
    const characterArtifact = providerMedia.find(item => item.mediaKind === 'character-pose')!
    expect(JSON.parse(characterArtifact.qualityJson)).toMatchObject({
      anchorRulesHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      characterAnchorRefs: [firstCharacterAnchor(owned.brief)],
      hardConstraintsApplied: expect.arrayContaining([
        '不得写回世界正式表', '保持角色身份、年龄段与核心视觉特征',
        `角色定位：${owned.brief.intent.playerRole}`,
      ]),
    })
    // The shared blob store deduplicates the four identical fixture audio bytes.
    expect(await db.mediaBlobObjects.count()).toBe(3)
    await expect(prepareProductProductionAdoption({
      scope: owned.scope, productionId: owned.productionId,
    })).rejects.toThrow(/商业候选缺少真实浏览器性能回执/)
    await recordProductBrowserPerformanceMeasurementV1({
      scope: owned.scope, productBuildId: build.id!,
      measurement: {
        browserName: 'chromium', browserVersion: 'fixture', platform: 'desktop',
        viewport: { width: 1440, height: 900 }, packageHash: build.packageHash, previewHash: build.previewHash,
        firstInteractiveBytes: 2 * 1024 * 1024,
        cachedSceneLatenciesMs: Array.from({ length: 20 }, (_, index) => 40 + index),
        choiceInputLatenciesMs: Array.from({ length: 20 }, (_, index) => 20 + index),
        memorySamples: [
          { elapsedMs: PRODUCT_BROWSER_PERFORMANCE_POLICY_V1.warmupDurationMs, usedHeapBytes: 100 * 1024 * 1024 },
          { elapsedMs: PRODUCT_BROWSER_PERFORMANCE_POLICY_V1.minimumLongRunDurationMs, usedHeapBytes: 108 * 1024 * 1024 },
        ],
        measuredAt: Date.now(),
      },
    })
    expect(await db.productBuilds.get(build.id!)).toMatchObject({ status: 'preview-ready' })
    await expect(prepareProductProductionAdoption({
      scope: owned.scope, productionId: owned.productionId,
    })).rejects.toThrow(/真实主路线试玩回执/)
    const sessionId = await completeAvgBuildPreviewMainRoute({
      scope: owned.scope, productionId: owned.productionId,
    })
    await recordProductBuildMainRoutePlaythroughV1({
      scope: owned.scope, productBuildId: build.id!, productRuntimeSessionId: sessionId,
      authorConfirmation: 'author-confirmed-main-route',
      environment: {
        browserName: 'chromium', browserVersion: 'fixture', platform: 'desktop',
        viewport: { width: 1440, height: 900 },
      },
    })
    expect(await db.productBuilds.get(build.id!)).toMatchObject({ status: 'preview-ready' })
    await expect(prepareProductProductionAdoption({
      scope: owned.scope, productionId: owned.productionId,
    })).rejects.toThrow(/媒资解码回执/)
    const runtimeArtifact = await db.productBuildArtifacts
      .where('[buildId+artifactKey]').equals([build.id!, 'runtime.package']).first()
    const runtime = parseProductRuntimePackageV1(runtimeArtifact!.payloadJson)
    await recordProductMediaRuntimeMeasurementV1({
      scope: owned.scope, productBuildId: build.id!,
      measurement: {
        assets: [...runtime.presentation!.assets]
          .sort((left, right) => left.assetKey.localeCompare(right.assetKey))
          .map(asset => asset.mimeType.startsWith('image/') ? {
            assetKey: asset.assetKey, contentHash: asset.blobContentHash, mimeType: asset.mimeType,
            mediaClass: 'image' as const, status: 'decoded' as const,
            decodedWidth: asset.width!, decodedHeight: asset.height!, decodedDurationMs: null,
            decodedHasAlpha: asset.kind === 'character-pose' || asset.kind === 'character-expression',
            decodedChannelCount: null, decodedSampleRateHz: null, integratedLufs: null,
            truePeakDbtp: null, loopSeamDbfs: null, policyFailures: [], failureCode: null,
          } : {
            assetKey: asset.assetKey, contentHash: asset.blobContentHash, mimeType: asset.mimeType,
            mediaClass: 'audio' as const, status: 'decoded' as const,
            decodedWidth: null, decodedHeight: null, decodedDurationMs: asset.durationMs!,
            decodedHasAlpha: null, decodedChannelCount: 2, decodedSampleRateHz: 44_100,
            integratedLufs: -18, truePeakDbtp: -2, loopSeamDbfs: -40,
            policyFailures: [], failureCode: null,
          }),
        environment: {
          browserName: 'chromium', browserVersion: 'fixture', platform: 'desktop',
          viewport: { width: 1440, height: 900 },
        },
        measuredAt: Date.now(),
      },
    })
    expect(await db.productBuilds.get(build.id!)).toMatchObject({ status: 'release-ready' })
    await expect(prepareProductProductionAdoption({
      scope: owned.scope, productionId: owned.productionId,
    })).resolves.toMatchObject({ productType: 'avg' })
  }, 30_000)

  it('作者声明只改玩法模块时跨 Build 复用未受影响闭包，并重新执行装配与 QA', async () => {
    const owned = await fixture()
    const textRequirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'text')!
    const imageRequirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'image')!
    const audioRequirements = owned.brief.capabilityRequirements.filter(item => item.mediaClass === 'music' || item.mediaClass === 'sfx')
    const bindingHash = await hashProductProductionValueV2({ provider: 'existing-global-config' })
    const outputs = modelOutputs(
      owned.brief.source.worldContentHash,
      'avg',
      firstCharacterAnchor(owned.brief),
      owned.brief.intent.playerRole,
    )
    const calls: string[] = []
    const runText: ProductionTextRunnerV1 = async request => {
      const taskKey = Object.keys(outputs).find(key => request.system.includes(`任务=${key}。`)) as keyof typeof outputs
      if (!taskKey) throw new Error('unknown formal model task')
      calls.push(taskKey)
      return {
        output: JSON.stringify(outputs[taskKey]), usage: { inputTokens: 100, outputTokens: 100 },
        bindingReceipt: {
          schema: 'storyforge.provider-binding-receipt', version: 1,
          requirementKey: textRequirement.requirementKey, adapterId: 'configured-text.v1', adapterVersion: 1,
          provider: 'fixture', model: 'fixture-model', endpointOrigin: 'https://fixture.invalid',
          executionLocation: 'browser-direct', credentialSource: 'existing-ai-config', credentialPresent: true,
          capabilityHash: bindingHash, boundAt: 1, receiptHash: 'c'.repeat(64),
        },
      }
    }
    const capabilityBindings = [
      { requirementKey: textRequirement.requirementKey, adapterId: 'configured-text.v1', bindingHash },
      await createBuiltInProductionCapabilityBindingV1({
        requirementKey: imageRequirement.requirementKey, adapterId: 'storyforge.procedural-svg.v1',
      }),
      ...await Promise.all(audioRequirements.map(requirement => createBuiltInProductionCapabilityBindingV1({
        requirementKey: requirement.requirementKey, adapterId: 'storyforge.procedural-audio.v1',
      }))),
    ]
    const first = await runProductProductionUntilBlockedV1({
      scope: owned.scope, productionId: owned.productionId,
      executor: createConfiguredProductProductionExecutorV1({
        production: (await db.productProductions.get(owned.productionId))!, brief: owned.brief, runText,
      }), capabilityBindings,
    })
    expect(first.terminal).toBe(true)
    expect(await db.mediaBlobObjects.count()).toBe(6)
    calls.length = 0

    const evolved = await beginProductProductionEvolutionV1({
      scope: owned.scope, productionId: owned.productionId,
      userText: '保持剧情和素材不变，只把交互节奏改成更快速的玩法模块。',
      affectedLanes: ['product'],
    })
    const briefRow = await db.productProductionBriefs
      .where('[productionId+revision]').equals([owned.productionId, evolved.briefRevision]).first()
    const production = (await db.productProductions.get(owned.productionId))!
    await executeProductProductionCommand({
      scope: owned.scope, productionId: owned.productionId,
      command: {
        type: 'authorize-start', commandId: 'formal.product-only.authorize',
        expectedStateRevision: production.stateRevision, briefRevision: evolved.briefRevision,
        briefHash: briefRow!.briefHash, authorizationNonce: 'formal.product-only.click',
      },
    })
    const nextBrief = parseProductProductionBriefV3(briefRow!.briefJson)
    expect(nextBrief.evolution).toMatchObject({ affectedLanes: ['product'] })
    expect(nextBrief.intent.openingSituation).toBe(owned.brief.intent.openingSituation)
    const second = await runProductProductionUntilBlockedV1({
      scope: owned.scope, productionId: owned.productionId,
      executor: createConfiguredProductProductionExecutorV1({
        production: (await db.productProductions.get(owned.productionId))!, brief: nextBrief, runText,
      }), capabilityBindings,
    })
    expect(second.terminal).toBe(true)
    expect(calls).toEqual(['content.product-module'])
    const secondBuild = (await db.productBuilds.get(second.buildId))!
    const plan = JSON.parse(secondBuild.planJson) as { tasks: Array<{ taskKey: string; reuse: unknown }> }
    expect(plan.tasks.filter(task => task.reuse != null).map(task => task.taskKey).sort()).toEqual([
      'content.design', 'content.narrative', 'media.audio', 'media.requirements', 'media.visual',
    ])
    const artifacts = await db.productBuildArtifacts.where('buildId').equals(second.buildId).toArray()
    expect(artifacts.filter(item => item.status === 'carried-forward')).toHaveLength(9)
    expect(artifacts.filter(item => item.status === 'accepted').map(item => item.artifactKey).sort()).toEqual([
      'content.product-module', 'quality.report', 'runtime.package',
    ])
    expect(await db.mediaBlobObjects.count()).toBe(6)
  }, 30_000)

  it('五种现行生产产品经过正式生产、可玩 Build Preview 与同包原子发布', async () => {
    const products: ProductionProductKindV1[] = [
      'character-interaction', 'text-adventure', 'avg', 'text-open-world', 'ttrpg',
    ]
    for (const productType of products) {
      const owned = await fixtureForProduct(productType)
      const textRequirement = owned.brief.capabilityRequirements.find(item => item.mediaClass === 'text')!
      expect(owned.brief.capabilityRequirements.filter(item => item.mediaClass !== 'text')).toHaveLength(0)
      const bindingHash = await hashProductProductionValueV2({ provider: 'existing-global-config', productType })
      const outputs = modelOutputs(owned.brief.source.worldContentHash, productType)
      const runText: ProductionTextRunnerV1 = async request => {
        const taskKey = Object.keys(outputs).find(key => request.system.includes(`任务=${key}。`)) as keyof typeof outputs
        if (!taskKey) throw new Error(`unknown ${productType} model task`)
        const output = taskKey === 'media.requirements'
          ? { ...outputs[taskKey], visual: [], audio: [] }
          : outputs[taskKey]
        return {
          output: JSON.stringify(output), usage: { inputTokens: 100, outputTokens: 100 },
          bindingReceipt: {
            schema: 'storyforge.provider-binding-receipt', version: 1,
            requirementKey: textRequirement.requirementKey, adapterId: 'configured-text.v1', adapterVersion: 1,
            provider: 'fixture', model: 'fixture-model', endpointOrigin: 'https://fixture.invalid',
            executionLocation: 'browser-direct', credentialSource: 'existing-ai-config', credentialPresent: true,
            capabilityHash: bindingHash, boundAt: 1, receiptHash: 'd'.repeat(64),
          },
        }
      }
      const projection = await runProductProductionUntilBlockedV1({
        scope: owned.scope, productionId: owned.productionId,
        executor: createConfiguredProductProductionExecutorV1({
          production: (await db.productProductions.get(owned.productionId))!, brief: owned.brief, runText,
        }),
        capabilityBindings: [{
          requirementKey: textRequirement.requirementKey, adapterId: 'configured-text.v1', bindingHash,
        }],
      })
      const projectedBuild = await db.productBuilds.get(projection.buildId)
      expect(
        projection,
        `${productType} production projection:\n${JSON.stringify(projection, null, 2)}\nfailure=${projectedBuild?.failureJson}`,
      ).toMatchObject({ terminal: true, buildStatus: 'release-ready' })
      const build = projectedBuild!
      const packageArtifact = await db.productBuildArtifacts
        .where('[buildId+artifactKey]').equals([build.id!, 'runtime.package']).first()
      const runtimePackage = parseProductRuntimePackageV1(packageArtifact!.payloadJson)
      expect(runtimePackage.productType).toBe(productType)
      expect(runtimePackage.sourceWorld.selection).toEqual(owned.brief.source.selection)
      if (productType === 'ttrpg') {
        expect(runtimePackage.ttrpg).toMatchObject({
          rulePack: { contentHash: owned.brief.ttrpg?.rules.effectiveContentHash },
          campaign: { tags: expect.arrayContaining(['production-campaign-v2']) },
        })
        expect(await db.productBuildArtifacts
          .where('[buildId+artifactKey]').equals([build.id!, 'ttrpg.rule-pack']).count()).toBe(1)
        expect(await db.productBuildArtifacts
          .where('[buildId+artifactKey]').equals([build.id!, 'ttrpg.campaign-pack']).count()).toBe(1)
      }
      const preview = await startProductProductionPreviewV1({
        scope: owned.scope, productionId: owned.productionId,
      })
      expect(preview.productType).toBe(productType)
      expect(await db.productRuntimeSessions.get(preview.sessionId)).toMatchObject({
        productBuildId: build.id, productReleaseId: null, runtimeSourceHash: build.packageHash,
      })
      if (productType === 'ttrpg') {
        const beforeSessionZero = await readProductRuntimeState(preview.sessionId)
        const beforeVersion = await readProductRuntimeStateVersion(preview.sessionId)
        await db.productBuilds.update(build.id!, { previewHash: 'f'.repeat(64) })
        await expect(completeTtrpgSessionZero({
          sessionId: preview.sessionId,
          commandId: 'six.ttrpg.preview.tampered',
          baseSequence: beforeVersion.sequence,
          baseStateHash: beforeVersion.stateHash,
          acceptedItemKeys: beforeSessionZero.ttrpg!.product!.sessionZero.requiredItemKeys,
          completedBy: 'gm',
        })).rejects.toThrow(/Preview|运行源|hash/)
        await db.productBuilds.update(build.id!, { previewHash: build.previewHash })
        const initialParticipants = await readTtrpgSessionParticipantsV2(preview.sessionId)
        for (const participant of initialParticipants) {
          await configureTtrpgSessionParticipantV2({
            sessionId: preview.sessionId,
            seatKey: participant.seatKey,
            expectedRevision: participant.revision,
            commandId: `six.ttrpg.preview.disclose.${participant.seatKey}`,
            requestedByViewerKey: 'viewer.gm',
            consent: { aiIdentityDisclosed: true },
          })
        }
        const sessionZero = await completeTtrpgSessionZero({
          sessionId: preview.sessionId,
          commandId: 'six.ttrpg.preview.session-zero',
          baseSequence: beforeVersion.sequence,
          baseStateHash: beforeVersion.stateHash,
          acceptedItemKeys: beforeSessionZero.ttrpg!.product!.sessionZero.requiredItemKeys,
          completedBy: 'gm',
        })
        expect(sessionZero.type).toBe('ttrpg.session-zero.completed')

        let state = await readProductRuntimeState(preview.sessionId)
        let version = await readProductRuntimeStateVersion(preview.sessionId)
        const openedScene = await openTtrpgCampaignScene({
          sessionId: preview.sessionId,
          commandId: 'six.ttrpg.preview.opening',
          baseSequence: version.sequence,
          baseStateHash: version.stateHash,
          sceneKey: state.ttrpg!.product!.openingSceneKey,
        })
        expect(openedScene.type).toBe('ttrpg.scene.opened')
        state = await readProductRuntimeState(preview.sessionId)
        version = await readProductRuntimeStateVersion(preview.sessionId)
        const gm = (await readTtrpgSessionParticipantsV2(preview.sessionId))
          .find(participant => participant.role === 'gm')!
        const intent = await submitTtrpgActionIntentV2({
          sessionId: preview.sessionId,
          commandId: 'six.ttrpg.preview.intent',
          baseSequence: version.sequence,
          baseStateHash: version.stateHash,
          intentKey: 'intent.preview.inspect',
          actorKey: state.ttrpg!.activeActorKey!,
          rawInput: '我观察潮门周围是否留下了可疑痕迹。',
          submittedBy: { role: 'gm', viewerKey: gm.viewerKey },
        })
        expect(intent.type).toBe('ttrpg.intent.receipted')
      }
      const published = await publishProductProductionV1({
        scope: owned.scope, productionId: owned.productionId,
      })
      const released = await resolveProductRuntimeSource({
        scope: owned.scope, source: { kind: 'release', productReleaseId: published.receipt.productReleaseId },
      })
      expect(released.packageHash).toBe(build.packageHash)
      expect(released.runtimePackage).toEqual(runtimePackage)
      released.mediaResolver.dispose()
    }
  }, 60_000)
})
