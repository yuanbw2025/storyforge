import { expect, test } from '@playwright/test'
import { createLongform } from './helpers/product-entry'

const endpointPath = '/storyforge/quality077-consistency-evidence-model/v1'
test.use({ serviceWorkers: 'block' })
const prose = '林舟重新打开了封印。'
const rule = '封印只能打开一次'

test('一致性审计只展示已核验来源的位置和版本，错误身份可见失败', async ({ page, context, baseURL }) => {
  if (!baseURL || new URL(baseURL).hostname !== '127.0.0.1') throw new Error('Isolated loopback browser required')
  const origin = new URL(baseURL).origin
  const endpoint = origin + endpointPath
  await context.addInitScript(({ origin, endpoint }) => {
    if (location.origin !== origin) return
    localStorage.setItem('storyforge-ai-config', JSON.stringify({
      provider: 'ollama', baseUrl: endpoint, model: 'consistency-evidence-e2e', temperature: 0, maxTokens: 4000, contextWindow: 128000,
    }))
  }, { origin, endpoint })
  const responses: string[] = []
  const blocked: string[] = []
  const reason = '正文里的重新打开需要核对已确认规则。'
  const fixture: { canonId?: number } = {}
  await context.route('**/*', async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin === origin && url.pathname === endpointPath + '/chat/completions') {
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204 })
      const canonId = fixture.canonId
      if (request.method() === 'POST' && canonId != null && responses.length < 2) {
        const payload = request.postDataJSON() as { messages: Array<{ content: string }> }
        expect(payload.messages[1].content).toContain(`[canon#${canonId}]`)
        expect(payload.messages[1].content).toContain(rule)
        const id = responses.length === 0 ? 999999999 : canonId
        const raw = JSON.stringify({ findings: [{ category: '封印规则', severity: 'hard', anchorId: 'p1',
          evidence: [{ sourceType: 'canon', sourceId: id, quote: rule }], reason }] })
        responses.push(raw)
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({
          choices: [{ message: { content: raw }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 25, completion_tokens: 10, total_tokens: 35 },
        }) })
      }
    } else if (url.origin === origin && ['GET', 'HEAD'].includes(request.method())) return route.continue()
    blocked.push(request.method() + ' ' + url.origin + url.pathname)
    return route.abort('blockedbyclient')
  })
  await createLongform(page, '077 一致性证据隔离验收')
  const target = await page.evaluate(async ({ prose, rule }) => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const [{ db }, { resolveScope, stampNewRecord }, { fingerprintSettingSource }] = await Promise.all([
      load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts'),
      load<typeof import('../../src/lib/workspace/scope')>('/storyforge/src/lib/workspace/scope.ts'),
      load<typeof import('../../src/lib/fact-ledger/setting-assertions')>('/storyforge/src/lib/fact-ledger/setting-assertions.ts'),
    ])
    const project = (await db.projects.toCollection().first())!
    const scope = await resolveScope({ projectId: project.id! })
    const common = { projectId: scope.projectId, createdAt: Date.now(), updatedAt: Date.now() }
    const parentId = await db.outlineNodes.add(stampNewRecord(scope, 'outlineNodes', {
      ...common, type: 'volume' as const, parentId: null, title: '封印', summary: '', order: 0,
    }, { owner: 'work' }))
    const outlineNodeId = await db.outlineNodes.add(stampNewRecord(scope, 'outlineNodes', {
      ...common, type: 'chapter' as const, parentId, title: '重开封印', summary: '', order: 0,
    }, { owner: 'work' }))
    const chapterId = await db.chapters.add(stampNewRecord(scope, 'chapters', {
      ...common, outlineNodeId, title: '重开封印', content: `<p>${prose}</p>`, wordCount: prose.length,
      order: 0, status: 'draft' as const, notes: '',
    }, { owner: 'work' }))
    const sourceWorldviewId = await db.worldviews.add(stampNewRecord(scope, 'worldviews', {
      ...common, worldOrigin: rule,
    }, { owner: 'world' }))
    const canonId = await db.temporalFacts.add(stampNewRecord(scope, 'temporalFacts', {
      ...common, subjectName: '封印', predicate: 'magicSource', value: rule, factKind: 'state' as const,
      sourceType: 'setting' as const, sourceWorldviewId, sourceRecordTable: 'worldviews',
      sourceField: 'worldOrigin', sourceFingerprint: fingerprintSettingSource(rule),
      status: 'confirmed' as const, locked: false,
    }, { owner: 'work' }))
    return { projectId: scope.projectId, outlineNodeId, chapterId, canonId }
  }, { prose, rule })

  fixture.canonId = target.canonId
  await page.goto(`./workspace/${target.projectId}?module=chapters-list&chapter=${target.outlineNodeId}`)
  await page.locator('[data-workspace-ready=longform]').waitFor()
  await page.getByRole('button', { name: '质量审校', exact: true }).click()
  await page.getByRole('button', { name: '一致性', exact: true }).click()
  const start = page.getByRole('button', { name: '开始检测', exact: true })
  await start.click()
  await expect(page.getByText(/JSON 无法解析或引文、证据无效/)).toBeVisible()
  await expect(page.getByText(/证据 canon#999999999/)).toHaveCount(0)
  await expect(page.getByText(/本次未发现可定位的一致性问题/)).toHaveCount(0)
  expect(responses).toHaveLength(1)
  expect(await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)') as <T>(path: string) => Promise<T>
    const { db } = await load<typeof import('../../src/lib/db/schema')>('/storyforge/src/lib/db/schema.ts')
    const rows = await db.agentRunArtifacts.toArray()
    return rows.filter(row => row.artifactKind === 'raw-response').map(row => JSON.parse(row.content!).raw)
  })).toEqual([responses[0]])

  await start.click()
  await expect(page.getByText(reason, { exact: true })).toBeVisible()
  const evidence = page.getByText(`证据 canon#${target.canonId}`, { exact: false })
  await expect(evidence).toContainText(/字符 \d+–\d+ · 版本 [a-f0-9]{12}/)
  await expect(evidence).toContainText(rule)
  await expect(page.locator('.tiptap-editor')).toContainText(prose)
  await page.reload()
  await page.getByRole('button', { name: '质量审校', exact: true }).click()
  await page.getByRole('button', { name: '一致性', exact: true }).click()
  await expect(evidence).toContainText(/版本 [a-f0-9]{12}/)
  await expect(page.getByText(/证据 canon#999999999/)).toHaveCount(0)
  expect(responses).toHaveLength(2)
  expect(blocked).toEqual([])
})
