import { expect, test, type Page } from '@playwright/test'
import { createLongform } from './helpers/product-entry'
import { openLongformLeaf } from './helpers/longform-navigation'

async function setup(page: Page, incomplete = false) {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'e2e')
    localStorage.setItem('storyforge-ai-config', JSON.stringify({ provider: 'custom', apiKey: 'isolated-test', model: 'test-model', baseUrl: 'https://node-test.invalid/v1', temperature: 0.7, maxTokens: 2000, contextWindow: 32000 }))
  })
  await createLongform(page, '节点跨模式验收')
  const projectId = Number(new URL(page.url()).pathname.split('/').pop())
  await page.evaluate(async ({ projectId, incomplete }) => {
    const importer = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const { AUTHORING_NODE_BY_ID, defaultConfigForTemplate, emptyAuthoringGraph } = await importer('/storyforge/src/lib/node-authoring/index.ts')
    const { useNodeFlowStore } = await importer('/storyforge/src/stores/node-flow.ts')
    const { useAIConfigStore } = await importer('/storyforge/src/stores/ai-config.ts')
    useAIConfigStore.setState({ config: { provider: 'custom', apiKey: 'isolated-test', model: 'test-model', baseUrl: 'https://node-test.invalid/v1', temperature: 0.7, maxTokens: 2000, contextWindow: 32000 } })
    const node = (templateId: string, id: string, x: number) => {
      const template = AUTHORING_NODE_BY_ID.get(templateId)
      return { id, templateId, templateVersion: 1, title: template.label, x, y: 60, config: defaultConfigForTemplate(template), inputs: structuredClone(template.inputs), outputs: structuredClone(template.outputs) }
    }
    await useNodeFlowStore.getState().createFlow(projectId, null, { name: '当前作品节点图', graph: { ...emptyAuthoringGraph(), nodes: [node('world.origin', 'origin', 30), ...(incomplete ? [node('outline.chapter', 'unfinished', 330)] : [])] } })
  }, { projectId, incomplete })
  await openLongformLeaf(page, '节点模式')
  await expect(page.getByLabel('节点图名称')).toHaveValue('当前作品节点图')
  return projectId
}
async function mockOrigin(page: Page) {
  const requests: string[] = []
  await page.route('**/chat/completions', async route => {
    requests.push(route.request().postData() ?? '')
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ field: 'worldOrigin', value: '模型描述的海床古城。' }) } }], usage: { prompt_tokens: 12, completion_tokens: 24, total_tokens: 36 } }) })
  })
  return requests
}
async function selectOrigin(page: Page) {
  await page.locator('[data-authoring-node-template="world.origin"]').click()
}
async function runOrigin(page: Page) {
  await selectOrigin(page)
  await page.getByRole('button', { name: '运行到此节点', exact: true }).click()
  await expect(page.getByLabel('候选输出')).toHaveValue(/海床古城/)
}

test('selected node runs despite unfinished siblings; author revision survives rapid mode switch and reload then appears in step mode', async ({ page }) => {
  const requests = await mockOrigin(page)
  await setup(page, true)
  await runOrigin(page)
  expect(requests).toHaveLength(1)
  const output = JSON.stringify({ field: 'worldOrigin', value: '作者修订后的潮汐古城。' }, null, 2)
  await page.getByLabel('候选输出').fill(output)
  await page.getByRole('navigation', { name: '工作台创作方式' }).getByRole('button', { name: '分步骤模式', exact: true }).click()
  await openLongformLeaf(page, '节点模式')
  await selectOrigin(page)
  await expect(page.getByLabel('候选输出')).toHaveValue(output)
  await page.reload()
  await selectOrigin(page)
  await expect(page.getByLabel('候选输出')).toHaveValue(output)
  await page.getByRole('button', { name: '本地校验并采纳', exact: true }).click()
  await expect(page.getByRole('button', { name: '已采纳', exact: true })).toBeDisabled()
  await expect(page.getByLabel('候选输出')).toHaveAttribute('readonly', '')
  await openLongformLeaf(page, '世界起源')
  await expect(page.getByText('作者修订后的潮汐古城。', { exact: true })).toBeVisible()
  expect(requests).toHaveLength(1)
})

test('node name and author requirements save before navigation without waiting for autosave', async ({ page }) => {
  await setup(page)
  await selectOrigin(page)
  await page.getByLabel('节点图名称').fill('刚刚改名的图')
  await page.getByRole('textbox', { name: '生成要求', exact: true }).fill('只写潮汐起源，不增加神明。')
  await page.getByRole('navigation', { name: '工作台创作方式' }).getByRole('button', { name: '分步骤模式', exact: true }).click()
  await openLongformLeaf(page, '节点模式')
  await expect(page.getByLabel('节点图名称')).toHaveValue('刚刚改名的图')
  await selectOrigin(page)
  await expect(page.getByRole('textbox', { name: '生成要求', exact: true })).toHaveValue('只写潮汐起源，不增加神明。')
})

test('rejection remains visible after refresh and cannot be adopted or counted as formal content', async ({ page }) => {
  const requests = await mockOrigin(page)
  const projectId = await setup(page)
  await runOrigin(page)
  await page.getByRole('button', { name: '拒绝候选', exact: true }).click()
  await expect(page.getByRole('button', { name: '已拒绝', exact: true })).toBeDisabled()
  await page.reload(); await selectOrigin(page)
  await expect(page.getByRole('button', { name: '已拒绝', exact: true })).toBeDisabled()
  const count = await page.evaluate(async id => {
    const importer = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    return db.worldviews.where('projectId').equals(id).count()
  }, projectId)
  expect(count).toBe(0)
  expect(requests).toHaveLength(1)
})

test('step edits prevent adoption of an old node candidate', async ({ page }) => {
  const requests = await mockOrigin(page)
  await setup(page); await runOrigin(page)
  await openLongformLeaf(page, '世界起源')
  const placeholder = '创世神话 / 历史时期 / 文明起源……世界从何而来？'
  await page.getByText(placeholder, { exact: true }).last().click()
  await page.getByRole('textbox', { name: placeholder }).fill('分步骤刚确认的新起源。')
  await openLongformLeaf(page, '节点模式'); await selectOrigin(page)
  await page.getByRole('button', { name: '确认采纳', exact: true }).click()
  await expect(page.getByText(/目标内容已在分步骤模式或其它入口中更新|版本已变化|已变化/).last()).toBeVisible()
  await openLongformLeaf(page, '世界起源')
  await expect(page.getByText('分步骤刚确认的新起源。', { exact: true })).toBeVisible()
  expect(requests).toHaveLength(1)
})

test('mobile separates canvas, settings and readable candidate review without horizontal overflow', async ({ page }) => {
  await mockOrigin(page); await setup(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await selectOrigin(page)
  const nav = page.getByRole('navigation', { name: '节点工作区视图' })
  await nav.getByRole('button', { name: '节点设置', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '生成要求', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '运行到此节点', exact: true }).click()
  await nav.getByRole('button', { name: '候选与证据', exact: true }).click()
  const activeBackground = await nav.getByRole('button', { name: '候选与证据', exact: true }).evaluate(element => getComputedStyle(element).backgroundColor)
  expect(activeBackground).not.toBe('rgba(0, 0, 0, 0)')
  await expect(page.getByLabel('候选输出')).toHaveValue(/海床古城/)
  await page.getByLabel('候选输出').fill(JSON.stringify({ field: 'worldOrigin', value: '手机修订起源。' }))
  await expect(page.getByRole('button', { name: '本地校验并采纳', exact: true })).toBeVisible()
  expect(await page.locator('main').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
  const editor = await page.getByLabel('候选输出').boundingBox()
  expect(editor!.width).toBeGreaterThan(280)
  await nav.getByRole('button', { name: '画布', exact: true }).click()
  await nav.getByRole('button', { name: '候选与证据', exact: true }).click()
  await expect(page.getByLabel('候选输出')).toHaveValue(/手机修订/)
})

test('bound character field offers adoption and updates only its selected character', async ({ page }) => {
  await page.route('**/chat/completions', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ version: 1, patch: { motivation: '让沉没城市重见天日。' } }) } }] }) }))
  const projectId = await setup(page)
  await page.evaluate(async projectId => {
    const importer = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const { useCharacterStore } = await importer('/storyforge/src/stores/character.ts')
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    const { buildRagLibrary } = await importer('/storyforge/src/lib/retrieval/rag-library.ts')
    const { AUTHORING_NODE_BY_ID, defaultConfigForTemplate, emptyAuthoringGraph } = await importer('/storyforge/src/lib/node-authoring/index.ts')
    const { useNodeFlowStore } = await importer('/storyforge/src/stores/node-flow.ts')
    await useCharacterStore.getState().addCharacter({ projectId, name: '先行者', shortDescription: '已有角色一', motivation: '原动机一', worldGroupId: null, homeWorldGroupId: null })
    const secondId = await useCharacterStore.getState().addCharacter({ projectId, name: '潮汐测者', shortDescription: '已有角色二', motivation: '原动机二', worldGroupId: null, homeWorldGroupId: null })
    const target = (await buildRagLibrary({ projectId, worldGroupId: null })).find((entry: any) => entry.tableName === 'characters' && entry.recordId === secondId && entry.fieldKey === 'motivation')
    const template = AUTHORING_NODE_BY_ID.get('character.field.motivation')
    const flow = await db.nodeFlows.where('projectId').equals(projectId).first()
    await useNodeFlowStore.getState().saveFlow({ ...flow, graphJson: JSON.stringify({ ...emptyAuthoringGraph(), nodes: [{ id: 'motivation', templateId: template.id, templateVersion: 1, title: template.label, x: 30, y: 60, config: defaultConfigForTemplate(template), inputs: template.inputs, outputs: template.outputs, binding: { mode: 'snapshot', ref: { documentId: target.documentId, fieldKey: 'motivation', target: 'characters' } } }] }) })
  }, projectId)
  await page.reload()
  await page.locator('[data-authoring-node-template="character.field.motivation"]').click()
  await expect(page.getByLabel('绑定目标角色')).not.toHaveValue('')
  await page.getByRole('button', { name: '运行到此节点', exact: true }).click()
  await expect(page.getByLabel('候选输出')).toHaveValue(/重见天日/)
  await page.getByRole('button', { name: '确认采纳', exact: true }).click()
  await expect(page.getByRole('button', { name: '已采纳', exact: true })).toBeDisabled()
  const rows = await page.evaluate(async id => {
    const importer = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    return db.characters.where('projectId').equals(id).toArray()
  }, projectId)
  expect(rows.find((row: any) => row.name === '先行者').motivation).toBe('原动机一')
  expect(rows.find((row: any) => row.name === '潮汐测者').motivation).toBe('让沉没城市重见天日。')
  await openLongformLeaf(page, '角色生成')
  await expect(page.getByText('潮汐测者', { exact: true })).toBeVisible()
})

test('node library searches formal actions and keeps experimental drafts hidden until selected', async ({ page }) => {
  await setup(page)
  await page.getByLabel('查找节点').fill('设计、埋设')
  await expect(page.getByText('没有匹配节点，试试其他关键词。')).toBeVisible()
  await page.getByLabel('显示实验草稿节点').check()
  await expect(page.getByRole('button', { name: /伏笔.*实验草稿/ })).toBeVisible()
  await page.getByLabel('查找节点').fill('世界来源')
  await expect(page.getByRole('button', { name: /^世界来源 世界/ })).toBeVisible()
})

test('interrupted run restores durable results without issuing a model request', async ({ page }) => {
  const requests = await mockOrigin(page)
  const projectId = await setup(page); await runOrigin(page)
  await page.evaluate(async id => {
    const importer = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    const run = await db.nodeRuns.where('projectId').equals(id).first()
    await db.nodeRuns.update(run.id, { status: 'running', completedAt: null })
  }, projectId)
  await page.reload()
  await expect(page.getByText('上次运行中断。', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: '恢复已保存结果', exact: true }).click()
  await selectOrigin(page)
  await expect(page.getByLabel('候选输出')).toHaveValue(/海床古城/)
  await expect(page.getByRole('button', { name: '确认采纳', exact: true })).toBeEnabled()
  expect(requests).toHaveLength(1)
})

test('invalid connections are blocked before any model request', async ({ page }) => {
  const requests = await mockOrigin(page)
  const projectId = await setup(page)
  await page.evaluate(async id => {
    const importer = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    const { useNodeFlowStore } = await importer('/storyforge/src/stores/node-flow.ts')
    const { AUTHORING_NODE_BY_ID, defaultConfigForTemplate } = await importer('/storyforge/src/lib/node-authoring/index.ts')
    const flow = await db.nodeFlows.where('projectId').equals(id).first()
    const graph = JSON.parse(flow.graphJson)
    const template = AUTHORING_NODE_BY_ID.get('story.concept')
    graph.nodes.push({ id: 'story', templateId: template.id, templateVersion: 1, title: template.label, x: 330, y: 60, config: defaultConfigForTemplate(template), inputs: template.inputs, outputs: template.outputs })
    graph.edges.push({ id: 'invalid', sourceNodeId: 'origin', sourcePortId: 'candidate', targetNodeId: 'story', targetPortId: 'temperature' })
    await useNodeFlowStore.getState().saveFlow({ ...flow, graphJson: JSON.stringify(graph) })
  }, projectId)
  await page.reload()
  await page.getByRole('button', { name: '运行全部', exact: true }).click()
  await expect(page.getByText(/不能接入/).last()).toBeVisible()
  expect(requests).toHaveLength(0)
})

test('candidate revision restores into an independent copy and deleting its graph leaves the original intact', async ({ page }) => {
  await mockOrigin(page)
  const originalProjectId = await setup(page); await runOrigin(page)
  const output = JSON.stringify({ field: 'worldOrigin', value: '备份中的作者修订。' })
  await page.getByLabel('候选输出').fill(output)
  // Use the same pending-edit barrier as navigation, followed by the real portable lifecycle.
  const restoredProjectId = await page.evaluate(async id => {
    const importer = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const { flushPendingEditsV1 } = await importer('/storyforge/src/lib/authoring/pending-edit-coordinator.ts')
    const { exportProjectJSON, importProjectJSON } = await importer('/storyforge/src/lib/export/json-export.ts')
    await flushPendingEditsV1()
    return importProjectJSON(await exportProjectJSON(id))
  }, originalProjectId)
  await page.goto(`./workspace/${restoredProjectId}?module=visual-workflows`)
  await selectOrigin(page)
  await expect(page.getByLabel('候选输出')).toHaveValue(output)
  await page.getByRole('button', { name: '删除当前节点图', exact: true }).click()
  await page.getByRole('button', { name: '删除', exact: true }).click()
  await expect(page.getByRole('heading', { name: '领域节点创作', exact: true })).toBeVisible()
  const state = await page.evaluate(async ({ originalProjectId, restoredProjectId }) => {
    const importer = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts')
    return { originalFlows: await db.nodeFlows.where('projectId').equals(originalProjectId).count(), originalRuns: await db.nodeRuns.where('projectId').equals(originalProjectId).count(), restoredRuns: await db.nodeRuns.where('projectId').equals(restoredProjectId).count() }
  }, { originalProjectId, restoredProjectId })
  expect(state).toEqual({ originalFlows: 1, originalRuns: 1, restoredRuns: 0 })
})

test('save failure and delayed receipts preserve every edit before mode switching', async ({ page }) => {
  await setup(page); await selectOrigin(page)
  await page.evaluate(async () => {
    const importer = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const { useNodeFlowStore } = await importer('/storyforge/src/stores/node-flow.ts')
    ;(window as any).__nodeOriginalSave = useNodeFlowStore.getState().saveFlow
    useNodeFlowStore.setState({ saveFlow: async () => { throw new Error('隔离保存失败') } })
  })
  await page.getByRole('textbox', { name: '生成要求', exact: true }).fill('必须保留的作者要求。')
  await page.getByRole('navigation', { name: '工作台创作方式' }).getByRole('button', { name: '分步骤模式', exact: true }).click()
  await expect(page).toHaveURL(/module=visual-workflows/)
  await expect(page.getByRole('alert').filter({ hasText: '编辑已保留' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: '生成要求', exact: true })).toHaveValue('必须保留的作者要求。')
  await page.evaluate(async () => {
    const importer = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const { useNodeFlowStore } = await importer('/storyforge/src/stores/node-flow.ts')
    useNodeFlowStore.setState({ saveFlow: (window as any).__nodeOriginalSave })
  })
  await page.getByRole('button', { name: '重试保存', exact: true }).click()
  await page.getByRole('navigation', { name: '工作台创作方式' }).getByRole('button', { name: '分步骤模式', exact: true }).click()
  await openLongformLeaf(page, '节点模式'); await selectOrigin(page)
  await expect(page.getByRole('textbox', { name: '生成要求', exact: true })).toHaveValue('必须保留的作者要求。')
  await page.evaluate(async () => {
    const importer = new Function('p', 'return import(p)') as (p: string) => Promise<any>
    const { flushPendingEditsV1 } = await importer('/storyforge/src/lib/authoring/pending-edit-coordinator.ts')
    const { useNodeFlowStore } = await importer('/storyforge/src/stores/node-flow.ts')
    await flushPendingEditsV1()
    const save = useNodeFlowStore.getState().saveFlow
    let delayOnce = true
    useNodeFlowStore.setState({ saveFlow: async (flow: any) => {
      if (delayOnce) {
        delayOnce = false
        await new Promise<void>(resolve => { (window as any).__releaseNodeSave = resolve })
      }
      return save(flow)
    } })
  })
  await page.getByRole('textbox', { name: '生成要求', exact: true }).fill('正在保存的旧输入。')
  await page.getByRole('navigation', { name: '工作台创作方式' }).getByRole('button', { name: '分步骤模式', exact: true }).click()
  await expect.poll(() => page.evaluate(() => typeof (window as any).__releaseNodeSave)).toBe('function')
  await page.getByRole('textbox', { name: '生成要求', exact: true }).fill('保存延迟期间继续输入的新内容。')
  await page.evaluate(() => (window as any).__releaseNodeSave())
  await expect(page).not.toHaveURL(/module=visual-workflows/)
  await openLongformLeaf(page, '节点模式'); await selectOrigin(page)
  await expect(page.getByRole('textbox', { name: '生成要求', exact: true })).toHaveValue('保存延迟期间继续输入的新内容。')

})


test('another tab cannot recover or restart a flow while its original model call is active', async ({ page, context }) => {
  let release: (() => void) | undefined
  const pending = new Promise<void>(resolve => { release = resolve })
  let requests = 0
  await page.route('**/chat/completions', async route => {
    requests += 1
    await pending
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ field: 'worldOrigin', value: '原页面仍在生成的古城。' }) } }] }) })
  })
  await setup(page); await selectOrigin(page)
  await page.getByRole('button', { name: '运行到此节点', exact: true }).click()
  await expect.poll(() => requests).toBe(1)
  const other = await context.newPage()
  try {
    await other.goto(page.url())
    await expect(other.getByRole('button', { name: '恢复已保存结果', exact: true })).toBeVisible()
    await other.getByRole('button', { name: '恢复已保存结果', exact: true }).click()
    await expect(other.getByText(/节点图正在其他页面运行或恢复/).last()).toBeVisible()
    // A concurrent fresh run is also rejected before it can invoke a second model.
    await selectOrigin(other)
    await other.getByRole('button', { name: '运行到此节点', exact: true }).click()
    await expect(other.getByText(/节点图正在其他页面运行或恢复/).last()).toBeVisible()
    expect(requests).toBe(1)
  } finally { release!(); await other.close() }
  await expect(page.getByLabel('候选输出')).toHaveValue(/原页面仍在生成/)
  await page.getByRole('button', { name: '确认采纳', exact: true }).click()
  await expect(page.getByRole('button', { name: '已采纳', exact: true })).toBeDisabled()
  expect(requests).toBe(1)
})
