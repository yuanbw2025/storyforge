import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { useNodeFlowStore } from '../../src/stores/node-flow'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { AUTHORING_NODE_BY_ID, defaultConfigForTemplate } from '../../src/lib/node-authoring/catalog'
import { emptyAuthoringGraph, type AuthoringNodeInstance } from '../../src/lib/node-authoring/contracts'
import { runAuthoringGraph } from '../../src/lib/node-authoring/executor'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { readAgentRunArtifactExactV1 } from '../../src/lib/memory/artifact-store'

async function nativeSnapshot() {
  const rows: Record<string, unknown[]> = {}
  for (const table of db.tables) rows[table.name] = await table.toArray()
  return rows
}

describe.sequential('SFQA002 actual Node field raw response ownership', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    useAIConfigStore.getState().setConfig({ provider: 'custom', apiKey: 'synthetic-node-key',
      model: 'node002-synthetic', baseUrl: 'https://node002.invalid/v1', temperature: .5,
      maxTokens: 6_000, contextWindow: 128_000 })
  })
  afterEach(async () => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    await db.delete()
  })

  it.each(['world.origin', 'story.theme'] as const)('%s saves actual invalid full response before parsing', async templateId => {
    const workspace = await seedCurrentWorkspace(`002 native ${templateId}`)
    const template = AUTHORING_NODE_BY_ID.get(templateId)
    if (!template) throw new Error('Actual registered field template missing')
    const node: AuthoringNodeInstance = { id: 'field', templateId, templateVersion: 1,
      title: template.label, x: 0, y: 0, config: { ...defaultConfigForTemplate(template), candidateCount: 1 },
      inputs: structuredClone(template.inputs), outputs: structuredClone(template.outputs) }
    const flowId = await useNodeFlowStore.getState().createFlow(workspace.scope.projectId, null,
      { graph: { ...emptyAuthoringGraph(), nodes: [node] } })
    const flow = await db.nodeFlows.get(flowId)
    if (!flow) throw new Error('Public Flow create did not persist')
    const raw = `\r\n  NODE002_FULL_INVALID_${templateId}_e\u0301🌙\n\t `
    const requestBodies: unknown[] = []
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (url, options) => {
      expect(String(url)).toBe('https://node002.invalid/v1/chat/completions')
      expect(options?.method).toBe('POST')
      requestBodies.push(JSON.parse(String(options?.body)))
      expect(requestBodies).toHaveLength(1)
      return new Response(JSON.stringify({ choices: [{ message: { content: raw }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 17, completion_tokens: 9, total_tokens: 26 } }), { status: 200 })
    }))
    const before = await nativeSnapshot()
    const result = await runAuthoringGraph({ flow })
    const after = await nativeSnapshot()
    expect(requestBodies).toHaveLength(1)
    expect(result.run.status).toBe('failed')
    expect(after.worldviews).toEqual(before.worldviews)
    expect(after.storyCores).toEqual(before.storyCores)
    const producers = await db.agentRuns.filter(row => row.nodeRunId === result.run.id
      && row.nodeProducerNodeId === node.id && row.nodeProducerVariantIndex === 0
      && row.nodeProducerAttempt === 1).toArray()
    expect(producers).toHaveLength(1)
    const producer = producers[0]
    if (producer?.id == null) throw new Error('Missing real producer Run')
    const saved = await readAgentRunV1(workspace.scope, producer.id)
    expect(saved.run.workId).toBe(workspace.scope.workId)
    expect(saved.events.filter(event => event.type === 'model.requested')).toHaveLength(1)
    expect(saved.events.filter(event => event.type === 'model.responded')).toHaveLength(1)
    const bodies: unknown[] = []
    for (const event of saved.events) {
      if (event.type === 'evidence.artifact.recorded' && event.payload.artifactKind === 'raw-response') {
        const content = await readAgentRunArtifactExactV1({ projectId: workspace.scope.projectId,
          artifactKind: 'raw-response', contentHash: event.payload.contentHash })
        bodies.push(JSON.parse(content))
      }
    }
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toMatchObject({ version: 'creation-model-response-v1', raw,
      observation: { outcome: 'returned', usage: { inputTokens: 17, outputTokens: 9, totalTokens: 26 } } })
    expect(saved.events.some(event => event.type === 'candidate.persisted')).toBe(false)
    expect(saved.events.some(event => event.type === 'verification.accepted')).toBe(false)
    expect(await nativeSnapshot()).toEqual(after)
  })
})
