import Dexie from 'dexie'
import { db } from '../../src/lib/db/schema'
import type {
  FrozenNarrativeBeat,
  FrozenNarrativeChoice,
  FrozenProductNarrativeNode,
  ProductBuildQualityReportV1,
  ProductProductionBriefV3,
  ProductProductionPlanTaskV3,
  ProductProductionPlanV3,
  ProductTaskBudgetReservationV1,
  ProductRuntimePackageV1,
  WorkspaceScope,
} from '../../src/lib/types'
import { sanitizeSvg } from '../../src/lib/utils/sanitize-svg'
import { assertRecordInScope, resolveScope } from '../../src/lib/workspace/scope'
import { parseProductProductionBriefV3 } from '../../src/lib/product-production/contracts'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { putMediaBlobObject } from '../../src/lib/product-production/media-blob-store'
import { parseProductProductionPlanV3 } from '../../src/lib/product-production/plan'
import { parseProductRuntimePackageV1 } from '../../src/lib/product-production/runtime-package'
import {
  runProductProductionUntilBlockedV1,
  type ProductProductionTaskExecutionInputV1,
  type ProductProductionTaskExecutionResultV1,
  type ProductProductionTaskUsageV1,
} from '../../src/lib/product-production/scheduler'

const ZERO_BUDGET: ProductTaskBudgetReservationV1 = {
  modelCalls: 0,
  inputTokens: 0,
  outputTokens: 0,
  mediaCalls: 0,
  maximumCostUsd: 0,
  durationMs: 5_000,
  storageBytes: 1_000_000,
}

function acceptanceTask(input: Pick<ProductProductionPlanTaskV3,
  'taskKey' | 'lane' | 'kind' | 'dependsOn' | 'inputArtifactKeys' | 'outputArtifactKeys'
  | 'acceptanceGateIds'> & { budgetReservation?: Partial<ProductTaskBudgetReservationV1> }): ProductProductionPlanTaskV3 {
  const { budgetReservation, ...definition } = input
  return {
    ...definition,
    skillId: null,
    executionMode: 'deterministic',
    requiredReceipts: input.dependsOn.map(taskKey => ({ taskKey, receiptHash: null })),
    requirementKeys: [],
    capabilityRequirementKeys: [],
    concurrencyGroup: input.lane,
    subjectLockKeys: input.outputArtifactKeys,
    priority: input.lane === 'qa' ? 100 : 50,
    budgetReservation: { ...ZERO_BUDGET, ...budgetReservation },
    maxAttempts: 1,
    timeoutMs: 10_000,
    failurePolicy: 'fail-build',
    fallbackTaskKey: null,
    reuse: null,
  }
}

function createDeterministicAcceptancePlanV3(input: {
  brief: ProductProductionBriefV3
  briefHash: string
  controlEpoch: number
  buildNumber: number
}): ProductProductionPlanV3 {
  const brief = parseProductProductionBriefV3(input.brief)
  if (brief.intent.productType !== 'text-adventure' && brief.intent.productType !== 'avg') {
    throw new Error('[product-production-acceptance-fixture] 该无 provider 验收夹具只覆盖文字冒险与 AVG；它不是正式生产工厂')
  }
  const tasks = [
    acceptanceTask({ taskKey: 'content.compile', lane: 'content', kind: 'runtime-narrative', dependsOn: [], inputArtifactKeys: [], outputArtifactKeys: ['runtime.narrative'], acceptanceGateIds: ['narrative.graph.valid'] }),
    acceptanceTask({ taskKey: 'visual.compose', lane: 'visual', kind: 'key-visual', dependsOn: [], inputArtifactKeys: [], outputArtifactKeys: ['media.key-visual'], acceptanceGateIds: ['rights.complete'] }),
    acceptanceTask({
      taskKey: 'runtime.integrate', lane: 'integration', kind: 'runtime-package',
      dependsOn: ['content.compile', 'visual.compose'],
      inputArtifactKeys: ['runtime.narrative', 'media.key-visual'],
      outputArtifactKeys: ['runtime.package'], acceptanceGateIds: ['runtime.package.valid'],
      budgetReservation: { inputTokens: brief.productionBudget.maximumInputTokens },
    }),
    acceptanceTask({ taskKey: 'quality.verify', lane: 'qa', kind: 'quality-report', dependsOn: ['runtime.integrate'], inputArtifactKeys: ['runtime.package'], outputArtifactKeys: ['quality.report'], acceptanceGateIds: ['runtime.playable'] }),
  ]
  return parseProductProductionPlanV3({
    schema: 'storyforge.product-production-plan', version: 3,
    buildNumber: input.buildNumber,
    productType: brief.intent.productType,
    briefHash: input.briefHash,
    controlEpoch: input.controlEpoch,
    concurrency: {
      maximumCostBearingTasks: 1,
      maximumTextProviderTasks: 1,
      maximumMediaProviderTasks: 1,
    },
    tasks,
    terminalTaskKey: 'quality.verify',
  }, brief, input.briefHash)
}

function escapeXml(value: string): string {
  return value.replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&apos;', '"': '&quot;',
  })[character]!)
}

function localKeyVisual(input: { title: string; conflict: string; tone: string[] }): ArrayBuffer {
  const title = escapeXml(input.title.slice(0, 40))
  const conflict = escapeXml(input.conflict.slice(0, 86))
  const tone = escapeXml(input.tone.slice(0, 3).join(' · '))
  const svg = sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#101827"/><stop offset="0.55" stop-color="#24344b"/><stop offset="1" stop-color="#6f4b36"/></linearGradient>
      <radialGradient id="glow"><stop stop-color="#f6d28b" stop-opacity=".9"/><stop offset="1" stop-color="#f6d28b" stop-opacity="0"/></radialGradient>
      <filter id="grain"><feTurbulence baseFrequency=".8" numOctaves="3" seed="11"/><feColorMatrix values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 .08 0"/></filter>
    </defs>
    <rect width="1200" height="675" fill="url(#sky)"/>
    <circle cx="850" cy="215" r="250" fill="url(#glow)"/>
    <path d="M0 510L180 390l110 75 175-210 155 165 170-120 180 150 230-95v320H0z" fill="#0a111d" opacity=".88"/>
    <path d="M0 555c210-75 390-40 580 8s390 38 620-24v136H0z" fill="#080d15"/>
    <rect x="72" y="74" width="7" height="222" rx="3" fill="#dcae62"/>
    <text x="108" y="130" fill="#f7e8ce" font-family="serif" font-size="58" font-weight="700">${title}</text>
    <text x="110" y="187" fill="#d6c4aa" font-family="sans-serif" font-size="24">${conflict}</text>
    <text x="110" y="235" fill="#dcae62" font-family="sans-serif" font-size="17" letter-spacing="4">${tone}</text>
    <text x="108" y="612" fill="#a99a87" font-family="sans-serif" font-size="14" letter-spacing="5">STORYFORGE · TEST ACCEPTANCE FIXTURE</text>
    <rect width="1200" height="675" filter="url(#grain)" opacity=".45"/>
  </svg>`)
  return new TextEncoder().encode(svg).buffer
}

function narrativeFromBrief(brief: ProductProductionBriefV3): {
  nodes: FrozenProductNarrativeNode[]
  beats: FrozenNarrativeBeat[]
  choices: FrozenNarrativeChoice[]
} {
  const opening = brief.intent.openingSituation
  const requiredFact = brief.intent.requiredFacts[0] ?? '世界保持其既定规则。'
  const forbidden = brief.intent.forbiddenChanges[0] ?? '既定事实不会被无理由改写。'
  const nodes: FrozenProductNarrativeNode[] = [
    { key: 'opening', kind: 'entry', title: brief.source.startingPoint.title, summary: opening, conditionJson: '{}', effectsJson: '[]', successorKeys: ['observe', 'act'] },
    { key: 'observe', kind: 'scene', title: '先理解局势', summary: requiredFact, conditionJson: '{}', effectsJson: '[{"op":"set","path":"approach","value":"observe"}]', successorKeys: ['ending.insight'] },
    { key: 'act', kind: 'scene', title: '立即介入', summary: forbidden, conditionJson: '{}', effectsJson: '[{"op":"set","path":"approach","value":"act"}]', successorKeys: ['ending.change'] },
    { key: 'ending.insight', kind: 'ending', title: '看清代价', summary: '你保全了证据，也接受尚未改变的一切。', conditionJson: '{}', effectsJson: '[]', successorKeys: [] },
    { key: 'ending.change', kind: 'ending', title: '承担改变', summary: '你的行动改变了局部结果，却没有抹去世界的历史。', conditionJson: '{}', effectsJson: '[]', successorKeys: [] },
  ]
  const beatTexts = [
    opening,
    `你停下来核对已知事实：${requiredFact}`,
    `你决定行动，同时守住边界：${forbidden}`,
    '线索终于连成完整的图景。',
    '新的结果出现了，而代价也被诚实地保留下来。',
  ]
  const beats: FrozenNarrativeBeat[] = nodes.map((node, index) => ({
    beatKey: `beat.${node.key}`, nodeKey: node.key, kind: 'narration', speakerKey: null,
    text: beatTexts[index], order: index,
  }))
  const choices: FrozenNarrativeChoice[] = [
    { choiceKey: 'choice.observe', sourceNodeKey: 'opening', text: '先调查再决定', description: '寻找能解释冲突的事实。', unavailableReason: '', targetNodeKey: 'observe', displayConditionJson: '{}', availableConditionJson: '{}', effectsJson: '[]', tags: ['approach:observe'], order: 0 },
    { choiceKey: 'choice.act', sourceNodeKey: 'opening', text: '立即承担风险', description: '在局势恶化前介入。', unavailableReason: '', targetNodeKey: 'act', displayConditionJson: '{}', availableConditionJson: '{}', effectsJson: '[]', tags: ['approach:act'], order: 1 },
    { choiceKey: 'choice.insight', sourceNodeKey: 'observe', text: '带着证据作结', description: '接受有限但可靠的结果。', unavailableReason: '', targetNodeKey: 'ending.insight', displayConditionJson: '{}', availableConditionJson: '{}', effectsJson: '[]', tags: ['ending'], order: 0 },
    { choiceKey: 'choice.change', sourceNodeKey: 'act', text: '承担选择的后果', description: '让改变成为新的事实。', unavailableReason: '', targetNodeKey: 'ending.change', displayConditionJson: '{}', availableConditionJson: '{}', effectsJson: '[]', tags: ['ending'], order: 0 },
  ]
  return { nodes, beats, choices }
}

function artifactPayload<T>(input: ProductProductionTaskExecutionInputV1, artifactKey: string): T {
  const artifact = input.inputArtifacts.find(row => row.artifactKey === artifactKey)
  if (!artifact) throw new Error(`[product-production-acceptance-fixture] 输入 Artifact 缺失:${artifactKey}`)
  try { return JSON.parse(artifact.payloadJson) as T }
  catch { throw new Error(`[product-production-acceptance-fixture] 输入 Artifact JSON 损坏:${artifactKey}`) }
}

function localUsage(storageBytes = 0): ProductProductionTaskUsageV1 {
  return {
    modelCalls: 0, inputTokens: 0, outputTokens: 0, mediaCalls: 0,
    costUsd: 0, durationMs: 0, storageBytes,
  }
}

function result(
  input: ProductProductionTaskExecutionInputV1,
  artifacts: ProductProductionTaskExecutionResultV1['artifacts'],
  storageBytes = 0,
): ProductProductionTaskExecutionResultV1 {
  return { artifacts, passedGateIds: [...input.task.acceptanceGateIds], usage: localUsage(storageBytes) }
}

function createDeterministicAcceptanceExecutor(input: {
  scope: WorkspaceScope
  productionKey: string
  title: string
  brief: ProductProductionBriefV3
}) {
  const narrative = narrativeFromBrief(input.brief)
  const keyVisualAssetKey = `${input.productionKey}.background.opening`
  return async (taskInput: ProductProductionTaskExecutionInputV1): Promise<ProductProductionTaskExecutionResultV1> => {
    if (taskInput.task.taskKey === 'content.compile') {
      return result(taskInput, [{
        artifactKey: 'runtime.narrative', kind: 'narrative', payload: narrative,
        quality: { graph: '5-nodes-2-endings', sourceAnchors: input.brief.source.startingPoint.sourceRefs },
        rights: { origin: 'deterministic-local', containsThirdPartyText: false },
      }])
    }
    if (taskInput.task.taskKey === 'visual.compose') {
      if (input.brief.media.visualLevel === 'none') {
        return result(taskInput, [{
          artifactKey: 'media.key-visual', kind: 'visual-bible',
          payload: { fallback: 'text-only', reason: 'Brief visualLevel=none' },
          rights: { origin: 'none', commercialUse: true },
        }])
      }
      const bytes = localKeyVisual({
        title: input.title,
        conflict: input.brief.intent.openingSituation,
        tone: input.brief.intent.tone,
      })
      const blob = await putMediaBlobObject({
        scope: input.scope, data: bytes, mimeType: 'image/svg+xml', backend: 'indexeddb', sanitizedSvg: true,
      })
      return result(taskInput, [{
        artifactKey: 'media.key-visual', requirementKey: 'media.visual',
        kind: 'image', mediaKind: 'background',
        payload: { assetKey: keyVisualAssetKey, generator: 'storyforge-procedural-svg-v1' },
        metadata: { width: 1200, height: 675, altText: `${input.title} 的开场概念图` },
        quality: { dimensionsVerified: true, sanitizer: 'sanitize-svg' },
        rights: { origin: 'storyforge-procedural-svg-v1', license: 'CC0-1.0', commercialUse: true },
        contentHash: blob.contentHash, blobObjectId: blob.id!, mimeType: blob.mimeType, byteSize: blob.byteSize,
      }], blob.byteSize)
    }
    if (taskInput.task.taskKey === 'runtime.integrate') {
      if (!taskInput.contextText.trim()) {
        throw new Error('[product-production-acceptance-fixture] 集成任务没有收到冻结世界上下文')
      }
      const compiledNarrative = artifactPayload<typeof narrative>(taskInput, 'runtime.narrative')
      const visual = taskInput.inputArtifacts.find(row => row.artifactKey === 'media.key-visual')!
      const runtimePackage: ProductRuntimePackageV1 = {
        schema: 'storyforge.product-runtime-package', version: 1, productType: input.brief.intent.productType,
        definition: {
          productKey: input.productionKey, title: input.title,
          description: input.brief.intent.coreExperience.join('；'),
          enabledCapabilities: input.brief.intent.productType === 'avg' ? ['narrative', 'presentation'] : ['narrative'],
          rulesetVersion: 1, initialVariables: {},
        },
        sourceWorld: { contentHash: input.brief.source.worldContentHash, selection: input.brief.source.selection },
        narrative: {
          moduleKind: 'main', moduleTitle: input.brief.source.startingPoint.title,
          entryNodeKey: 'opening', ...compiledNarrative,
        },
      }
      if (input.brief.intent.productType === 'avg') {
        const asset = visual.blobObjectId == null ? null : {
          assetKey: keyVisualAssetKey, version: 1, kind: 'background' as const,
          name: `${input.title} · 开场`, mimeType: visual.mimeType!, byteSize: visual.byteSize,
          width: 1200, height: 675, durationMs: null, contentHash: visual.contentHash,
          blobContentHash: visual.contentHash, source: 'storyforge-procedural-svg-v1', license: 'CC0-1.0',
          altText: `${input.title} 的开场概念图`, characterTag: '', sceneTag: 'opening',
        }
        runtimePackage.presentation = {
          version: 1,
          cues: asset ? [{
            cueKey: 'cue.opening.background', beatKey: 'beat.opening', phase: 'before',
            type: 'set-background', assetKey: asset.assetKey, durationMs: 500,
            easing: 'ease-in-out', order: 0,
          }] : [],
          assets: asset ? [asset] : [],
        }
      }
      const parsed = parseProductRuntimePackageV1(runtimePackage)
      return result(taskInput, [{
        artifactKey: 'runtime.package', kind: 'presentation', payload: parsed,
        quality: {
          parser: 'parseProductRuntimePackageV1',
          sourceContextHash: await hashProductProductionValueV2(taskInput.contextText),
        },
        rights: {
          mediaArtifactKey: visual.artifactKey,
          mediaRightsHash: await hashProductProductionValueV2(JSON.parse(visual.rightsJson)),
        },
      }])
    }
    if (taskInput.task.taskKey === 'quality.verify') {
      const runtimePackage = parseProductRuntimePackageV1(
        artifactPayload<ProductRuntimePackageV1>(taskInput, 'runtime.package'),
      )
      const packageHash = await hashProductProductionValueV2(runtimePackage)
      const visual = await db.productBuildArtifacts
        .where('[buildId+artifactKey]').equals([taskInput.buildId, 'media.key-visual']).first()
      const mediaCoverage = input.brief.media.imageCount > 0
        ? Math.min(1, (visual?.blobObjectId == null ? 0 : 1) / input.brief.media.imageCount)
        : 1
      const packageQualityReady = mediaCoverage >= input.brief.completionContract.minimumMediaCoverage
      const hardGateIds = ['narrative.graph.valid', 'rights.complete', 'runtime.package.valid', 'runtime.playable']
      const warnings = [
        '内容由本地确定性 Brief 编译器生成，未调用或冒充外部模型。',
        ...(visual?.blobObjectId == null ? ['未生成视觉，玩家使用纯文字 fallback。'] : []),
        ...(input.brief.media.audioLevel !== 'none' ? ['确定性验收夹具未生成音频，运行时保持静音可通关。'] : []),
      ].sort()
      const quality: ProductBuildQualityReportV1 = {
        schema: 'storyforge.product-build-quality-report', version: 1,
        buildNumber: taskInput.buildNumber, packageHash,
        hardGateResults: hardGateIds.map(gateId => ({ gateId, passed: true, evidence: [packageHash] })),
        softGateResults: [{
          gateId: 'media.coverage', passed: packageQualityReady,
          evidence: [`coverage=${mediaCoverage}`, `required=${input.brief.completionContract.minimumMediaCoverage}`],
        }],
        mediaCoverage, playable: true, releaseReady: packageQualityReady, warnings,
      }
      return result(taskInput, [{
        artifactKey: 'quality.report', kind: 'quality-report', payload: quality,
        quality: { hardGatesPassed: true, releaseReady: packageQualityReady }, rights: {},
      }])
    }
    throw new Error(`[product-production-acceptance-fixture] 未登记的本地任务:${taskInput.task.taskKey}`)
  }
}

/**
 * No-provider acceptance fixture. It uses the same durable scheduler, world
 * gateway, exact run evidence, artifact receipts and terminal join as formal
 * production; only the task executor is deterministic and explicitly labeled.
 */
export async function runCurrentProductProductionAcceptanceFixture(input: {
  scope: WorkspaceScope
  productionId: number
}): Promise<{
  buildId: number
  previewHash: string
  packageHash: string
  releaseReady: boolean
}> {
  const scope = await resolveScope({ scope: input.scope })
  const production = await db.productProductions.get(input.productionId)
  if (!production || !await assertRecordInScope(scope, 'productProductions', production, { owner: 'work' })) {
    throw new Error('[product-production-acceptance-fixture] Production 不存在或跨 Work')
  }
  if (production.currentBuildNumber == null || production.currentBriefRevision == null) {
    throw new Error('[product-production-acceptance-fixture] Production 尚未获得制作授权')
  }
  const [build, briefRow] = await Promise.all([
    db.productBuilds.where('[productionId+buildNumber]').equals([production.id!, production.currentBuildNumber]).first(),
    db.productProductionBriefs.where('[productionId+revision]').equals([production.id!, production.currentBriefRevision]).first(),
  ])
  if (!build || !briefRow || briefRow.status !== 'authorized' || build.briefHash !== briefRow.briefHash) {
    throw new Error('[product-production-acceptance-fixture] Build/Brief 授权绑定损坏')
  }
  if (['preview-ready', 'release-ready', 'released'].includes(build.status)) {
    return {
      buildId: build.id!, previewHash: build.previewHash, packageHash: build.packageHash,
      releaseReady: build.status === 'release-ready' || build.status === 'released',
    }
  }
  if (build.status !== 'authorized' && build.status !== 'building' && build.status !== 'recovery-required') {
    throw new Error(`[product-production-acceptance-fixture] Build 状态 ${build.status} 不可启动确定性验收夹具`)
  }
  const brief = parseProductProductionBriefV3(briefRow.briefJson)
  if (brief.intent.productType !== 'text-adventure' && brief.intent.productType !== 'avg') {
    throw new Error('[product-production-acceptance-fixture] 该无 provider 验收夹具只覆盖文字冒险与 AVG；它不是正式生产工厂')
  }
  const plan = createDeterministicAcceptancePlanV3({
    brief, briefHash: briefRow.briefHash, controlEpoch: build.controlEpoch, buildNumber: build.buildNumber,
  })
  const projection = await runProductProductionUntilBlockedV1({
    scope,
    productionId: production.id!,
    suppliedPlan: plan,
    executor: createDeterministicAcceptanceExecutor({
      scope, productionKey: production.productionKey, title: production.title, brief,
    }),
    maximumCycles: 20,
  })
  const completed = await db.productBuilds.get(build.id!)
  if (!completed || !['preview-ready', 'release-ready', 'released'].includes(completed.status)
    || !completed.previewHash || !completed.packageHash || !projection.terminal) {
    throw new Error(`[product-production-acceptance-fixture] durable scheduler 未完成:${completed?.status ?? 'missing'}`)
  }
  // The caller may immediately begin the adoption transaction. Clear Dexie's
  // async transaction context left by the terminal join before handing off.
  if (Dexie.currentTransaction) await Dexie.waitFor(Promise.resolve())
  return {
    buildId: completed.id!, previewHash: completed.previewHash, packageHash: completed.packageHash,
    releaseReady: completed.status === 'release-ready' || completed.status === 'released',
  }
}
