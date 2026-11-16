import type { CreateWorkspaceInput, WorkKind } from '../../src/lib/types'
import { db } from '../../src/lib/db/schema'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { readAgentRunArtifactExactV1 } from '../../src/lib/memory/artifact-store'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { runProductProductionUntilBlockedV1 } from '../../src/lib/product-production/scheduler'
import { CODEX_DURABLE_RECEIPT_RETENTION_V1 } from '../../src/lib/ai/codex-transport'
import { sha256Text } from '../../src/lib/ai/chapter-memory/text-normalization'
import { authorizeSFQA050ProductionV1 } from './sfqa050-provider-dispatch-binding'
import { openProductionCompilerFixtureV1 } from './open-ttrpg-production-artifacts'
import { createChatDraftV3, readChatDraftV1, saveChatDraftV1 } from '../../src/lib/character-interaction/draft-service'
import { parseChatAuthoringSettings } from '../../src/lib/character-interaction/authoring-contract'
import { createAvgDraftV1, readAvgDraftV1, saveAvgDraftV1 } from '../../src/lib/avg/draft-service'
import { parseAvgAuthoringSettingsV1 } from '../../src/lib/avg/authoring-contract'
import { createAiTownDraft, readAiTownDraft, saveAiTownDraft } from '../../src/lib/ai-town/authoring-service'
import { settingsFromAiTownDraft } from '../../src/lib/ai-town/authoring-contract'
import { createTtrpgDraft, readTtrpgDraft, saveTtrpgDraft } from '../../src/lib/ttrpg/authoring-service'
import { settingsFromTtrpgDraft } from '../../src/lib/ttrpg/authoring-contract'

export const SFQA004_UPPER_ENTRIES = [
  ['ttrpg', 'upper.ttrpg'],
  ['chat', 'upper.character-interaction'],
  ['town', 'upper.ai-town'],
  ['avg', 'upper.avg'],
  ['adventure', 'upper.text-adventure'],
  ['openworld', 'upper.text-open-world'],
] as const

export const SFQA004_UPPER_WORK_KINDS: readonly WorkKind[] = [
  'ttrpg', 'character-interaction', 'ai-town', 'avg',
]

export function sfqa004ChannelV1(channel: 'production' | 'local-development', optIn = false): void {
  window.location.href = channel === 'production'
    ? 'https://sfqa004.example/storyforge/' : 'http://localhost:4178/storyforge/'
  if (optIn) window.localStorage.setItem('storyforge:experimental-products', 'enabled')
  else window.localStorage.removeItem('storyforge:experimental-products')
}

export function sfqa004WorkspaceInputV1(name = '004 isolated owner'): CreateWorkspaceInput {
  return { name, description: '', genres: [], status: 'drafting', targetWordCount: 10_000 }
}

export async function sfqa004HistoricalDraftV1(kind: 'chat' | 'avg' | 'town' | 'ttrpg') {
  const title = '004 explicitly edited owner'
  if (kind === 'chat') {
    const { scope } = await createChatDraftV3('004 historical chat')
    const before = await readChatDraftV1(scope)
    const settings = parseChatAuthoringSettings(JSON.parse(before.settingsJson))
    return { scope, before, settings, read: () => readChatDraftV1(scope), save: () => saveChatDraftV1(scope, before.revision, settings, title) }
  }
  if (kind === 'avg') {
    const { scope } = await createAvgDraftV1('004 historical AVG')
    const before = await readAvgDraftV1(scope)
    const settings = parseAvgAuthoringSettingsV1(JSON.parse(before.settingsJson))
    return { scope, before, settings, read: () => readAvgDraftV1(scope), save: () => saveAvgDraftV1(scope, before.revision, settings, title) }
  }
  if (kind === 'town') {
    const { scope } = await createAiTownDraft('004 historical town')
    const before = await readAiTownDraft(scope)
    const settings = settingsFromAiTownDraft(before)
    return { scope, before, settings, read: () => readAiTownDraft(scope), save: () => saveAiTownDraft(scope, before.revision, settings, title) }
  }
  const { scope } = await createTtrpgDraft('004 historical TTRPG')
  const before = await readTtrpgDraft(scope)
  const settings = settingsFromTtrpgDraft(before)
  return { scope, before, settings, read: () => readTtrpgDraft(scope), save: () => saveTtrpgDraft(scope, before.revision, settings, title) }
}

/** One controlled native request loses polling; only its retained receipt can recover. */
export async function sfqa004OriginalResponseFixtureV1(installTransport: (fetcher: typeof fetch) => void) {
  useAIConfigStore.setState({ config: { ...useAIConfigStore.getState().config,
    provider: 'codex', model: 'sfqa004-local-fixture', apiKey: '', contextWindow: 131_072, maxTokens: 16_000 } })
  const owned = await authorizeSFQA050ProductionV1('ttrpg-open')
  const data = await openProductionCompilerFixtureV1(true, owned)
  const output = JSON.stringify(data.sourceFacts)
  let wire: { id: string; model: string } | null = null
  let requestHash = '', runId = 0, completed = false
  const requests: Array<{ method: string; path: string }> = []
  const response = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
  installTransport(async (target, init) => {
    const path = String(target), method = init?.method ?? 'GET'
    requests.push({ path, method })
    if (path.endsWith('/status')) return response({ state: 'ready' })
    if (path.endsWith('/requests') && method === 'POST') {
      wire = JSON.parse(String(init?.body)) as typeof wire
      requestHash = await sha256Text(String(init?.body))
      runId = (await db.agentRuns.orderBy('id').last())!.id!
      return response({ id: wire!.id, status: 'accepted' })
    }
    if (wire && path.endsWith(`/requests/${wire.id}/acknowledge`)) {
      return response({ id: wire.id, status: 'completed', acknowledged: true, acknowledgedAt: Date.now() })
    }
    if (wire && path.endsWith(`/requests/${wire.id}`)) {
      if (!completed) throw new TypeError('controlled lost native observation')
      return response({ id: wire.id, model: wire.model, createdAt: Date.now(), status: 'completed', text: output,
        usage: { inputTokens: 101, outputTokens: 11 }, dispatched: true, requestHash,
        requestHashAlgorithm: 'sha256-json-request-v1', receiptRetention: CODEX_DURABLE_RECEIPT_RETENTION_V1 })
    }
    throw new Error(`SFQA004 forbids unbound transport: ${method} ${path}`)
  })
  const stopped = await runProductProductionUntilBlockedV1(owned)
  const original = await readAgentRunV1(owned.scope, runId)
  const taskKey = original.contract.scope.productProduction!.taskKey!
  let requestEvidence: { owner: { attempt: number } } | undefined
  for (const event of original.events) {
    if (event.type !== 'evidence.artifact.recorded' || event.payload.artifactKind !== 'source-snapshot') continue
    const value = JSON.parse(await readAgentRunArtifactExactV1({ projectId: owned.scope.projectId,
      artifactKind: 'source-snapshot', contentHash: event.payload.contentHash }))
    if (value?.schema === 'storyforge.product-production-local-request') requestEvidence = value
  }
  if (!requestEvidence) throw new Error('SFQA004 missing real retained local request evidence')
  completed = true
  return { ...owned, data, original, requests, query: { scope: owned.scope, productionId: owned.productionId,
    buildId: stopped.buildId, runId, taskKey, attempt: requestEvidence.owner.attempt,
    confirmation: 'retain-original-complete-response-without-inference-v1' as const } }
}
