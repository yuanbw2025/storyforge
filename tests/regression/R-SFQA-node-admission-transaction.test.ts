import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/lib/ai/client', async () => ({
  ...await vi.importActual<typeof import('../../src/lib/ai/client')>('../../src/lib/ai/client'),
  chat: vi.fn(async () => { throw new Error('Manual candidate must not call a model') }),
}))
vi.mock('../../src/lib/agent/formal-ai-entry', async () => ({
  ...await vi.importActual<typeof import('../../src/lib/agent/formal-ai-entry')>('../../src/lib/agent/formal-ai-entry'),
  executeRegisteredAIEntryV1: vi.fn(async () => { throw new Error('Manual candidate must not call a model') }),
}))

import { chat } from '../../src/lib/ai/client'
import { executeRegisteredAIEntryV1 } from '../../src/lib/agent/formal-ai-entry'
import { db } from '../../src/lib/db/schema'
import { AUTHORING_NODE_BY_ID, defaultConfigForTemplate } from '../../src/lib/node-authoring/catalog'
import { emptyAuthoringGraph, type AuthoringNodeInstance } from '../../src/lib/node-authoring/contracts'
import { reviseAuthoringCandidate, runAuthoringGraph } from '../../src/lib/node-authoring/executor'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { seedCurrentWorkspace } from '../helpers/current-workspace'

async function seedManualCandidate() {
  const workspace = await seedCurrentWorkspace('Node admission transaction')
  const template = AUTHORING_NODE_BY_ID.get('input.manual-text')!
  const node: AuthoringNodeInstance = {
    id: 'manual', templateId: template.id, templateVersion: 1, title: template.label,
    x: 0, y: 0, config: { ...defaultConfigForTemplate(template), text: 'Preserved author draft' },
    inputs: structuredClone(template.inputs), outputs: structuredClone(template.outputs),
  }
  const flowId = await db.nodeFlows.add(stampNewRecord(workspace.scope, 'nodeFlows', {
    projectId: workspace.scope.projectId, worldGroupId: null, name: 'Manual candidate', description: '',
    graphJson: JSON.stringify({ ...emptyAuthoringGraph(), nodes: [node] }), createdAt: 1, updatedAt: 1,
  }, { owner: 'work' }))
  const flow = (await db.nodeFlows.get(flowId))!
  const result = await runAuthoringGraph({ flow })
  expect(result.run.status).toBe('completed')
  expect(result.candidates[node.id]?.output).toBe('Preserved author draft')
  return { ...workspace, node, flow, runId: result.run.id! }
}

describe('Node candidate admission preserves the real transaction boundary', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    vi.clearAllMocks()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    db.close()
  })

  it.each(['missing', 'foreign', 'unavailable'] as const)(
    'rejects a %s Work without any NodeRun write or model call', async reason => {
      const fixture = await seedManualCandidate()
      if (reason === 'missing') await db.works.delete(fixture.scope.workId)
      else if (reason === 'foreign') {
        const other = await seedCurrentWorkspace('Other owner')
        await db.works.update(fixture.scope.workId, {
          projectId: other.scope.projectId, worldId: other.scope.worldId,
        })
      } else {
        await db.works.update(fixture.scope.workId, { kind: 'ttrpg', novelProfile: null })
        vi.stubGlobal('window', {
          location: { hostname: 'storyforge.invalid' }, localStorage: window.localStorage,
        })
      }
      const before = await db.nodeRuns.toArray()
      let writes = 0
      const recordWrite = () => { writes++ }
      db.nodeRuns.hook('creating', recordWrite)
      db.nodeRuns.hook('updating', recordWrite)
      db.nodeRuns.hook('deleting', recordWrite)
      try {
        await expect(reviseAuthoringCandidate({
          flow: fixture.flow, runId: fixture.runId, nodeId: fixture.node.id,
          output: 'Must not be published', scope: fixture.scope,
        })).rejects.toThrow(reason === 'unavailable' ? /product-catalog.*upper\.ttrpg/ : /有效 World\/Work/)
        expect(writes).toBe(0)
        expect(await db.nodeRuns.toArray()).toEqual(before)
        expect(chat).not.toHaveBeenCalled()
        expect(executeRegisteredAIEntryV1).not.toHaveBeenCalled()
      } finally {
        db.nodeRuns.hook('creating').unsubscribe(recordWrite)
        db.nodeRuns.hook('updating').unsubscribe(recordWrite)
        db.nodeRuns.hook('deleting').unsubscribe(recordWrite)
      }
    },
  )
})
