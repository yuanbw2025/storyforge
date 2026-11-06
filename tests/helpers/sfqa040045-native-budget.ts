import { db } from '../../src/lib/db/schema'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import {
  ProductProductionDraftRejectedErrorV1,
  runProductProductionSchedulerCycleV1,
  runProductProductionUntilBlockedV1,
  type ProductProductionTaskExecutionInputV1,
  type ProductProductionTaskExecutionResultV1,
  type ProductProductionTaskUsageV1,
} from '../../src/lib/product-production/scheduler'
import type { ProductBuildArtifactKindV1, ProductRuntimePackageV1 } from '../../src/lib/types'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { authorizeSFQA050ProductionV1, SFQA050_CONFIG_A } from './sfqa050-provider-dispatch-binding'

type Owned = Awaited<ReturnType<typeof authorizeSFQA050ProductionV1>>
interface Attempt {
  runId: number
  attempt: number
  controlEpoch: number
  usageKnown: boolean
  usage: ProductProductionTaskUsageV1
}
function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`Native fixture missing ${label}`)
  return value
}
async function authorize() {
  if (await db.projects.count()) throw new Error('Expected an empty isolated native database')
  useAIConfigStore.setState({ config: { ...SFQA050_CONFIG_A, provider: 'openai' }, presets: [], taskRoutes: {} })
  return authorizeSFQA050ProductionV1('avg')
}

/** The existing scheduler regression's minimal synthetic AVG package, not a production compiler substitute. */
function packageFixture(owned: Owned): ProductRuntimePackageV1 {
  return {
    schema: 'storyforge.product-runtime-package', version: 1, productType: 'avg',
    definition: { productKey: `native-budget.${owned.productionId}`, title: '原生事务验收', description: '隔离工程夹具',
      enabledCapabilities: ['narrative', 'presentation'], rulesetVersion: 1, initialVariables: {} },
    sourceWorld: { contentHash: owned.brief.source.worldContentHash, selection: owned.brief.source.selection },
    narrative: {
      moduleKind: 'main', moduleTitle: '原生事务故事', entryNodeKey: 'opening',
      nodes: [
        { key: 'opening', title: '开场', summary: '开始', kind: 'entry', conditionJson: '{}', effectsJson: '[]', successorKeys: ['ending'] },
        { key: 'ending', title: '结束', summary: '完成', kind: 'ending', conditionJson: '{}', effectsJson: '[]', successorKeys: [] },
      ],
      beats: [
        { beatKey: 'beat.opening', nodeKey: 'opening', kind: 'narration', speakerKey: null, text: '故事开始。', order: 0 },
        { beatKey: 'beat.ending', nodeKey: 'ending', kind: 'narration', speakerKey: null, text: '故事结束。', order: 0 },
      ],
      choices: [{ choiceKey: 'choice.continue', sourceNodeKey: 'opening', targetNodeKey: 'ending', text: '继续',
        description: '走向结局', unavailableReason: '', displayConditionJson: '{}', availableConditionJson: '{}',
        effectsJson: '[]', tags: [], order: 0 }],
    },
    presentation: { version: 1, cues: [], assets: [] },
  }
}
function output(owned: Owned, input: ProductProductionTaskExecutionInputV1): ProductProductionTaskExecutionResultV1 {
  let payload: unknown = { taskKey: input.task.taskKey, inputs: input.inputArtifacts.map(row => row.contentHash) }
  if (input.task.taskKey === 'integration.package') payload = packageFixture(owned)
  if (input.task.taskKey === 'qa.release') payload = {
    schema: 'storyforge.product-build-quality-report', version: 1, buildNumber: input.buildNumber,
    packageHash: required(input.inputArtifacts.find(row => row.artifactKey === 'runtime.package'), 'runtime package').contentHash,
    hardGateResults: owned.brief.completionContract.requiredGateIds.map(gateId => ({ gateId, passed: true, evidence: ['synthetic-native-fixture'] })),
    softGateResults: [], mediaCoverage: 1, playable: true, releaseReady: true, warnings: [],
  }
  const kinds: Record<string, ProductBuildArtifactKindV1> = {
    'content.design': 'product-design', 'content.narrative': 'narrative', 'content.product-module': 'product-module',
    'media.requirements': 'asset-manifest', 'integration.package': 'presentation', 'qa.release': 'quality-report',
  }
  const model = input.task.executionMode === 'model'
  return { artifacts: input.task.outputArtifactKeys.map(artifactKey => ({ artifactKey, kind: kinds[input.task.taskKey], payload,
    rights: { origin: 'isolated-native-fixture', commercialUse: true, license: 'test' } })),
  passedGateIds: [...input.task.acceptanceGateIds],
  usage: { modelCalls: model ? 1 : 0, inputTokens: model ? 10 : 0, outputTokens: model ? 11 : 0,
    mediaCalls: 0, costUsd: 0, durationMs: 1, storageBytes: 0 } }
}

/** Only provider output is synthetic; original claims, Run events, accounting, admission and real IndexedDB are used. */
export async function stoppedLateUsage() {
  const owned = await authorize()
  const plan = { ...owned.plan, concurrency: { ...owned.plan.concurrency, maximumCostBearingTasks: 2, maximumTextProviderTasks: 2 } }
  const calls: string[] = []
  let late: ProductProductionTaskExecutionInputV1 | undefined
  let release = () => {}, started = () => {}
  const waiting = new Promise<void>(resolve => { release = resolve })
  const dispatched = new Promise<void>(resolve => { started = resolve })
  const executor = async (input: ProductProductionTaskExecutionInputV1) => {
    calls.push(input.task.taskKey)
    if (input.task.taskKey === 'content.narrative') { late = input; started(); await waiting }
    if (input.task.taskKey === 'media.requirements') {
      await dispatched
      throw new ProductProductionDraftRejectedErrorV1('native isolated sibling blocker', output(owned, input).usage)
    }
    return output(owned, input)
  }
  const initial = await runProductProductionSchedulerCycleV1({ ...owned, suppliedPlan: plan, executor })
  const cycle = runProductProductionSchedulerCycleV1({ ...owned, suppliedPlan: plan, executor })
  // Wait only for the original sibling's durable stop, outside every transaction.
  let stopped = false
  try {
    for (let i = 0; i < 500; i++) {
      if ((await db.productBuilds.get(initial.buildId))?.status === 'recovery-required') { stopped = true; break }
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    if (!stopped) throw new Error('Original sibling did not reach its durable stop')
  } finally { release(); await cycle }
  const paid = required(late, 'late original attempt')
  const build = required(await db.productBuilds.get(initial.buildId), 'Build')
  const ledger = JSON.parse(build.budgetLedgerJson) as { attempts: Attempt[] }
  const attempt = ledger.attempts.filter(row => row.runId === paid.taskRunId)
  const artifactCount = await db.productBuildArtifacts.where('buildId').equals(build.id!)
    .and(row => paid.task.outputArtifactKeys.includes(row.artifactKey)).count()
  const root = await readAgentRunV1(owned.scope, required(paid.taskRunId, 'task Run'))
  return { scope: owned.scope, productionId: owned.productionId, buildId: build.id!, capabilityBindings: owned.capabilityBindings,
    ledger: build.budgetLedgerJson, attempts: attempt, expectedUsage: output(owned, paid).usage,
    expectedAttempt: { runId: paid.taskRunId, attempt: paid.attempt, controlEpoch: paid.controlEpoch },
    artifactCount, lateCalls: calls.filter(key => key === 'content.narrative').length, runState: root.projection.state,
    worlds: JSON.stringify(await db.worldReleases.where('projectId').equals(owned.scope.projectId).toArray()) }
}

export async function recoverStopped(input: Awaited<ReturnType<typeof stoppedLateUsage>>) {
  let calls = 0
  const state = await runProductProductionSchedulerCycleV1({ ...input, executor: async () => {
    calls++; throw new Error('A stopped attempt must not dispatch on reload')
  } })
  const build = required(await db.productBuilds.get(input.buildId), 'Build')
  return { calls, status: state.buildStatus, ledger: build.budgetLedgerJson,
    worlds: JSON.stringify(await db.worldReleases.where('projectId').equals(input.scope.projectId).toArray()) }
}

export async function rollbackRootSeal() {
  const owned = await authorize()
  let buildId: number | undefined
  let beforeRoot: Awaited<ReturnType<typeof readAgentRunV1>> | undefined
  let sawUncommittedRoot = false
  const calls: string[] = []
  const update = db.productBuilds.update.bind(db.productBuilds)
  // One failure at the actual Build write, after observing this transaction's real root events.
  Object.defineProperty(db.productBuilds, 'update', { configurable: true, writable: true,
    value: async (...args: Parameters<typeof update>) => {
      const [key, changes] = args
      if (typeof changes !== 'function' && changes.status === 'release-ready') {
        const root = await db.agentRuns.get(required(beforeRoot, 'root before seal').run.id)
        sawUncommittedRoot = root?.status === 'completed' && Boolean(root.terminalReceiptHash)
        throw new Error('native isolated terminal Build write failure')
      }
      return update(key, changes)
    } })
  let failure = ''
  try {
    await runProductProductionUntilBlockedV1({ ...owned,
      executor: async input => { buildId = input.buildId; calls.push(input.task.taskKey); return output(owned, input) },
      onDurableBoundary: async (point, snapshot) => {
        if (point === 'artifact.accepted' && snapshot.contract.scope.productProduction?.taskKey === owned.plan.terminalTaskKey) {
          const build = required(await db.productBuilds.get(required(buildId, 'Build id')), 'Build')
          const ledger = JSON.parse(build.budgetLedgerJson) as { rootRunId: number }
          beforeRoot = await readAgentRunV1(owned.scope, ledger.rootRunId)
        }
      },
    })
  } catch (cause) {
    failure = cause instanceof Error ? cause.message : String(cause)
    if (!failure.includes('native isolated terminal Build write failure')) throw cause
  } finally { Object.defineProperty(db.productBuilds, 'update', { configurable: true, writable: true, value: update }) }
  const before = required(beforeRoot, 'root before seal')
  const after = await readAgentRunV1(owned.scope, before.run.id)
  const build = required(await db.productBuilds.get(required(buildId, 'Build id')), 'Build')
  return { scope: owned.scope, productionId: owned.productionId, capabilityBindings: owned.capabilityBindings,
    buildId: build.id!, rootRunId: before.run.id, failure, sawUncommittedRoot, rootState: after.projection.state,
    rootEventsExact: JSON.stringify(after.events) === JSON.stringify(before.events),
    rootRowExact: JSON.stringify(after.run) === JSON.stringify(before.run), rootReceipt: build.rootTerminalReceiptHash,
    ledger: build.budgetLedgerJson, originalCalls: calls,
    worlds: JSON.stringify(await db.worldReleases.where('projectId').equals(owned.scope.projectId).toArray()) }
}

export async function recoverRootSeal(input: Awaited<ReturnType<typeof rollbackRootSeal>>) {
  let calls = 0
  const state = await runProductProductionUntilBlockedV1({ ...input, executor: async () => {
    calls++; throw new Error('Root seal recovery must reuse accepted task receipts')
  } })
  const build = required(await db.productBuilds.get(input.buildId), 'Build')
  const root = await readAgentRunV1(input.scope, input.rootRunId)
  return { calls, status: state.buildStatus, terminal: state.terminal, rootState: root.projection.state,
    ledger: build.budgetLedgerJson, rootReceipt: root.projection.terminalReceiptHash, buildReceipt: build.rootTerminalReceiptHash,
    acceptedEvents: root.events.filter(event => event.type === 'verification.accepted').length,
    worlds: JSON.stringify(await db.worldReleases.where('projectId').equals(input.scope.projectId).toArray()) }
}
