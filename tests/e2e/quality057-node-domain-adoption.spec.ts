import { expect, test, type Page } from '@playwright/test'
import { openLongformLeaf } from './helpers/longform-navigation'
import { createLongform } from './helpers/product-entry'
import type { AuthoringCandidate } from '../../src/lib/node-authoring/contracts'

const endpointPath = '/storyforge/quality057-domain-model/v1'
const body = '<p>林风的手部受伤。</p>'
const families = ['continuity.fact', 'chapter.organize'] as const
type Family = typeof families[number]
test.use({ serviceWorkers: 'block' })

async function seedGraph(page: Page, family: Family, endpoint: string) {
  return page.evaluate(async ({ family, endpoint, body }) => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const [{ db }, { resolveScope, stampNewRecord }, { useProjectStore }, { useCharacterStore }, { useAIConfigStore },
      { useNodeFlowStore }, { AUTHORING_NODE_BY_ID, defaultConfigForTemplate }, { emptyAuthoringGraph },
      { buildAuthoringOverviewGraph }] = await Promise.all([
      load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts'),
      load<typeof import('../../src/lib/workspace/scope')>('/storyforge/src/lib/workspace/scope.ts'),
      load<typeof import('../../src/stores/project')>('/storyforge/src/stores/project.ts'),
      load<typeof import('../../src/stores/character')>('/storyforge/src/stores/character.ts'),
      load<typeof import('../../src/stores/ai-config')>('/storyforge/src/stores/ai-config.ts'),
      load<typeof import('../../src/stores/node-flow')>('/storyforge/src/stores/node-flow.ts'),
      load<typeof import('../../src/lib/node-authoring/catalog')>('/storyforge/src/lib/node-authoring/catalog.ts'),
      load<typeof import('../../src/lib/node-authoring/contracts')>('/storyforge/src/lib/node-authoring/contracts.ts'),
      load<typeof import('../../src/lib/node-authoring/overview')>('/storyforge/src/lib/node-authoring/overview.ts'),
    ])
    const projectId = useProjectStore.getState().currentProjectId
    if (projectId == null || !navigator.locks?.request) throw new Error('Actual local workspace and native Web Locks required')
    const scope = await resolveScope({ projectId })
    const shared = { projectId, createdAt: 1, updatedAt: 1 }
    const outlineNodeId = await db.outlineNodes.add(stampNewRecord(scope, 'outlineNodes', {
      ...shared, type: 'chapter' as const, title: '受伤', summary: '林风受伤', parentId: null, order: 0,
    }, { owner: 'work' }))
    const chapterId = await db.chapters.add(stampNewRecord(scope, 'chapters', {
      ...shared, outlineNodeId, title: '受伤', content: body, wordCount: 8, status: 'draft' as const, order: 0, notes: '',
    }, { owner: 'work' }))
    await useCharacterStore.getState().addCharacter({ projectId, name: '林风', shortDescription: '隔离角色',
      homeWorldGroupId: null, roleWeight: 'main', moralAxis: 'neutral', orderAxis: 'neutral', appearance: '',
      personality: '', background: '', motivation: '', abilities: '', relationships: '[]', arc: '' })
    const overview = await buildAuthoringOverviewGraph({ projectId, worldGroupId: null })
    const source = overview.graph.nodes.find(node => node.binding?.ref?.target === 'chapters' && node.binding.ref.fieldKey === 'content')
    if (!source) throw new Error('Missing registered chapter Canon binding')
    const template = AUTHORING_NODE_BY_ID.get(family)!
    const node = { id: 'target', templateId: template.id, templateVersion: 1 as const, title: template.label, x: 440, y: 60,
      inputs: structuredClone(template.inputs), outputs: structuredClone(template.outputs),
      config: { ...defaultConfigForTemplate(template), chapterTitle: '受伤', candidateCount: 1 } }
    const graph = { ...emptyAuthoringGraph(), nodes: family === 'chapter.organize' ? [source, node] : [node],
      edges: family === 'chapter.organize' ? [{
        id: 'chapter-source', sourceNodeId: source.id, sourcePortId: source.outputs[0].id, targetNodeId: node.id, targetPortId: 'chapter',
      }] : [] }
    const flowId = await useNodeFlowStore.getState().createFlow(projectId, null, { graph })
    useAIConfigStore.getState().setConfig({ provider: 'custom', apiKey: 'synthetic-node-e2e', model: 'isolated-057',
      baseUrl: endpoint, temperature: 0.5, maxTokens: 8_000, contextWindow: 128_000 })
    return { scope, chapterId, flowId }
  }, { family, endpoint, body })
}

for (const family of families) {
  test(`${family} 在实际节点工作区等待确认，刷新只保留一次写入`, async ({ page, context, baseURL }) => {
    if (!baseURL || new URL(baseURL).hostname !== '127.0.0.1') throw new Error('Isolated loopback browser required')
    const origin = new URL(baseURL).origin
    const requests: string[] = [], blocked: string[] = []
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url())
      if (url.origin === origin && url.pathname === endpointPath + '/chat/completions') {
        if (request.method() === 'OPTIONS') return route.fulfill({ status: 204 })
        if (request.method() === 'POST' && requests.length === 0) {
          requests.push(request.postData() ?? '')
          const facts = [{ subject: '林风', predicate: 'healthStatus', value: '受伤', quote: '手部受伤' }]
          const output = family === 'chapter.organize'
            ? { facts, stateDiffs: [], inventoryEvents: [], storyEvents: [], relations: [], foreshadowUpdates: [] } : { facts }
          return route.fulfill({ contentType: 'application/json', body: JSON.stringify({
            choices: [{ message: { content: JSON.stringify(output) }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 17, completion_tokens: 9, total_tokens: 26 },
          }) })
        }
      } else if (url.origin === origin && ['GET', 'HEAD'].includes(request.method())) return route.continue()
      blocked.push(request.method() + ' ' + url.origin + url.pathname)
      return route.abort('blockedbyclient')
    })
    await createLongform(page, '057 节点领域采纳原生隔离')
    const target = await seedGraph(page, family, origin + endpointPath)
    const readback = () => page.evaluate(async ({ scope, chapterId, flowId }) => {
      const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
      const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
      const runs = await db.nodeRuns.where('flowId').equals(flowId).toArray()
      const latest = runs.sort((a, b) => b.startedAt - a.startedAt)[0]
      const candidates = (latest ? JSON.parse(latest.nodeResultsJson) : {}) as Record<string, AuthoringCandidate>
      const facts = (await db.temporalFacts.where('projectId').equals(scope.projectId).toArray())
        .filter(row => row.workId === scope.workId)
      return { facts, status: candidates.target?.status, content: (await db.chapters.get(chapterId))?.content }
    }, target)
    await openLongformLeaf(page, '节点模式')
    const node = page.locator(`[data-authoring-node-template="${family}"]`)
    await expect(node).toBeVisible()
    const runAll = page.getByRole('button', { name: '运行全部', exact: true })
    await runAll.click()
    await expect.poll(() => requests.length).toBe(1)
    await expect(runAll).toBeVisible()
    await node.click()
    const output = page.getByRole('textbox', { name: '候选输出', exact: true })
    await expect(output).toHaveValue(/healthStatus/)
    const adopt = page.getByRole('button', { name: '确认采纳', exact: true })
    await expect(adopt).toBeEnabled()
    expect(await readback()).toMatchObject({ facts: [], status: 'candidate', content: body })
    expect(requests).toHaveLength(1)
    await adopt.click()
    await expect(page.getByRole('button', { name: '已采纳', exact: true })).toBeDisabled()
    const accepted = await readback()
    expect(accepted.status).toBe('adopted')
    expect(accepted.facts).toHaveLength(1)
    expect(accepted.facts[0]).toMatchObject({ sourceChapterId: target.chapterId, predicate: 'healthStatus', value: '受伤' })
    expect(accepted.content).toBe(body)
    await page.reload()
    await expect(node).toBeVisible()
    await node.click()
    await expect(page.getByRole('button', { name: '已采纳', exact: true })).toBeDisabled()
    expect(await readback()).toEqual(accepted)
    expect(requests).toHaveLength(1)
    expect(blocked).toEqual([])
  })
}
