import type {
  ProductBuildArtifactRecordV1, ProductProductionCommandV1, ProductProductionPlanV3,
  TextAdventureContentRevisionV1,
} from '../types'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from './hash'

/** This command preserves cast, locations, art direction and frozen world. */
export function isTextContentRevisionKeyV1(key: string): key is TextAdventureContentRevisionV1['artifactKey'] {
  return ['content.narrative-arc-scenes', 'content.narrative-decision-plan', 'content.ending-route-plan',
    'content.main-quest-plan', 'content.adventure-side-quests', 'content.adventure-ambient-events'].includes(key)
    || /^content\.scene-script\.act-[123]\.part-[12]$/.test(key)
    || /^content\.quest-script\.(main\.act-[123]\.(single|multi)|supplemental)$/.test(key)
}

export function textContentRevisionClosureV1(plan: ProductProductionPlanV3, roots: Iterable<string>): Set<string> {
  const result = new Set(roots)
  for (let changed = true; changed;) {
    changed = false
    for (const task of plan.tasks) if (!result.has(task.taskKey) && task.dependsOn.some(key => result.has(key))) {
      result.add(task.taskKey); changed = true
    }
  }
  return result
}

/** Stable media bindings cannot be removed or repurposed by a text-only edit. */
function assertStableMediaBindings(before: unknown, after: unknown): void {
  const project = (value: unknown): unknown => {
    const bindings: Record<string, unknown> = {}
    const visit = (value: unknown, path: string) => {
      if (Array.isArray(value)) { value.forEach((item, index) => visit(item, `${path}[${index}]`)); return }
      if (!value || typeof value !== 'object') return
      for (const [key, nested] of Object.entries(value)) {
        if (['key', 'sceneKey', 'choiceKey', 'beatKey', 'speakerKey', 'locationKey', 'locationOrdinal',
          'mediaSlotKey', 'illustrationMomentKey', 'actKey'].includes(key)) bindings[`${path}.${key}`] = nested
        else if (nested && typeof nested === 'object') visit(nested, `${path}.${key}`)
      }
    }
    visit(value, '$')
    return bindings
  }
  if (canonicalProductProductionJsonV2(project(before)) !== canonicalProductProductionJsonV2(project(after))) {
    throw new Error('[text-content-revision] 场景、发言者、选择或插图绑定已变化，请使用内容与视觉演化')
  }
}

export async function createTextContentRevisionPlanV1(input: {
  base: ProductProductionPlanV3
  command: Extract<ProductProductionCommandV1, { type: 'revise-text-content' }>
  artifacts: ProductBuildArtifactRecordV1[]
}): Promise<{ plan: ProductProductionPlanV3; carriedArtifactKeys: string[] }> {
  const { base, command } = input
  if (base.productType !== 'text-adventure') throw new Error('[text-content-revision] 产品无效')
  const artifacts = new Map(input.artifacts.map(row => [row.artifactKey, row]))
  if (artifacts.size !== input.artifacts.length) throw new Error('[text-content-revision] 原稿重复')
  const revisions = new Map(command.revisions.map(revision => [revision.artifactKey, revision]))
  for (const revision of command.revisions) {
    const source = artifacts.get(revision.artifactKey)
    const task = base.tasks.find(task => task.taskKey === revision.artifactKey)
    if (!isTextContentRevisionKeyV1(revision.artifactKey) || !source || !task
      || task.executionMode !== 'model' || task.outputArtifactKeys.length !== 1
      || task.outputArtifactKeys[0] !== revision.artifactKey || source.blobObjectId != null
      || source.version !== revision.expectedArtifactVersion || source.contentHash !== revision.expectedArtifactHash
      || await hashProductProductionValueV2(JSON.parse(source.payloadJson)) !== source.contentHash) {
      throw new Error(`[text-content-revision] 原稿或修订边界无效:${revision.artifactKey}`)
    }
    // Script schema V2 -> V3 may add inventory and cost objects, but never
    // changes visual scene/beat identity. Those scripts have no media slots.
    if (!revision.artifactKey.startsWith('content.quest-script.')) {
      assertStableMediaBindings(JSON.parse(source.payloadJson), JSON.parse(revision.authorDraftJson))
    }
  }
  const affected = textContentRevisionClosureV1(base, revisions.keys())
  // All review reports and package receipts belong to the new content, even
  // when a narrow edit did not appear in an older task's dependency list.
  for (const key of textContentRevisionClosureV1(base, base.tasks.filter(task =>
    /quality-review|dialogue-pass/.test(task.kind) || task.taskKey.startsWith('qa.')
      || task.taskKey === 'media.audit' || task.taskKey === 'integration.package').map(task => task.taskKey))) affected.add(key)
  const retainedVisualTask = (key: string) => ['media.requirements', 'media.visual-bible.compile',
    'media.anchor-author-gate'].includes(key) || /^media\.visual\.\d{3}$/.test(key)
  const carriedArtifactKeys: string[] = []
  const tasks: ProductProductionPlanV3['tasks'] = []
  for (const task of base.tasks) {
    if (affected.has(task.taskKey) && !retainedVisualTask(task.taskKey)) {
      // Unchanged prose is re-validated against the new parents, not silently
      // carried across changed dependencies. Dialogue/quality agents run fresh.
      const source = artifacts.get(task.taskKey)
      if (isTextContentRevisionKeyV1(task.taskKey) && task.executionMode === 'model' && source) {
        const revision = revisions.get(task.taskKey) ?? {
          artifactKey: task.taskKey, expectedArtifactVersion: source.version,
          expectedArtifactHash: source.contentHash, authorDraftJson: source.payloadJson,
          note: '保留已完成正文，并按本次修订后的上游合同重新校验。',
        }
        tasks.push({ ...task, reuse: null, authorRevision: {
          ...revision, commandId: command.commandId, sourceBuildNumber: command.buildNumber,
        } })
      } else tasks.push(task)
      continue
    }
    const outputs = task.outputArtifactKeys.map(key => artifacts.get(key))
    if (!outputs.length || outputs.some(row => !row)) {
      throw new Error(`[text-content-revision] 父 Build 缺少可验证工件:${task.taskKey}`)
    }
    const source = outputs[0]!
    const reuseKey = await hashProductProductionValueV2({
      commandId: command.commandId, sourceBuildNumber: command.buildNumber, targetBuildNumber: base.buildNumber,
      taskKey: task.taskKey, artifacts: outputs.map(row => ({ key: row!.artifactKey, hash: row!.contentHash })),
    })
    const retainedImage = /^media\.visual\.\d{3}$/.test(task.taskKey)
    tasks.push({ ...task,
      ...(retainedImage ? { executionMode: 'human-import' as const, skillId: null,
        concurrencyGroup: 'human-import', maxAttempts: 1, failurePolicy: 'pause' as const, fallbackTaskKey: null,
        budgetReservation: { ...task.budgetReservation, modelCalls: 0, inputTokens: 0, outputTokens: 0,
          mediaCalls: 0, maximumCostUsd: 0, storageBytes: 0 } } : {}),
      reuse: {
      sourceBuildNumber: command.buildNumber, sourceArtifactKey: source.artifactKey,
      sourceContentHash: source.contentHash, reuseKey, requiresRevalidation: true,
      reason: retainedVisualTask(task.taskKey)
        ? '文字修订：作者明确保留原视觉合同与图片；重新执行独立审图和绑定审计'
        : '文字修订：不在内容依赖失效范围，保留原稿与来源',
    } })
    carriedArtifactKeys.push(...task.outputArtifactKeys)
  }
  return { plan: { ...base, tasks }, carriedArtifactKeys }
}
