import { expect, test, type Page } from '@playwright/test'
import { createLongform } from './helpers/product-entry'

const generated = '林舟合上账本，先问苏砚是否愿意留下。苏砚把旧灯放回窗边，答应明天再来，两人这才关门。'.repeat(12)

async function prepare(page: Page, automatic: boolean) {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge-ai-config', JSON.stringify({
      provider: 'ollama', baseUrl: 'https://post-preparation.invalid/v1', model: 'post-recovery-test',
      maxTokens: 4000, contextWindow: 64000, temperature: 0,
    }))
  })
  await createLongform(page, '章后授权准备恢复')
  await page.getByRole('button', { name: '大纲与章纲', exact: true }).click()
  await page.getByRole('button', { name: '添加卷', exact: true }).click()
  await page.getByRole('button', { name: '添加章节', exact: true }).click()
  await page.getByLabel('章节摘要', { exact: true }).fill('林舟先询问搭档意愿，得到回应后关门，停在当晚。')
  await page.getByTitle('编辑本章细纲', { exact: true }).click()
  await page.getByRole('button', { name: '添加场景', exact: true }).click()
  await page.getByPlaceholder('一句话场景概要...', { exact: true }).fill('询问、回应、关门，不展开次日。')
  await page.getByRole('button', { name: '写本章正文', exact: true }).click()
  await page.evaluate(async automatic => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const [{ db }, { resolveScope }, policy] = await Promise.all([
      importer('/storyforge/src/lib/db/schema.ts'), importer('/storyforge/src/lib/workspace/scope.ts'),
      importer('/storyforge/src/lib/prose/post-adoption-policy.ts'),
    ])
    const project = await db.projects.toCollection().first()
    const scope = await resolveScope({ projectId: project.id })
    if (automatic) await policy.updateWorkPostAdoptionSettingsV1({ scope, settings: policy.resolveWorkPostAdoptionSettingsV1({
      postAdoptionPolicy: 'auto-with-budget', postAdoptionTaskTypes: ['memory', 'retrieval', 'consistency'],
      postAdoptionBudget: { maxModelCalls: 1, maxInputTokens: 24000, maxOutputTokens: 8000, maxCostUsd: 0.25, allowUnknownCost: true },
    }) })
    const interrupt = (_key: unknown, record: any) => {
      const payload = JSON.parse(record.payloadJson)
      if (payload.stepId !== 'chapter-post-adoption:authorization'
        || record.type !== (automatic ? 'step.succeeded' : 'candidate.persisted')) return
      db.agentRunEvents.hook('creating').unsubscribe(interrupt)
      throw new Error('测试中断授权准备')
    }
    db.agentRunEvents.hook('creating', interrupt)
  }, automatic)
}

async function authorizationState(page: Page) {
  return page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const [{ db }, { resolveScope }, { readAgentRunV1 }] = await Promise.all([
      importer('/storyforge/src/lib/db/schema.ts'), importer('/storyforge/src/lib/workspace/scope.ts'),
      importer('/storyforge/src/lib/agent/run/event-store.ts'),
    ])
    const project = await db.projects.toCollection().first(), scope = await resolveScope({ projectId: project.id })
    const row = (await db.agentRuns.toArray()).find((run: any) => run.parentRelation === 'prose-post-adoption')
    if (!row) return null
    const snapshot = await readAgentRunV1(scope, row.id)
    return {
      id: row.id, step: snapshot.projection.steps['chapter-post-adoption:authorization'],
      eventTypes: snapshot.events.map((event: any) => event.type),
      candidates: snapshot.events.filter((event: any) => event.type === 'candidate.persisted').length,
      confirmations: snapshot.events.filter((event: any) => event.type === 'confirmation.recorded').length,
      modelRequests: snapshot.events.filter((event: any) => event.type === 'model.requested').length,
    }
  })
}

for (const automatic of [false, true]) {
  test(`${automatic ? '预授权确认' : '建议候选'}准备中断后刷新恢复原 Run，不调用模型并保留显式启动入口`, async ({ page }) => {
    let calls = 0
    await page.route('https://post-preparation.invalid/**', route => {
      calls++
      return route.fulfill({ contentType: 'text/event-stream', body: [
        `data: ${JSON.stringify({ choices: [{ delta: { content: generated }, finish_reason: 'stop' }] })}`,
        '', 'data: [DONE]', '', '',
      ].join('\n') })
    })
    await prepare(page, automatic)
    await page.getByRole('button', { name: '✨ 生成正文', exact: true }).click()
  await page.getByRole('dialog', { name: '正文生成提示', exact: true }).getByRole('button', { name: '开始生成', exact: true }).click()
    const draft = page.getByRole('textbox', { name: 'AI 候选可编辑内容', exact: true })
    await expect(draft).toHaveValue(generated)
    await page.getByRole('button', { name: '采纳', exact: true }).click()
    await expect(draft).toHaveCount(0)
    await expect(page.getByText('测试中断授权准备', { exact: true })).toBeVisible()
    const partial = await authorizationState(page)
    expect(partial?.step.status).toBe('running')
    expect(partial?.confirmations).toBe(automatic ? 1 : 0)
    expect(calls).toBe(1)

    await page.reload()
    await expect(page.getByRole('button', { name: automatic ? '继续章后处理' : '确认并开始章后任务', exact: true })).toBeVisible()
    await expect(page.locator('.tiptap-editor')).toHaveText(generated)
    const recovered = await authorizationState(page)
    expect(recovered?.id).toBe(partial?.id)
    expect(recovered?.step.status).toBe(automatic ? 'succeeded' : 'awaiting_confirmation')
    expect(recovered?.candidates).toBe(1)
    expect(recovered?.confirmations).toBe(automatic ? 1 : 0)
    expect(recovered?.modelRequests).toBe(0)
    expect(calls).toBe(1)

    await page.reload()
    await expect(page.getByRole('button', { name: automatic ? '继续章后处理' : '确认并开始章后任务', exact: true })).toBeVisible()
    expect(await authorizationState(page)).toEqual(recovered)
    expect(calls).toBe(1)
  })
}
