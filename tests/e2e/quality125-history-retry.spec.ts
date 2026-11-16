import { expect, test, type Page } from '@playwright/test'
import { createLongform } from './helpers/product-entry'
import { openLongformLeaf } from './helpers/longform-navigation'

type Mode = 'consult' | 'storm'

function output(mode: Mode, attempt: number) {
  const marker = `修复候选${mode}-${attempt}`
  return mode === 'consult'
    ? `## 前提识别\n- ${marker}：镜税署与盐票是作者明确的架空设定。\n\n## 可能存在的问题\n- 垄断执行成本需要说明，信心：高。\n\n## 修改方案 / 折中方案\n- 增设分级验票与行会连带责任。\n\n## 时代质感补充\n- 可描写封签、簿册和码头抽验；真实类比出处待考。`
    : `## 场景画面\n- ${marker}：码头验票人用镜灯核对盐票暗纹。\n\n## 人物与对白触点\n- 脚夫抱怨兑票只能在指定行栈使用。\n\n## 可写进小说的冲突灵感\n- 黑市用旧封签调包新票，牵连负责验票的官吏。\n\n## 可选的史实补强\n- 票据制度类比仍需进一步查证，标记为待考。`
}

async function audit(page: Page) {
  return page.evaluate(async () => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<unknown>
    const { db } = await importer('/storyforge/src/lib/db/schema.ts') as typeof import('../../src/lib/db/schema')
    const { readAgentRunV1 } = await importer('/storyforge/src/lib/agent/run/event-store.ts') as typeof import('../../src/lib/agent/run/event-store')
    const project = await db.projects.toCollection().first()
    if (!project?.id || !project.activeWorldId || !project.activeWorkId) throw new Error('Missing isolated history owner')
    const scope = { projectId: project.id, worldId: project.activeWorldId, workId: project.activeWorkId }
    const runs = await db.agentRuns.where('projectId').equals(project.id).sortBy('id')
    return {
      event: await db.historicalTimelineEvents.where('projectId').equals(project.id).first(),
      runs: await Promise.all(runs.map(async run => {
        const snapshot = await readAgentRunV1(scope, run.id!)
        return {
          id: run.id, state: snapshot.projection.state,
          cancelled: snapshot.events.filter(event => event.type === 'run.cancelled').length,
          events: snapshot.events,
        }
      })),
    }
  })
}

for (const mode of ['consult', 'storm'] as const) {
  test(`${mode}: retry creates one new candidate, reloads it, and only confirmation writes the result`, async ({ page }) => {
    let calls = 0
    await page.addInitScript(() => {
      localStorage.setItem('storyforge_guide_completed', 'e2e')
      localStorage.setItem('storyforge-ai-config', JSON.stringify({
        provider: 'ollama', apiKey: '', model: 'history-retry-isolated', baseUrl: 'http://localhost:1234/v1',
        temperature: 0, maxTokens: 0, contextWindow: 100000,
      }))
    })
    await page.route('http://localhost:1234/v1/chat/completions', async route => {
      calls++
      const request = route.request().postDataJSON() as { messages: Array<{ content: string }> }
      const prompt = request.messages.map(message => message.content).join('\n')
      expect(prompt).toContain('【历史 Agent 正式输入基线】')
      expect(prompt).toContain('盐晶新律颁布')
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        choices: [{ message: { role: 'assistant', content: output(mode, calls) }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 180, completion_tokens: 80, total_tokens: 260 },
      }) })
    })
    await page.goto('./', { waitUntil: 'domcontentloaded' })
    await page.getByTestId('home-page').waitFor()
    await createLongform(page, `历史重试 ${mode}`)
    await openLongformLeaf(page, '历史年表')
    await page.getByRole('button', { name: '添加事件', exact: true }).click()
    await page.locator('input[value="新历史事件"]').fill('盐晶新律颁布')
    await page.getByRole('heading', { name: '📜 历史年表与时间线' }).click()
    await page.getByRole('button', { name: mode === 'consult' ? 'AI 历史考据' : 'AI 头脑风暴', exact: true }).click()
    await expect(page.getByText(`修复候选${mode}-1`, { exact: false })).toBeVisible()
    const before = await audit(page)
    expect(before.runs).toHaveLength(1)
    await page.getByRole('button', { name: '拒绝并重试', exact: true }).click()
    await expect(page.getByText(`修复候选${mode}-2`, { exact: false })).toBeVisible()
    expect(calls).toBe(2)
    const after = await audit(page)
    expect(after.runs).toHaveLength(2)
    expect(after.runs[0]).toMatchObject({ id: before.runs[0].id, state: 'cancelled', cancelled: 1 })
    expect(after.runs[0].events.slice(0, before.runs[0].events.length)).toEqual(before.runs[0].events)
    expect(after.runs[1].state).toBe('awaiting_confirmation')
    expect(after.event?.aiConsult).toBeUndefined()
    expect(after.event?.aiBrainstorm).toBeUndefined()

    await page.reload()
    await openLongformLeaf(page, '历史年表')
    await page.getByText('盐晶新律颁布', { exact: true }).click()
    await expect(page.getByText('已恢复待确认候选；没有重复调用模型。', { exact: true })).toBeVisible()
    await expect(page.getByText(`修复候选${mode}-2`, { exact: false })).toBeVisible()
    expect(calls).toBe(2)
    await page.getByRole('button', { name: '确认写入', exact: true }).click()
    const savedLabel = mode === 'consult' ? 'AI 历史考据结果' : 'AI 头脑风暴结果'
    await expect(page.getByText(savedLabel, { exact: true })).toBeVisible()
    const accepted = await audit(page)
    expect(accepted.runs[1].state).toBe('completed')
    expect(mode === 'consult' ? accepted.event?.aiConsult : accepted.event?.aiBrainstorm).toBe(output(mode, 2))
    expect(mode === 'consult' ? accepted.event?.aiBrainstorm : accepted.event?.aiConsult).toBeUndefined()
    await page.reload()
    await openLongformLeaf(page, '历史年表')
    await page.getByText('盐晶新律颁布', { exact: true }).click()
    await expect(page.getByText(savedLabel, { exact: true })).toBeVisible()
    await expect(page.getByText(`修复候选${mode}-2`, { exact: false })).toBeVisible()
    expect(calls).toBe(2)
  })
}
