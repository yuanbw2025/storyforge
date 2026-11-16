import { putMediaBlobObject, sha256MediaData } from '../../src/lib/product-production/media-blob-store'
import { resolveConfiguredTextCapabilityV1, type ConfiguredProductionVisionImageV1 } from '../../src/lib/product-production/capabilities'
import type { AIConfig, ProductBuildArtifactRecordV1, ProductProductionBriefV3, WorkspaceScope } from '../../src/lib/types'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { db } from '../../src/lib/db/schema'
import { executeProductProductionCommand } from '../../src/lib/product-production/commands'
import { draftProductProductionBriefV3, suggestProductStartingPoints } from '../../src/lib/product-production/consultation'
import { createConfiguredProductProductionExecutorV1, textAdventureVisualBlueprintsV1 } from '../../src/lib/product-production/production-executor'
import { createProductProductionPlanV3 } from '../../src/lib/product-production/plan'
import { seedCurrentProductWorld } from './current-product-world'
import { openProductionFixtureV1 } from './open-ttrpg-production'
import type { ProductProductionTaskExecutionInputV1 } from '../../src/lib/product-production/scheduler'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'

export const SFQA050_CONFIG_A: AIConfig = {
  provider: 'agnes', apiKey: 'sfqa050-synthetic-secret-a', model: 'sfqa050-model-a',
  baseUrl: 'https://sfqa050-a.invalid/v1', temperature: 0.7, maxTokens: 0, contextWindow: 32_768,
}

export const SFQA050_CONFIG_B: AIConfig = {
  provider: 'openai', apiKey: 'sfqa050-synthetic-secret-b', model: 'sfqa050-model-b',
  baseUrl: 'https://sfqa050-b.invalid/v1', temperature: 0.2, maxTokens: 0, contextWindow: 32_768,
}

export function installSFQA050RouteV1(config: AIConfig): void {
  useAIConfigStore.setState({
    presets: [{ id: 'sfqa050-route', name: 'controlled route', config: { ...config } }],
    taskRoutes: { creation: 'sfqa050-route' },
  })
}

/** Existing original 1px engineering PNG; no reference image or real provider. */
export async function sfqa050ImageV1(): Promise<ConfiguredProductionVisionImageV1> {
  const data = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='), c => c.charCodeAt(0)).buffer
  return { artifactKey: 'sfqa050.image', contentHash: await sha256MediaData(data), mimeType: 'image/png', data, detail: 'low' }
}

export interface SFQA050CapturedRequestV1 {
  url: string
  model: unknown
  temperature: unknown
  maximumOutputTokens: unknown
}

export function captureSFQA050RequestV1(input: RequestInfo | URL, init?: RequestInit): SFQA050CapturedRequestV1 {
  const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
  return {
    url: input instanceof Request ? input.url : String(input),
    model: body.model, temperature: body.temperature, maximumOutputTokens: body.max_tokens,
  }
}

export function sfqa050ResponseV1(output = '{"ok":true}'): Response {
  return new Response(JSON.stringify({
    choices: [{ message: { content: output }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}


/** Actual Brief/start commands and current frozen Plan; never seeds Run/ledger. */
export async function authorizeSFQA050ProductionV1(kind: 'avg' | 'general' | 'ttrpg-open', visual = false) {
  let scope: WorkspaceScope, productionId: number, brief: ProductProductionBriefV3
  if (kind === 'ttrpg-open') {
    // The complete Open response schema exceeds the small general fixture window.
    // Freeze a sufficient window before authorizing; never trim its contract.
    useAIConfigStore.setState({ config: { ...useAIConfigStore.getState().config, contextWindow: 131_072 } })
    const open = await openProductionFixtureV1()
    ;({ scope, productionId, brief } = open)
  } else {
    const world = await seedCurrentProductWorld(`SFQA050-${kind}`)
    scope = world.scope
    const suggestions = await suggestProductStartingPoints({ scope, worldReleaseId: world.release.id! })
    const productType = kind === 'avg' ? 'avg' : 'text-adventure'
    brief = await draftProductProductionBriefV3({
      scope, worldReleaseId: world.release.id!, suggestionKey: suggestions.suggestions[0]!.suggestionKey,
      productType, qualityProfile: 'prototype', scale: 'scene', visualLevel: visual ? 'key-scenes' : 'none',
      audioLevel: 'none', playerRole: '守灯人', openingSituation: '核对已冻结的潮门事实。',
      requiredFacts: ['保持冻结世界事实'], forbiddenChanges: ['不得回写世界'],
      ...(productType === 'text-adventure' ? { textAdventure: { confirmAll: true } } : {}),
    })
    const created = await executeProductProductionCommand({ scope, command: {
      type: 'create-intent', commandId: 'sfqa050.intent', productionKey: `sfqa050.${kind}`,
      productType, worldReleaseId: world.release.id!, userText: '作者明确开始受控生产',
    } })
    if (!created.ok) throw new Error(JSON.stringify(created))
    productionId = created.productionId
  }
  const previous = (await db.productProductions.get(productionId))!
  const saved = await executeProductProductionCommand({ scope, productionId, command: {
    type: 'save-brief-revision', commandId: 'sfqa050.save', expectedStateRevision: previous.stateRevision,
    parentRevision: previous.currentBriefRevision, brief,
  } })
  if (!saved.ok) throw new Error(JSON.stringify(saved))
  const current = (await db.productProductions.get(productionId))!
  const row = (await db.productProductionBriefs.where('[productionId+revision]')
    .equals([productionId, current.currentBriefRevision!]).first())!
  const started = await executeProductProductionCommand({ scope, productionId, command: {
    type: 'authorize-start', commandId: 'sfqa050.start', expectedStateRevision: current.stateRevision,
    briefRevision: row.revision, briefHash: row.briefHash, authorizationNonce: 'sfqa050.explicit.author.start',
  } })
  if (!started.ok) throw new Error(JSON.stringify(started))
  const textRequirements = brief.capabilityRequirements.filter(item => item.mediaClass === 'text')
  const capabilityBindings = await Promise.all(textRequirements.map(async requirement => {
    const { receipt } = await resolveConfiguredTextCapabilityV1({
      projectId: scope.projectId, category: 'product-production', requirementKey: requirement.requirementKey,
    })
    return { requirementKey: requirement.requirementKey, adapterId: receipt.adapterId,
      bindingHash: receipt.capabilityHash, provider: receipt.provider, model: receipt.model }
  }))
  const production = (await db.productProductions.get(productionId))!
  const plan = await createProductProductionPlanV3({ brief, briefHash: row.briefHash, buildNumber: 1, controlEpoch: 0 })
  const executor = createConfiguredProductProductionExecutorV1({ production, brief })
  return { scope, productionId, brief, production, plan, capabilityBindings, executor }
}


/** Real current vision task, original isolated image bytes, exact input hashes. */
export async function sfqa050VisionTaskV1(kind: 'preflight' | 'review') {
  const owned = await authorizeSFQA050ProductionV1('general', true)
  const task = owned.plan.tasks.find(item => item.taskKey === (kind === 'preflight'
    ? 'media.vision-preflight' : 'media.visual-quality-review.batch-1'))
  if (!task) throw new Error('SFQA050 current vision Plan task missing')
  const inputArtifacts: ProductBuildArtifactRecordV1[] = []
  let output = ''
  if (kind === 'review') {
    const image = await sfqa050ImageV1()
    const blob = await putMediaBlobObject({ scope: owned.scope, data: image.data, mimeType: image.mimeType })
    const visual = textAdventureVisualBlueprintsV1(owned.brief.media.imageCount).map((blueprint, index) => ({
      artifactKey: `media.visual.${String(index + 1).padStart(3, '0')}`,
      mediaKind: blueprint.mediaKind, sceneTag: blueprint.sceneTag, beatKey: blueprint.beatKey,
      prompt: blueprint.prompt, altText: blueprint.altText, width: blueprint.width, height: blueprint.height,
      palette: ['#172033', '#52647A', '#D8C6A0'], hardConstraints: [],
      characterAnchorRefs: blueprint.characterOrdinal == null ? [] : ['character.player'],
    }))
    const cast = { schema: 'storyforge.text-adventure-cast-bible-artifact', version: 1,
      characters: ['player', 'npc'].map((role, index) => ({
        key: `character.${role}`, role: index === 0 ? 'player' : 'major-npc', sourceResourceKey: null,
        name: index === 0 ? '守灯人' : '引航者', publicIdentity: '潮门居民', desire: '保存事实', fear: '错失潮汐',
        secret: '藏着旧灯', motivation: '守护居民', voice: '简短', initialKnowledge: ['灯塔的位置'],
        forbiddenKnowledge: index === 0 ? [] : ['尚未公开的信号'], relationshipArc: ['陌生', '信任'], visualAnchor: '深蓝外衣',
      })) }
    const requirements = { schema: 'storyforge.product-media-requirements-artifact', version: 2, visual, audio: [] }
    const audit = { schema: 'storyforge.text-adventure-media-audit-artifact', version: 1, buildNumber: 1,
      requirementsHash: await hashProductProductionValueV2(requirements), visualBibleHash: 'd'.repeat(64), passed: true,
      assets: visual.map(item => ({ artifactKey: item.artifactKey, status: 'fulfilled',
        assetKey: `sfqa050.${item.artifactKey}`, requirementHash: 'c'.repeat(64), contentHash: blob.contentHash,
        mimeType: 'image/png', width: item.width, height: item.height, source: 'original-engineering-fixture',
        license: 'original isolated test image', rightsComplete: true, fallbackReason: null })) }
    for (const [artifactKey, payload] of Object.entries({ 'content.cast-bible': cast, 'media.requirements': requirements, 'media.audit': audit })) {
      const payloadJson = JSON.stringify(payload)
      inputArtifacts.push({ ...owned.scope, buildId: 1, artifactKey, requirementKey: null, version: 1,
        kind: artifactKey === 'content.cast-bible' ? 'product-design' : artifactKey === 'media.audit' ? 'integration-report' : 'asset-manifest',
        mediaKind: null, status: 'accepted', producerRunId: null, producerReceiptHash: null, controlEpoch: 0,
        inputHash: 'e'.repeat(64), contentHash: await hashProductProductionValueV2(payload), payloadJson,
        metadataJson: '{}', qualityJson: '{}', rightsJson: '{}', blobObjectId: null, mimeType: null,
        byteSize: payloadJson.length, parentArtifactHash: null, carriedFrom: null, createdAt: 1, updatedAt: 1 })
    }
    const selected = visual.filter(item => task.inputArtifactKeys.includes(item.artifactKey))
    for (const item of selected) inputArtifacts.push({ ...inputArtifacts[0]!, artifactKey: item.artifactKey,
      kind: 'image', mediaKind: item.mediaKind, contentHash: blob.contentHash, payloadJson: '{}',
      blobObjectId: blob.id!, mimeType: blob.mimeType, byteSize: blob.byteSize })
    output = JSON.stringify({ schema: 'storyforge.text-adventure-visual-quality-model-output', version: 1,
      reviews: selected.map(item => ({ artifactKey: item.artifactKey, contentHash: blob.contentHash, verdict: 'accept',
        scores: { requirementFit: 5, identityContinuity: 5, styleContinuity: 5, composition: 5, technicalCleanliness: 5 }, issues: [] })) })
  }
  const execution: ProductProductionTaskExecutionInputV1 = {
    scope: owned.scope, productionId: owned.productionId, buildId: 1, buildNumber: 1, controlEpoch: 0,
    planHash: 'a'.repeat(64), task, attempt: 1, idempotencyKey: 'b'.repeat(64),
    contextText: '{"registered":true}', inputArtifacts, capabilityBindings: owned.capabilityBindings,
    authorResolution: null, signal: new AbortController().signal,
  }
  return { ...owned, execution, output }
}

export const SFQA050_CONFIG_CHANGES = ['provider', 'model', 'route', 'temperature'] as const
export function changeSFQA050ConfigurationV1(change: typeof SFQA050_CONFIG_CHANGES[number]): void {
  const config = { ...useAIConfigStore.getState().config }
  if (change === 'route') {
    installSFQA050RouteV1({ ...config, baseUrl: SFQA050_CONFIG_B.baseUrl })
  } else {
    if (change === 'provider') config.provider = SFQA050_CONFIG_B.provider
    if (change === 'model') config.model = SFQA050_CONFIG_B.model
    if (change === 'temperature') config.temperature = SFQA050_CONFIG_B.temperature
    useAIConfigStore.setState({ config })
  }
}
